import { Inflate } from 'pako'
import { saveGuide } from './db'
import { GuideCollector, storedGuideKey, storedWindow } from './guideData'
import { LoadError, request } from './http'
import type { Programme } from './models'
import { XmltvParser, type XmltvHandlers } from './xmltv'

export interface ByteReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>
}

export interface GuideProgress {
  stage: 'download' | 'save'
  /** Bytes received from the current URL. */
  bytes?: number
  /** 1-based index of the URL being read, and how many there are. */
  url?: number
  urls?: number
}

export interface GuideResult {
  channels: number
  programmes: number
  /** URLs that couldn't be read (the others still count). */
  failed: number
}

/** A TextDecoder for the encoding the XML declaration names (UTF-8 if none or unknown). */
function decoderFor(head: Uint8Array): TextDecoder {
  const prolog = String.fromCharCode.apply(null, Array.from(head.subarray(0, 200)))
  const label = /encoding\s*=\s*["']([\w.:-]+)["']/i.exec(prolog)?.[1]
  try {
    return new TextDecoder(label || 'utf-8')
  } catch {
    return new TextDecoder('utf-8')
  }
}

/**
 * Streams XMLTV bytes into `handlers`, gunzipping when the data starts with the gzip magic bytes:
 * with DecompressionStream where the engine has it (Chromium 80+), otherwise with pako.
 */
export async function readXmltv(
  reader: ByteReader,
  handlers: XmltvHandlers,
  options: { nativeGzip?: boolean; onBytes?: (bytes: number) => void } = {},
): Promise<void> {
  const parser = new XmltvParser(handlers)
  let decoder: TextDecoder | undefined
  const text = (bytes: Uint8Array) => {
    decoder ??= decoderFor(bytes)
    parser.feed(decoder.decode(bytes, { stream: true }))
  }
  let loaded = 0
  const next = async () => {
    const result = await reader.read()
    if (!result.done && result.value) options.onBytes?.((loaded += result.value.length))
    return result
  }

  const first = await next()
  if (first.done || !first.value) return
  const gzip = first.value[0] === 0x1f && first.value[1] === 0x8b

  if (!gzip) {
    text(first.value)
    for (let r = await next(); !r.done; r = await next()) text(r.value!)
  } else if (options.nativeGzip ?? typeof DecompressionStream !== 'undefined') {
    const stream = new DecompressionStream('gzip')
    const writer = stream.writable.getWriter()
    const output = stream.readable.getReader()
    const pump = (async () => {
      try {
        await writer.write(first.value as Uint8Array<ArrayBuffer>)
        for (let r = await next(); !r.done; r = await next()) await writer.write(r.value as Uint8Array<ArrayBuffer>)
        await writer.close()
      } catch (error) {
        await writer.abort(error).catch(() => undefined)
        throw error
      }
    })()
    const drain = (async () => {
      for (let r = await output.read(); !r.done; r = await output.read()) text(r.value)
    })()
    await Promise.all([pump, drain])
  } else {
    const inflate = new Inflate()
    inflate.onData = (chunk) => text(chunk)
    inflate.push(first.value, false)
    for (let r = await next(); !r.done; r = await next()) inflate.push(r.value!, false)
    inflate.push(new Uint8Array(0), true)
    if (inflate.err) throw new LoadError('format', inflate.msg || 'gzip')
  }

  if (decoder) parser.feed(decoder.decode())
  parser.end()
}

/** A guide URL and the guide keys wanted from it: those of the channels whose sources use it. */
export interface GuideUrl {
  url: string
  wanted: string[]
}

/** Downloads every guide URL, keeps the programmes of the channels wanted from each, and replaces the stored guide. */
export async function ingestGuide(guides: GuideUrl[], progress: (p: GuideProgress) => void): Promise<GuideResult> {
  const window = storedWindow(Date.now())
  const stored = new Map<string, Programme[]>()
  const kept = { channels: 0, programmes: 0 }
  let failed = 0
  let lastError: LoadError | undefined
  for (let i = 0; i < guides.length; i++) {
    const { url } = guides[i]
    const { response, touch, done, timedOut } = await request(url).catch((error: LoadError) => {
      lastError = error
      return { response: undefined, touch: () => {}, done: () => {}, timedOut: () => false }
    })
    if (!response) {
      failed++
      continue
    }
    let last = 0
    const reader: ByteReader = response.body ? response.body.getReader() : bufferReader(new Uint8Array(await response.arrayBuffer()))
    const collector = new GuideCollector(new Set(guides[i].wanted), window)
    try {
      await readXmltv(reader, collector, {
        onBytes: (bytes) => {
          touch()
          if (Date.now() - last < 250) return
          last = Date.now()
          progress({ stage: 'download', bytes, url: i + 1, urls: guides.length })
        },
      })
    } catch (error) {
      failed++
      lastError = error instanceof LoadError ? error : new LoadError(timedOut() ? 'timeout' : 'network', String((error as Error)?.message ?? error))
    } finally {
      done()
    }
    for (const [key, list] of collector.finish()) stored.set(storedGuideKey(url, key), list)
    kept.channels += collector.kept.channels.size
    kept.programmes += collector.kept.programmes
  }
  if (guides.length && failed === guides.length) throw lastError ?? new LoadError('network')
  progress({ stage: 'save' })
  await saveGuide(stored)
  return { ...kept, failed }
}

function bufferReader(bytes: Uint8Array): ByteReader {
  let sent = false
  return { read: async () => (sent ? { done: true } : ((sent = true), { done: false, value: bytes })) }
}
