import type { IncomingMessage } from 'http'

// Keeps at most this much read ahead of the remuxer; the server's response is paused beyond it.
const READ_AHEAD = 4 * 1024 * 1024

export interface ElementHeader {
  id: number
  /** -1 (ebml.ts UNKNOWN) for an element of unknown size. */
  size: number
  /** File offset of the element. */
  start: number
}

/** Reads exact byte counts from an HTTP response (Node 8 can't iterate streams with for await). */
export class Reader {
  private chunks: Buffer[] = []
  private buffered = 0
  private need = 0
  private ended = false
  private error?: Error
  private wake?: () => void
  /** Closed here (destroy), not by the server. */
  private destroyed = false

  constructor(
    private readonly stream: IncomingMessage,
    /** File offset of the next byte read. */
    public position: number,
  ) {
    stream.on('data', (chunk: Buffer) => {
      this.chunks.push(chunk)
      this.buffered += chunk.length
      if (this.buffered >= Math.max(READ_AHEAD, this.need)) stream.pause()
      this.notify()
    })
    const end = () => {
      this.ended = true
      this.notify()
    }
    stream.on('end', end)
    stream.on('close', end) // destroyed: a waiting read returns undefined
    // The connection broke before the end: an error, or the player would take it for the end of the
    // movie. Destroying the response here aborts it too.
    stream.on('aborted', () => {
      if (!this.destroyed) this.error = new Error('The connection to the server was lost')
      this.notify()
    })
    stream.on('error', (error: Error) => {
      this.error = error
      this.notify()
    })
  }

  private notify(): void {
    const wake = this.wake
    this.wake = undefined
    if (wake) wake()
  }

  /** Exactly `n` bytes, or undefined if the response ends first. */
  async read(n: number): Promise<Buffer | undefined> {
    this.need = n
    while (this.buffered < n && !this.ended && !this.error) {
      this.stream.resume()
      await new Promise<void>((resolve) => (this.wake = resolve))
    }
    if (this.error) throw this.error
    if (this.buffered < n) return undefined
    const parts: Buffer[] = []
    for (let got = 0; got < n; ) {
      const chunk = this.chunks[0]
      const take = Math.min(chunk.length, n - got)
      parts.push(take === chunk.length ? chunk : chunk.slice(0, take))
      if (take === chunk.length) this.chunks.shift()
      else this.chunks[0] = chunk.slice(take)
      got += take
    }
    this.buffered -= n
    this.need = 0
    this.position += n
    if (this.buffered < READ_AHEAD) this.stream.resume()
    return parts.length === 1 ? parts[0] : Buffer.concat(parts, n)
  }

  /** The next element's ID and size; undefined at the end of the response. */
  async header(): Promise<ElementHeader | undefined> {
    const start = this.position
    const id = await this.vint(4, true)
    const size = id && (await this.vint(8, false))
    if (!id || !size) return undefined
    return { id: id.value, size: size.allOnes ? -1 : size.value, start }
  }

  /** An EBML variable-length integer: an ID keeps its marker bit, a size doesn't. */
  private async vint(maxLength: number, keepMarker: boolean): Promise<{ value: number; allOnes: boolean } | undefined> {
    const first = await this.read(1)
    if (!first) return undefined
    let length = 1
    while (length <= maxLength && !(first[0] & (0x80 >> (length - 1)))) length++
    if (length > maxLength) throw new Error(`Bad element header at ${this.position - 1}`)
    const rest = length > 1 ? await this.read(length - 1) : Buffer.alloc(0)
    if (!rest) return undefined
    let value = keepMarker ? first[0] : first[0] & (0xff >> length)
    let allOnes = value === 0xff >> length
    for (let i = 0; i < rest.length; i++) {
      value = value * 256 + rest[i]
      if (rest[i] !== 0xff) allOnes = false
    }
    return { value, allOnes }
  }

  destroy(): void {
    this.destroyed = true
    this.stream.destroy()
  }
}
