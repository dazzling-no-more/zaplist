// Network helpers shared by the worker and the main thread.

export type LoadErrorCode = 'network' | 'http' | 'timeout' | 'auth' | 'empty' | 'format'

/** A failure the UI can explain; `detail` is extra technical context (status code, server message). */
export class LoadError extends Error {
  constructor(
    readonly code: LoadErrorCode,
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code)
  }
}

const PROXY = '/__proxy/'

/**
 * Desktop browsers block cross-origin requests that the TV allows, so the dev server proxies them
 * (see vite.config.ts) as /__proxy/<scheme>/<host>/<path>: relative URLs inside proxied playlists
 * then resolve to proxied URLs too. Production builds use the URL unchanged.
 */
export function proxied(url: string): string {
  if (!import.meta.env.DEV || url.indexOf(location.origin + PROXY) === 0) return url
  const match = /^(https?):\/\/(.*)$/i.exec(url)
  return match ? PROXY + match[1].toLowerCase() + '/' + match[2] : url
}

const TIMEOUT_MS = 30_000

interface Request {
  response: Response
  /** Restarts the inactivity timeout. */
  touch: () => void
  done: () => void
  timedOut: () => boolean
}

/** fetch that fails after TIMEOUT_MS without progress. */
export async function request(url: string, signal?: AbortSignal): Promise<Request> {
  const controller = new AbortController()
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const touch = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, TIMEOUT_MS)
  }
  const done = () => clearTimeout(timer)
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort)
  touch()
  try {
    const response = await fetch(proxied(url), { signal: controller.signal })
    if (!response.ok) throw new LoadError('http', `HTTP ${response.status}`)
    return { response, touch, done, timedOut: () => timedOut }
  } catch (error) {
    done()
    if (error instanceof LoadError) throw error
    throw new LoadError(timedOut ? 'timeout' : 'network', String((error as Error)?.message ?? error))
  }
}

/** Downloads the whole body, reporting bytes received so far. */
export async function fetchBytes(url: string, onProgress?: (loaded: number) => void, signal?: AbortSignal): Promise<Uint8Array> {
  const { response, touch, done, timedOut } = await request(url, signal)
  try {
    if (!response.body) return new Uint8Array(await response.arrayBuffer())
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let loaded = 0
    for (;;) {
      const { done: finished, value } = await reader.read()
      if (finished) break
      touch()
      chunks.push(value)
      loaded += value.length
      onProgress?.(loaded)
    }
    const bytes = new Uint8Array(loaded)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.length
    }
    return bytes
  } catch (error) {
    if (error instanceof LoadError) throw error
    throw new LoadError(timedOut() ? 'timeout' : 'network', String((error as Error)?.message ?? error))
  } finally {
    done()
  }
}

export async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const bytes = await fetchBytes(url, undefined, signal)
  try {
    return JSON.parse(new TextDecoder('utf-8').decode(bytes)) as T
  } catch {
    throw new LoadError('format', 'Response is not JSON')
  }
}
