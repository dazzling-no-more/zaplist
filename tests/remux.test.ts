import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { PassThrough } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { child, children, element, encodeId, floatElement, ID, readVint, uint, uintElement } from '../service/ebml'
import { info, Job, remux, unlace } from '../service/remux'

// A small Matroska movie: video (track 1), Opus audio (2, default), AC-3 audio (3), subtitles (4);
// three clusters 10 s apart, a cue index at the end, the SeekHead pointing to it.
const OPUS_SILENCE = Buffer.from([0xf8, 0xff, 0xfe]) // one 20 ms Opus frame: 960 samples
const CLUSTER_TIMES = [0, 10000, 20000]

const text = (id: number, value: string) => element(id, [Buffer.from(value)])
function opusHead(): Buffer {
  const head = Buffer.alloc(19)
  head.write('OpusHead', 0, 'latin1')
  head[8] = 1 // version
  head[9] = 2 // channels
  head.writeUInt16LE(312, 10) // pre-skip
  head.writeUInt32LE(48000, 12)
  return head
}
function block(id: number, track: number, flags: number, payload: Buffer): Buffer {
  return element(id, [Buffer.from([0x80 | track, 0, 0, flags]), payload])
}
/** Three Opus frames, Xiph-laced. */
const lacedOpus = () => block(ID.SimpleBlock, 2, 0x80 | 0x02, Buffer.concat([Buffer.from([2, 3, 3]), OPUS_SILENCE, OPUS_SILENCE, OPUS_SILENCE]))
const videoFrame = (i: number) => Buffer.from(`video frame ${i}`)

function movie(): Buffer {
  const info = element(ID.Info, [uintElement(ID.TimecodeScale, 1000000), floatElement(0x4489, 30000)])
  const tracks = element(ID.Tracks, [
    element(ID.TrackEntry, [uintElement(ID.TrackNumber, 1), uintElement(ID.TrackType, 1), text(ID.CodecID, 'V_TEST')]),
    element(ID.TrackEntry, [
      uintElement(ID.TrackNumber, 2),
      uintElement(ID.TrackType, 2),
      text(ID.CodecID, 'A_OPUS'),
      text(ID.Name, 'English'),
      element(ID.CodecPrivate, [opusHead()]),
      uintElement(ID.CodecDelay, 6500000),
      element(ID.Audio, [floatElement(ID.SamplingFrequency, 48000), uintElement(ID.Channels, 2)]),
    ]),
    element(ID.TrackEntry, [uintElement(ID.TrackNumber, 3), uintElement(ID.TrackType, 2), text(ID.CodecID, 'A_AC3'), text(ID.Language, 'deu'), uintElement(ID.FlagDefault, 0)]),
    element(ID.TrackEntry, [uintElement(ID.TrackNumber, 4), uintElement(ID.TrackType, 17), text(ID.CodecID, 'S_TEXT/UTF8')]),
  ])
  const clusters = CLUSTER_TIMES.map((time, i) =>
    element(ID.Cluster, [
      uintElement(ID.Timecode, time),
      block(ID.SimpleBlock, 1, 0x80, videoFrame(i)),
      lacedOpus(),
      block(ID.SimpleBlock, 3, 0x80, Buffer.from('ac3 frame')),
      element(ID.BlockGroup, [block(ID.Block, 4, 0, Buffer.from('subtitle'))]),
    ]),
  )
  // The SeekHead's position fields have a fixed width, so its size doesn't depend on them.
  const position = (n: number) => element(ID.SeekPosition, [Buffer.from([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255])])
  const seekHead = (cuesAt: number) => element(ID.SeekHead, [element(ID.Seek, [element(ID.SeekID, [encodeId(ID.Cues)]), position(cuesAt)])])
  let offset = seekHead(0).length + info.length + tracks.length
  const clusterAt = clusters.map((c) => {
    const at = offset
    offset += c.length
    return at
  })
  const cues = element(
    ID.Cues,
    CLUSTER_TIMES.map((time, i) => element(ID.CuePoint, [uintElement(ID.CueTime, time), element(ID.CueTrackPositions, [uintElement(0xf7, 1), uintElement(ID.CueClusterPosition, clusterAt[i])])])),
  )
  const segment = element(ID.Segment, [seekHead(offset), info, tracks, ...clusters, cues])
  return Buffer.concat([element(ID.EBML, [text(0x4282, 'matroska')]), segment])
}

const FILE = movie()
let server: Server
let base = ''
let open = 0
let mostOpen = 0

