import * as http from 'http'
import * as https from 'https'
import { URL } from 'url' // not a global in Node 8

const USER_AGENT = 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36'
const MAX_REDIRECTS = 5

/** GETs `url` from byte `from` on, following redirects. Rejects unless the server sends those bytes. */
export function get(url: string, from = 0, redirects = MAX_REDIRECTS): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const headers: Record<string, string> = { 'User-Agent': USER_AGENT }
    if (from > 0) headers.Range = `bytes=${from}-`
    // Node 8 (webOS 5 and 6) takes no URL and options together.
    const options = { protocol: target.protocol, hostname: target.hostname, port: target.port, path: target.pathname + target.search, headers }
    const request = (target.protocol === 'https:' ? https : http).get(options, (response) => {
      const status = response.statusCode || 0
      if (status >= 300 && status < 400 && response.headers.location && redirects > 0) {
        response.resume()
        resolve(get(new URL(response.headers.location, url).toString(), from, redirects - 1))
      } else if (status === 206 || (status === 200 && from === 0)) resolve(response)
      else {
        response.resume()
        reject(new Error(`HTTP ${status}`))
      }
    })
    request.on('error', reject)
  })
}
