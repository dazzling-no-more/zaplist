import { describe, expect, it, vi } from 'vitest'

// The real engines and Playback against a fake <video>: zapping races happen between them.
vi.mock('../src/platform/webos', () => ({ isWebOS: () => false, deviceInfo: () => undefined }))
vi.mock('../src/data/http', () => ({ proxied: (url: string) => url }))

const { createEngine } = await import('../src/player/engines')
const { Playback } = await import('../src/player/playback')

/** Just enough of HTMLVideoElement for the native engine. */
class FakeVideo extends EventTarget {
  src = ''
  muted = false
  paused = true
  error = null
  textTracks = { length: 0 }
  play(): Promise<void> {
    this.paused = false
    return Promise.resolve()
  }
  pause(): void {
    this.paused = true
  }
  removeAttribute(name: string): void {
    if (name === 'src') this.src = ''
  }
  load(): void {}
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

describe('engines and channel changes', () => {
  it('keeps the new channel playing when the previous one was still starting', async () => {
    const video = new FakeVideo()
    const playback = new Playback(video as unknown as HTMLVideoElement)
    playback.play(['http://a.example/one.m3u8'])
    await flush()
    playback.play(['http://b.example/two.m3u8']) // zap before channel one showed a frame
    await flush()
    video.dispatchEvent(new Event('playing')) // channel two starts
    await flush()
    expect(video.src).toBe('http://b.example/two.m3u8')
    expect(video.paused).toBe(false)
    expect(playback.getStatus()).toEqual({ state: 'playing' })
  })

  it('ends a pending start on destroy and never touches the video afterwards', async () => {
    const video = new FakeVideo()
    const engine = createEngine({ url: 'http://a.example/one.m3u8', engine: 'native' }, video as unknown as HTMLVideoElement)
    const start = engine.start()
    engine.destroy()
    await expect(start).rejects.toMatchObject({ detail: 'cancelled' })

    video.src = 'http://b.example/two.m3u8' // another engine's stream
    void video.play()
    engine.destroy()
    video.dispatchEvent(new Event('playing'))
    await flush()
    expect(video.src).toBe('http://b.example/two.m3u8')
    expect(video.paused).toBe(false)
  })
})
