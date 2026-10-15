import * as http from 'http'
import * as https from 'https'
import { URL } from 'url' // not a global in Node 8

const USER_AGENT = 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36'
const MAX_REDIRECTS = 5
const MAX_REMEMBERED = 50

/** Where each address was last redirected: IPTV servers pass every request on to a stream server. */
let redirected: { [url: string]: string } = {}
let remembered = 0

/**
 * GETs `url` from byte `from` on with `headers` (a movie's own User-Agent or Referer), following
 * redirects; rejects unless the server sends those bytes. Later requests for `url` go straight to
 * where it redirected (a round trip less for each seek), and through `url` again if that fails.
 */
export async function get(url: string, from = 0, headers: Record<string, string> = {}): Promise<http.IncomingMessage> {
  const target = redirected[url]
  if (target) {
    try {
      return await request(target, from, headers, 0)
    } catch {
      delete redirected[url]
    }
  }
  return request(url, from, headers, MAX_REDIRECTS, (final) => {
    if (final === url) return
    if (++remembered > MAX_REMEMBERED) {
      redirected = {}
      remembered = 1
    }
    redirected[url] = final
  })
}

function request(url: string, from: number, extra: Record<string, string>, redirects: number, onFinal?: (url: string) => void): Promise<http.IncomingMessage> {
  const headers: Record<string, string> = Object.assign({ 'User-Agent': USER_AGENT }, extra)
  if (from > 0) headers.Range = `bytes=${from}-`
  return send(url, headers).then((response) => {
    const status = response.statusCode || 0
    if (status >= 300 && status < 400 && response.headers.location && redirects > 0) {
      response.resume()
      return request(new URL(response.headers.location, url).toString(), from, extra, redirects - 1, onFinal)
    }
    if (status === 206 || (status === 200 && from === 0)) {
      if (onFinal) onFinal(url)
      return response
    }
    // Not drained: a server that ignores Range would send the whole file, holding the provider's
    // connection (often its only one) for as long.
    response.destroy()
    throw new Error(`HTTP ${status}`)
  })
}

/**
 * GETs `url` with `headers` (a stream's own User-Agent or Referer), following redirects; resolves
 * with the last answer, whatever its status, and its address.
 */
export async function open(url: string, headers: Record<string, string>): Promise<{ response: http.IncomingMessage; url: string }> {
  for (let redirects = MAX_REDIRECTS; ; redirects--) {
    const response = await send(url, Object.assign({ 'User-Agent': USER_AGENT }, headers))
    const status = response.statusCode || 0
    const location = response.headers.location
    if (status < 300 || status >= 400 || !location || !redirects) return { response, url }
    response.resume()
    url = new URL(location, url).toString()
  }
}

/** One GET; the answer whatever its status. */
function send(url: string, headers: Record<string, string>): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    // Node 8 (webOS 5 and 6) takes no URL and options together.
    const options = { protocol: target.protocol, hostname: target.hostname, port: target.port, path: target.pathname + target.search, headers }
    const sent = (target.protocol === 'https:' ? https : http).get(options, resolve)
    sent.on('error', reject)
  })
}
