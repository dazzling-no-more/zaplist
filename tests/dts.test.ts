import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DtsToPcm } from '../service/dts'

/** A 440 Hz tone in 5.1 (front right at half level) by FFmpeg's DTS encoder: three frames of 512 samples. */
const TONE = readFileSync(new URL('./fixtures/tone.dts', import.meta.url))
const frames = [0, 1, 2].map((i) => TONE.subarray(i * 1024, (i + 1) * 1024))

/** Mean absolute sample of one channel of interleaved 16-bit PCM. */
function level(pcm: Buffer, channels: number, channel: number): number {
  let sum = 0
  for (let at = channel * 2; at < pcm.length; at += channels * 2) sum += Math.abs(pcm.readInt16LE(at))
  return sum / (pcm.length / channels / 2)
}

describe('DtsToPcm', () => {
  it('decodes DTS to 16-bit PCM in the channel order of a WAVE file, with the stream’s channels', async () => {
    const dts = new DtsToPcm(8, 48000) // the track says 7.1, as DTS-HD tracks do
    await dts.ready
    const pcm = dts.decode(frames)
    expect([dts.channels, dts.sampleRate, pcm.length]).toEqual([6, 48000, 3 * 512 * 6 * 2])
    const [left, right, center] = [0, 1, 2].map((c) => level(pcm, 6, c))
    expect(left).toBeGreaterThan(1000)
    expect(right / left).toBeCloseTo(0.5, 1)
    expect(center / left).toBeCloseTo(1, 1)
    dts.free()
  })

  it('keeps to the channels the stream’s header gave, and decodes a broken frame to nothing', async () => {
    const dts = new DtsToPcm(8, 48000)
    await dts.ready
    dts.fix() // the header went out before any frame was decoded
    const pcm = dts.decode([frames[0]])
    expect(pcm.length).toBe(512 * 8 * 2)
    expect(level(pcm, 8, 7)).toBe(0) // silent: the stream has six
    expect(dts.decode([Buffer.from('not a DTS frame')]).length).toBe(0)
    dts.free()
  })

  it('closes a decoder freed before the module had loaded (the remux gave up waiting)', async () => {
    const dts = new DtsToPcm(6, 48000)
    dts.free()
    await dts.ready
    expect(dts.decode(frames).length).toBe(0)
  })
})
