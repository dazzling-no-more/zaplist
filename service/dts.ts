import { readFileSync } from 'fs'
import { join } from 'path'

/** FFmpeg's DTS decoder (dts/bridge.c, built by dts/build.sh), kept next to the service. */
const WASM = join(__dirname, 'dts', 'dts.wasm')

type WasmModule = object
type Imports = { [module: string]: { [name: string]: () => number } }
/** The WebAssembly API as used here: Node.js has it, TypeScript declares it only with the DOM's types. */
declare const WebAssembly: {
  compile(bytes: Uint8Array): Promise<WasmModule>
  instantiate(module: WasmModule, imports: Imports): Promise<{ exports: object }>
  Module: { imports(module: WasmModule): Array<{ module: string; name: string; kind: string }> }
}

interface Bridge {
  memory: { buffer: ArrayBuffer }
  _initialize?: () => void
  dts_open(): number
  dts_input(decoder: number, size: number): number
  dts_decode(decoder: number, channels: number): number
  dts_output(decoder: number): number
  dts_channels(decoder: number): number
  dts_rate(decoder: number): number
  dts_close(decoder: number): void
}

let loaded: Promise<Bridge> | undefined

/** The decoder's module, loaded once: its memory (32 MB at least) serves every stream's decoder. */
function load(): Promise<Bridge> {
  if (!loaded) {
    loaded = WebAssembly.compile(readFileSync(WASM))
      .then((module) => WebAssembly.instantiate(module, stubs(module)))
      .then((instance) => {
        const bridge = instance.exports as Bridge
        if (bridge._initialize) bridge._initialize()
        return bridge
      })
  }
  return loaded
}

/**
 * Decodes DTS frames (the core of DTS and DTS-HD streams) to interleaved 16-bit PCM in a WAVE file's
 * channel order. LG's TVs of 2020 and 2021 have no DTS decoder.
 */
export class DtsToPcm {
  /** What decode gives: the track's own numbers until a frame has been decoded, then the stream's. */
  channels: number
  sampleRate: number
  readonly ready: Promise<void>
  private bridge?: Bridge
  private decoder = 0
  /** The channels are settled: by the first frame decoded, or by fix. */
  private known = false

  constructor(channels: number, sampleRate: number) {
    this.channels = channels
    this.sampleRate = sampleRate
    this.ready = load().then((bridge) => {
      this.decoder = bridge.dts_open()
      if (!this.decoder) throw new Error('The DTS decoder did not open')
      this.bridge = bridge
    })
  }

  /** The stream's header now says `channels`: later frames keep to it. */
  fix(): void {
    this.known = true
  }

  /** A corrupt frame decodes to nothing (a short gap), as in other players. */
  decode(frames: Buffer[]): Buffer {
    const bridge = this.bridge
    if (!bridge) return Buffer.alloc(0)
    const parts: Buffer[] = []
    for (const frame of frames) {
      const input = bridge.dts_input(this.decoder, frame.length)
      if (!input) continue
      new Uint8Array(bridge.memory.buffer, input, frame.length).set(frame)
      const samples = bridge.dts_decode(this.decoder, this.known ? this.channels : 0)
      if (samples <= 0) continue
      if (!this.known) {
        this.channels = bridge.dts_channels(this.decoder)
        this.sampleRate = bridge.dts_rate(this.decoder)
        this.known = true
      }
      // Copied out: the next frame reuses the decoder's memory, which may also grow and move.
      parts.push(Buffer.from(new Uint8Array(bridge.memory.buffer, bridge.dts_output(this.decoder), samples * this.channels * 2)))
    }
    return Buffer.concat(parts)
  }

  free(): void {
    if (this.bridge && this.decoder) this.bridge.dts_close(this.decoder)
    this.decoder = 0
  }
}

/** The C library's calls out (files, clock, exit), which the decoder doesn't use: they do nothing. */
function stubs(module: WasmModule): Imports {
  const imports: Imports = {}
  for (const entry of WebAssembly.Module.imports(module)) {
    if (entry.kind !== 'function') continue
    imports[entry.module] = imports[entry.module] || {}
    imports[entry.module][entry.name] = () => 0
  }
  return imports
}
