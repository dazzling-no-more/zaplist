import { OpusDecoder } from 'opus-decoder'

export interface OpusHead {
  channels: number
  streamCount: number
  coupledStreamCount: number
  mapping: number[]
}

/** The OpusHead structure that Matroska keeps in the track's CodecPrivate (RFC 7845, section 5.1). */
export function parseOpusHead(data: Buffer): OpusHead {
  if (data.length < 19 || data.toString('latin1', 0, 8) !== 'OpusHead') throw new Error('No Opus header')
  const channels = data[9]
  if (data[18]) return { channels, streamCount: data[19], coupledStreamCount: data[20], mapping: Array.prototype.slice.call(data, 21, 21 + channels) }
  return { channels, streamCount: 1, coupledStreamCount: channels - 1, mapping: channels === 2 ? [0, 1] : [0] }
}

// Opus orders surround channels like Vorbis; Matroska PCM uses the WAVE order (FL FR FC LFE BL BR SL SR).
const WAVE_ORDER: { [channels: number]: number[] } = {
  1: [0],
  2: [0, 1],
  3: [0, 2, 1],
  4: [0, 1, 2, 3],
  5: [0, 2, 1, 3, 4],
  6: [0, 2, 1, 5, 3, 4],
  7: [0, 2, 1, 6, 5, 3, 4],
  8: [0, 2, 1, 7, 5, 6, 3, 4],
}

export const SAMPLE_RATE = 48000

/** Decodes Opus packets to interleaved 16-bit PCM at 48 kHz. Layouts beyond 7.1 are mixed to stereo. */
export class OpusToPcm {
  readonly channels: number
  readonly sampleRate = SAMPLE_RATE
  private readonly decoder: OpusDecoder

  constructor(head: OpusHead) {
    const stereo = !WAVE_ORDER[head.channels]
    this.channels = stereo ? 2 : head.channels
    this.decoder = new OpusDecoder({
      channels: head.channels,
      streamCount: head.streamCount,
      coupledStreamCount: head.coupledStreamCount,
      channelMappingTable: head.mapping,
      forceStereo: stereo,
    })
  }

  get ready(): Promise<void> {
    return this.decoder.ready
  }

  /** A corrupt packet decodes to nothing (a short gap), as in other players. */
  decode(packets: Buffer[]): Buffer {
    const decoded = packets.map((p) => this.decoder.decodeFrame(new Uint8Array(p.buffer, p.byteOffset, p.length)))
    let samples = 0
    for (const d of decoded) samples += d.samplesDecoded
    const pcm = new Int16Array(samples * this.channels)
    const order = WAVE_ORDER[this.channels]
    let i = 0
    for (const d of decoded) {
      for (let s = 0; s < d.samplesDecoded; s++) {
        for (let c = 0; c < this.channels; c++) {
          const v = d.channelData[order[c]][s]
          pcm[i++] = v >= 1 ? 32767 : v <= -1 ? -32768 : Math.round(v * 32767)
        }
      }
    }
    // Int16Array is in the CPU's byte order: little-endian on the TVs' ARM chips, as PCM/INT/LIT needs.
    return Buffer.from(pcm.buffer)
  }

  free(): void {
    this.decoder.free()
  }
}
