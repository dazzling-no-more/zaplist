// opus-decoder 0.7.1 ships types.d.ts, but its package.json "exports" doesn't point TypeScript to it.
// This is the part the service uses, as declared there.
declare module 'opus-decoder' {
  export class OpusDecoder {
    constructor(options?: {
      forceStereo?: boolean
      preSkip?: number
      channels?: number
      streamCount?: number
      coupledStreamCount?: number
      channelMappingTable?: number[]
    })
    ready: Promise<void>
    free: () => void
    decodeFrame: (opusFrame: Uint8Array) => { channelData: Float32Array[]; samplesDecoded: number; errors: unknown[] }
  }
}
