import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { PassThrough } from 'node:stream'
import { deflateSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { child, children, element, encodeId, floatElement, ID, readVint, uint, uintElement } from '../service/ebml'
import { contentDecoder, info, Job, remux, unlace } from '../service/remux'

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
const VOBSUB_IDX = 'size: 720x576\npalette: 000000, f0f0f0, cccccc, 999999\n'
/** A 440 Hz tone in 5.1 encoded by FFmpeg's DTS encoder: three frames of 1024 bytes, 512 samples each. */
const TONE = readFileSync(new URL('./fixtures/tone.dts', import.meta.url))
const dtsFrame = (i: number) => TONE.subarray(i * 1024, (i + 1) * 1024)

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
    element(ID.TrackEntry, [uintElement(ID.TrackNumber, 5), uintElement(ID.TrackType, 17), text(ID.CodecID, 'S_VOBSUB'), text(ID.CodecPrivate, VOBSUB_IDX)]),
    // Says 7.1, as DTS-HD tracks do; its core is 5.1.
    element(ID.TrackEntry, [uintElement(ID.TrackNumber, 6), uintElement(ID.TrackType, 2), text(ID.CodecID, 'A_DTS'), uintElement(ID.FlagDefault, 0), element(ID.Audio, [floatElement(ID.SamplingFrequency, 48000), uintElement(ID.Channels, 8)])]),
  ])
  const clusters = CLUSTER_TIMES.map((time, i) =>
    element(ID.Cluster, [
      uintElement(ID.Timecode, time),
      block(ID.SimpleBlock, 1, 0x80, videoFrame(i)),
      lacedOpus(),
      block(ID.SimpleBlock, 3, 0x80, Buffer.from('ac3 frame')),
      element(ID.BlockGroup, [block(ID.Block, 4, 0, Buffer.from(`subtitle ${i}`)), uintElement(ID.BlockDuration, 2500)]),
      block(ID.SimpleBlock, 5, 0x80, Buffer.from(`subpicture ${i}`)),
      block(ID.SimpleBlock, 6, 0x80, dtsFrame(i)),
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
/** Paths asked for, in order. */
let asked: string[] = []

beforeAll(async () => {
  // Like an IPTV server: movie links redirect to a stream server, which sends the file with byte
  // ranges. Counts open connections.
  server = createServer((req, res) => {
    asked.push(req.url!)
    if (req.url!.startsWith('/movie/')) {
      res.writeHead(302, { Location: req.url!.replace('/movie/', '/stream/') })
      res.end()
      return
    }
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

async function run(url: string, start: number, audio?: number, subtitles?: number[]) {
  const out = new PassThrough()
  const chunks: Buffer[] = []
  out.on('data', (chunk: Buffer) => chunks.push(chunk))
  const job = new Job()
  await remux({ url, start, audio, subtitles }, out, job)
  const output = Buffer.concat(chunks)
  // EBML header, then a Segment of unknown size (4-byte ID, 8-byte size) holding the rest.
  const ebml = children(output)[0]
  const body = output.subarray(encodeId(ID.EBML).length + 1 + ebml.data.length + 12)
  const elements = children(body)
  return {
    tracks: children(elements.find((e) => e.id === ID.Tracks)!.data).map((e) => e.data),
    clusters: elements.filter((e) => e.id === ID.Cluster).map((e) => e.data),
    cues: job.takeCues(),
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
  it('lists the audio and subtitle tracks and finds the cue before a position', async () => {
    const url = newUrl()
    expect(await info(url, 0, new Job())).toEqual({
      start: 0,
      audio: [
        { number: 2, name: 'English', language: 'eng', codec: 'A_OPUS', default: true },
        { number: 3, name: '', language: 'deu', codec: 'A_AC3', default: false },
        { number: 6, name: '', language: 'eng', codec: 'A_DTS', default: false },
      ],
      subtitles: [
        { number: 4, name: '', language: 'eng', codec: 'S_TEXT/UTF8', default: true },
        { number: 5, name: '', language: 'eng', codec: 'S_VOBSUB', default: true, private: VOBSUB_IDX },
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

  it('collects the cues of the chosen subtitle tracks, in movie time', async () => {
    expect((await run(newUrl(), 0)).cues).toEqual([])
    const { cues, clusters } = await run(newUrl(), 15, undefined, [4])
    expect(cues).toEqual([
      { track: 4, start: 10, end: 12.5, text: 'subtitle 1' },
      { track: 4, start: 20, end: 22.5, text: 'subtitle 2' },
    ])
    expect(blocks(clusters[0]).map(([track]) => track)).toEqual([1, 2]) // not in the stream itself
  })

  it('turns DTS into PCM with the channels its frames have, not those the track says', async () => {
    const { tracks, clusters } = await run(newUrl(), 0, 6)
    expect(child(tracks[1], ID.CodecID)!.toString()).toBe('A_PCM/INT/LIT')
    const pcm = child(tracks[1], ID.Audio)!
    expect([uint(child(pcm, ID.Channels)), uint(child(pcm, ID.BitDepth))]).toEqual([6, 16])
    clusters.forEach((cluster) => {
      const [, audio] = blocks(cluster)
      expect(audio[0]).toBe(6)
      expect(audio[1].length).toBe(512 * 6 * 2)
    })
  })

  it('passes DVD subpictures on to the app as they are', async () => {
    const { cues } = await run(newUrl(), 15, undefined, [5])
    expect(cues).toEqual([
      { track: 5, start: 10, data: Buffer.from('subpicture 1').toString('base64') },
      { track: 5, start: 20, data: Buffer.from('subpicture 2').toString('base64') },
    ])
  })

  it('starts at the cue before the position, over one connection at a time, redirected once', async () => {
    mostOpen = 0
    asked = []
    const { clusters } = await run(newUrl(), 15)
    expect(clusters.map((c) => uint(child(c, ID.Timecode)))).toEqual([10000, 20000])
    expect(mostOpen).toBe(1)
    // The header, the cues, the cluster: only the first request goes through the redirect.
    expect(asked.map((path) => path.split('/')[1])).toEqual(['movie', 'stream', 'stream', 'stream'])
  })

  it('starts from the beginning after a header read only up to the tracks (resume, then replay)', async () => {
    const url = newUrl()
    expect((await info(url, 15, new Job())).start).toBe(10)
    const { clusters } = await run(url, 0)
    expect(clusters.map((c) => uint(child(c, ID.Timecode)))).toEqual(CLUSTER_TIMES)
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

describe('contentDecoder', () => {
  const entry = (algorithm: number, settings?: Buffer) =>
    Buffer.concat([
      uintElement(ID.TrackNumber, 5),
      element(ID.ContentEncodings, [element(ID.ContentEncoding, [element(ID.ContentCompression, [uintElement(ID.ContentCompAlgo, algorithm), ...(settings ? [element(ID.ContentCompSettings, [settings])] : [])])])]),
    ])

  it('inflates zlib frames, puts stripped headers back, and leaves plain tracks alone', () => {
    expect(contentDecoder(entry(0))(deflateSync(Buffer.from('subtitle'))).toString()).toBe('subtitle')
    expect(contentDecoder(entry(3, Buffer.from('PG')))(Buffer.from('rest')).toString()).toBe('PGrest')
    expect(contentDecoder(uintElement(ID.TrackNumber, 1))(Buffer.from('as is')).toString()).toBe('as is')
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
