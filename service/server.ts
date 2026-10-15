import { randomBytes } from 'crypto'
import * as http from 'http'
import type { AddressInfo } from 'net'
import { URL, URLSearchParams } from 'url' // not globals in Node 8
import { proxy } from './proxy'
import { info, Job, remux } from './remux'

// The TV's player streams movies through this server, on the TV's loopback address only:
//   /info?u=<movie URL>&t=<seconds>                JSON { start, audio, subtitles: [{ number, label, codec, default }] }
//   /remux?u=<movie URL>&t=<start>&a=<track>&s=<subtitle tracks, comma-separated>
//                                                  the movie as Matroska with PCM audio
//   (/info and /remux also take &h=<headers, Name=value&…>: request headers the movie needs)
//   /subs                                          JSON { cues }: subtitle cues of /remux read since the last call
//   /proxy?u=<stream URL>&h=<headers, Name=value&…> the stream fetched with those headers
// /info and /remux stop the stream before them (a seek or another movie): one connection to the IPTV server.
// Every path starts with /<TOKEN>.

/**
 * In every address the server answers: only the app learns it (from `start`, over the Luna bus), not
 * a web page open in the TV's browser, which can reach the loopback address too.
 */
export const TOKEN = randomBytes(16).toString('hex')

let listening: Promise<number> | undefined
let current: Job | undefined

/** Starts the server once; resolves with its port. */
export function startServer(): Promise<number> {
  if (!listening) {
    listening = new Promise((resolve, reject) => {
      const server = http.createServer(handle)
      server.on('error', reject)
      server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port))
    })
  }
  return listening
}

/** Stops the stream playing now, if any. */
export function stopPlayback(): void {
  if (current) current.stop()
  current = undefined
}

/**
 * Asked by the app (a file:// page: Origin "null", no Referer) or the TV's player, not by a web page:
 * a second check besides the token, for pages that send their origin.
 */
function fromApp(req: http.IncomingMessage): boolean {
  const origin = req.headers.origin
  const referer = String(req.headers.referer || '')
  return (!origin || origin === 'null' || origin === 'file://') && (!referer || referer.indexOf('file:') === 0)
}

function handle(req: http.IncomingMessage, res: http.ServerResponse): void {
  const { pathname: path, searchParams: query } = new URL(req.url || '', 'http://127.0.0.1')
  if (path.indexOf(`/${TOKEN}/`) !== 0 || !fromApp(req)) {
    res.writeHead(403)
    res.end()
    return
  }
  const pathname = path.slice(TOKEN.length + 1)
  if (pathname === '/subs') return send(res, 200, { cues: current ? current.takeCues() : [] })
  const url = query.get('u')
  if (pathname === '/proxy' && url) return proxy(`/${TOKEN}`, url, query.get('h') || '', req, res)
  if ((pathname !== '/info' && pathname !== '/remux') || !url) {
    res.writeHead(404)
    res.end()
    return
  }
  // The stream has no byte positions to jump to; the app seeks by asking for a new stream.
  const range = /bytes=(\d+)-/.exec(String(req.headers.range || ''))
  if (range && Number(range[1]) > 0) {
    res.writeHead(416)
    res.end()
    return
  }
  stopPlayback()
  const headers: Record<string, string> = {}
  new URLSearchParams(query.get('h') || '').forEach((value, name) => (headers[name] = value))
  const job = (current = new Job(headers))
  res.on('close', () => job.stop())
  const start = Number(query.get('t')) || 0
  if (pathname === '/info') {
    info(url, start, job).then(
      (result) => send(res, 200, result),
      (error: Error) => send(res, 502, { error: error.message }),
    )
    // Its connection to the IPTV server isn't needed after the answer.
    res.on('finish', () => job.stop())
    return
  }
  res.writeHead(200, { 'Content-Type': 'video/x-matroska', 'Cache-Control': 'no-cache' })
  const subtitles = (query.get('s') || '').split(',').map(Number).filter(Boolean)
  remux({ url, start, audio: Number(query.get('a')) || undefined, subtitles }, res, job).then(
    () => res.end(),
    () => res.destroy(), // the player sees the stream break and reports it
  )
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
  res.end(JSON.stringify(body))
}
