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
 * GETs `url` from byte `from` on, following redirects; rejects unless the server sends those bytes.
 * Later requests for `url` go straight to where it redirected (a round trip less for each seek), and
 * through `url` again if that fails.
 */
export async function get(url: string, from = 0): Promise<http.IncomingMessage> {
  const target = redirected[url]
  if (target) {
    try {
      return await request(target, from, 0)
    } catch {
      delete redirected[url]
    }
  }
  return request(url, from, MAX_REDIRECTS, (final) => {
    if (final === url) return
    if (++remembered > MAX_REMEMBERED) {
      redirected = {}
      remembered = 1
    }
    redirected[url] = final
  })
}

function request(url: string, from: number, redirects: number, onFinal?: (url: string) => void): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const headers: Record<string, string> = { 'User-Agent': USER_AGENT }
    if (from > 0) headers.Range = `bytes=${from}-`
    // Node 8 (webOS 5 and 6) takes no URL and options together.
    const options = { protocol: target.protocol, hostname: target.hostname, port: target.port, path: target.pathname + target.search, headers }
    const sent = (target.protocol === 'https:' ? https : http).get(options, (response) => {
      const status = response.statusCode || 0
      if (status >= 300 && status < 400 && response.headers.location && redirects > 0) {
        response.resume()
        resolve(request(new URL(response.headers.location, url).toString(), from, redirects - 1, onFinal))
      } else if (status === 206 || (status === 200 && from === 0)) {
        if (onFinal) onFinal(url)
        resolve(response)
      } else {
        response.resume()
        reject(new Error(`HTTP ${status}`))
      }
    })
    sent.on('error', reject)
  })
}