beforeAll(async () => {
  // Serves the movie with byte ranges, like an IPTV server, and counts open connections.
  server = createServer((req, res) => {
    open++
    mostOpen = Math.max(mostOpen, open)
    res.on('close', () => open--)
    const from = Number(/bytes=(\d+)-/.exec(req.headers.range ?? '')?.[1] ?? 0)
    res.writeHead(from ? 206 : 200, { 'Content-Type': 'video/x-matroska' })
    res.end(FILE.subarray(from))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

/** Each test opens its own "movie", so the service's header cache doesn't carry over. */
let movieNumber = 0
const newUrl = () => `${base}/movie/u/p/${++movieNumber}.mkv`

async function run(url: string, start: number, audio?: number): Promise<{ tracks: Buffer[]; clusters: Buffer[] }> {
  const out = new PassThrough()
  const chunks: Buffer[] = []
  out.on('data', (chunk: Buffer) => chunks.push(chunk))
  await remux({ url, start, audio }, out, new Job())
  const output = Buffer.concat(chunks)
  // EBML header, then a Segment of unknown size (4-byte ID, 8-byte size) holding the rest.
  const ebml = children(output)[0]
  const body = output.subarray(encodeId(ID.EBML).length + 1 + ebml.data.length + 12)
  const elements = children(body)
  return {
    tracks: children(elements.find((e) => e.id === ID.Tracks)!.data).map((e) => e.data),
    clusters: elements.filter((e) => e.id === ID.Cluster).map((e) => e.data),
  }
}

/** [track, payload] of each block in a cluster. */
function blocks(cluster: Buffer): [number, Buffer][] {
  return children(cluster)
    .filter((c) => c.id === ID.SimpleBlock || c.id === ID.BlockGroup)
    .map((c) => {
      const data = c.id === ID.SimpleBlock ? c.data : child(c.data, ID.Block)!
      const [track, length] = readVint(data, 0)!
      return [track, data.subarray(length + 3)]
    })
}

describe('remux', () => {
  it('lists the audio tracks and finds the cue before a position', async () => {
    const url = newUrl()
    expect(await info(url, 0, new Job())).toEqual({
      start: 0,
      audio: [
        { number: 2, label: 'English', default: true },
        { number: 3, label: 'deu', default: false },
      ],
    })
    expect((await info(url, 15, new Job())).start).toBe(10)
    expect((await info(url, 25, new Job())).start).toBe(20)
  })

  it('turns Opus into PCM and keeps the video as it is, without the other tracks', async () => {
    const { tracks, clusters } = await run(newUrl(), 0)
    expect(tracks.map((t) => child(t, ID.CodecID)!.toString())).toEqual(['V_TEST', 'A_PCM/INT/LIT'])
    const pcm = child(tracks[1], ID.Audio)!
    expect([uint(child(pcm, ID.Channels)), uint(child(pcm, ID.BitDepth))]).toEqual([2, 16])
    expect(child(tracks[1], ID.CodecPrivate)).toBeUndefined()
    expect(clusters.map((c) => uint(child(c, ID.Timecode)))).toEqual(CLUSTER_TIMES)
    clusters.forEach((cluster, i) => {
      const [video, audio, ...rest] = blocks(cluster)
      expect(video).toEqual([1, videoFrame(i)])
      // Three 20 ms frames: 2880 samples of 2 channels, 16 bits each.
      expect(audio[0]).toBe(2)
      expect(audio[1].length).toBe(3 * 960 * 2 * 2)
      expect(rest).toEqual([])
    })
  })

  it('starts at the cue before the position, over one connection at a time', async () => {
    mostOpen = 0
    const { clusters } = await run(newUrl(), 15)
    expect(clusters.map((c) => uint(child(c, ID.Timecode)))).toEqual([10000, 20000])
    expect(mostOpen).toBe(1)
  })

  it('passes another audio track through untouched when it is chosen', async () => {
    const { tracks, clusters } = await run(newUrl(), 0, 3)
    expect(tracks.map((t) => child(t, ID.CodecID)!.toString())).toEqual(['V_TEST', 'A_AC3'])
    expect(blocks(clusters[0])).toEqual([
      [1, videoFrame(0)],
      [3, Buffer.from('ac3 frame')],
    ])
  })
})

describe('unlace', () => {
  const frames = [Buffer.from('aaaa'), Buffer.from('bb'), Buffer.from('cccccc')]
  const header = (flags: number) => Buffer.from([0x81, 0, 0, flags])

  it('splits Xiph, EBML and fixed lacing', () => {
    const xiph = Buffer.concat([header(0x02), Buffer.from([2, 4, 2]), ...frames])
    expect(unlace(xiph, 3)).toEqual(frames)
    // EBML: first size 4 (0x84), then 2 - 4 = -2 as a signed 1-byte vint (bias 63: 61 = 0xbd).
    const ebml = Buffer.concat([header(0x06), Buffer.from([2, 0x84, 0xbd]), ...frames])
    expect(unlace(ebml, 3)).toEqual(frames)
    const fixed = Buffer.concat([header(0x04), Buffer.from([1]), Buffer.from('xxyy')])
    expect(unlace(fixed, 3)).toEqual([Buffer.from('xx'), Buffer.from('yy')])
    expect(unlace(Buffer.concat([header(0x80), Buffer.from('one')]), 3)).toEqual([Buffer.from('one')])
  })
})
