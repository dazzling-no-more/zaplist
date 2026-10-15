import type * as http from 'http'
import { URL, URLSearchParams } from 'url' // not globals in Node 8
import { open } from './fetch'

/** Playlists are small: an answer this large that starts like one is dropped. */
const MAX_PLAYLIST = 4 * 1024 * 1024
/** Answer headers the player needs, passed on. */
const PASSED = ['content-type', 'content-length', 'content-range', 'accept-ranges']

/**
 * Fetches a stream that needs request headers web code can't set (User-Agent, Referer: `headers`,
 * as `Name=value&…`) and passes it on. HLS playlists come back with every address in them pointing
 * here too (`base`: the server's path before /proxy), so the variant playlists, segments and keys are
 * fetched with the headers as well.
 */
export function proxy(base: string, url: string, headers: string, req: http.IncomingMessage, res: http.ServerResponse): void {
  const sent: Record<string, string> = {}
  new URLSearchParams(headers).forEach((value, name) => (sent[name] = value))
  if (req.headers.range) sent.Range = String(req.headers.range)
  let upstream: http.IncomingMessage | undefined
  let closed = false
  // The player let go (another channel): so does the server's connection.
  res.on('close', () => {
    closed = true
    if (upstream) upstream.destroy()
  })
  open(url, sent).then(
    ({ response, url: final }) => {
      upstream = response
      if (closed) return response.destroy()
      response.on('error', () => res.destroy()) // the server's connection broke: so does the player's
      const status = response.statusCode || 502
      const answer: Record<string, string> = {}
      for (const name of PASSED) if (response.headers[name]) answer[name] = String(response.headers[name])
      const empty = () => {
        res.writeHead(status, answer)
        res.end()
      }
      // A playlist is told by its first bytes: servers label them in many ways. The TV's player asks
      // for them from byte 0 on, which some servers answer as a part (206): it is the whole.
      response.once('data', (first: Buffer) => {
        response.removeListener('end', empty)
        response.pause()
        if ((status === 200 || status === 206) && /^\uFEFF?\s*#EXTM3U/.test(first.slice(0, 64).toString('utf8'))) return playlist(response, first, final, base, headers, res)
        res.writeHead(status, answer)
        res.write(first)
        response.pipe(res)
      })
      response.on('end', empty)
    },
    () => {
      res.writeHead(502)
      res.end()
    },
  )
}

function playlist(response: http.IncomingMessage, first: Buffer, url: string, base: string, headers: string, res: http.ServerResponse): void {
  const parts = [first]
  let length = first.length
  response.on('data', (chunk: Buffer) => {
    parts.push(chunk)
    length += chunk.length
    if (length <= MAX_PLAYLIST) return
    response.destroy()
    res.destroy()
  })
  response.on('end', () => {
    const link = (address: string) => `${base}/proxy?u=${encodeURIComponent(address)}&h=${encodeURIComponent(headers)}`
    res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-cache' })
    res.end(rewritePlaylist(Buffer.concat(parts).toString('utf8'), url, link))
  })
  response.resume()
}

/** An HLS playlist with each address (URI lines and URI="…" attributes) made absolute and passed through `link`. */
export function rewritePlaylist(text: string, url: string, link: (address: string) => string): string {
  const resolve = (address: string) => {
    let absolute: string
    try {
      absolute = new URL(address, url).toString()
    } catch {
      return address // not an address: left for the player to reject
    }
    return /^https?:/.test(absolute) ? link(absolute) : address // data: keys stay as they are
  }
  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()
      if (!trimmed) return line
      if (trimmed[0] !== '#') return resolve(trimmed)
      return line.replace(/URI="([^"]*)"/g, (_, address: string) => `URI="${resolve(address)}"`)
    })
    .join('\n')
}
