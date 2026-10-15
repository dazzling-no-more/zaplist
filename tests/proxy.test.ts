import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { rewritePlaylist } from '../service/proxy'
import { startServer, TOKEN } from '../service/server'

// An HLS server that, like some public streams, refuses requests without its Referer: the channel
// redirects to a CDN whose playlists name the variant, the segments and the key relatively.
const REFERER = 'https://site.example/'
const HEADERS = `Referer=${encodeURIComponent(REFERER)}&User-Agent=Test%2F1.0`
let upstream: Server
let origin = ''
/** The service: its address, and with its token. */
let root = ''
let proxy = ''
let agents: string[] = []

beforeAll(async () => {
  upstream = createServer((req, res) => {
    agents.push(String(req.headers['user-agent']))
    if (req.headers.referer !== REFERER) {
      res.writeHead(403)
      res.end()
      return
    }
    if (req.url === '/live/channel.m3u8') {
      res.writeHead(302, { Location: '/cdn/master.m3u8' })
      res.end()
    } else if (req.url === '/cdn/master.m3u8') {
      // Labelled wrongly (told by its content), and a part when asked from byte 0 on, as the TV's player does.
      res.writeHead(req.headers.range ? 206 : 200, { 'Content-Type': 'text/plain' })
      res.end('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nvariant/index.m3u8\n')
    } else if (req.url === '/cdn/variant/index.m3u8') {
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' })
      res.end('#EXTM3U\r\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\r\n#EXTINF:4,\r\nseg1.ts\r\n')
    } else if (req.url === '/cdn/variant/seg1.ts') {
      res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Content-Length': '11' })
      res.end('segment one')
    } else {
      res.writeHead(404)
      res.end()
    }
  })
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`
  root = `http://127.0.0.1:${await startServer()}`
  proxy = `${root}/${TOKEN}`
})
afterAll(() => upstream.close())

const through = (url: string, headers = HEADERS) => `${proxy}/proxy?u=${encodeURIComponent(url)}&h=${encodeURIComponent(headers)}`
/** The addresses in a playlist the proxy sent. */
const addresses = (text: string) => text.split(/\r?\n/).map((line) => (line.startsWith('#') ? /URI="([^"]*)"/.exec(line)?.[1] : line)).filter(Boolean) as string[]

describe('proxy', () => {
  it('fetches a stream with its headers, and points its playlists back at itself', async () => {
    agents = []
    const answer = await fetch(through(`${origin}/live/channel.m3u8`), { headers: { Range: 'bytes=0-' } })
    expect(answer.status).toBe(200)
    const [variant] = addresses(await answer.text())
    expect(variant).toBe(`/${TOKEN}/proxy?u=${encodeURIComponent(`${origin}/cdn/variant/index.m3u8`)}&h=${encodeURIComponent(HEADERS)}`)

    const media = await fetch(root + variant)
    expect(media.headers.get('content-type')).toBe('application/vnd.apple.mpegurl')
    const [key, segment] = addresses(await media.text())
    expect(decodeURIComponent(key)).toContain(`${origin}/cdn/variant/key.bin`)

    const data = await fetch(root + segment)
    expect([data.status, data.headers.get('content-type'), await data.text()]).toEqual([200, 'video/mp2t', 'segment one'])
    expect(new Set(agents)).toEqual(new Set(['Test/1.0']))
  })

  it('passes the server’s refusal on when the headers are wrong', async () => {
    expect((await fetch(through(`${origin}/live/channel.m3u8`, 'Referer=https%3A%2F%2Fother%2F'))).status).toBe(403)
  })

  it('makes every address absolute, leaving data: keys alone', () => {
    const text = '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="data:text/plain;base64,AAAA"\n#EXT-X-MAP:URI="../init.mp4"\nhttps://cdn.example/x.ts\n'
    expect(rewritePlaylist(text, 'http://h/a/b/index.m3u8', (url) => `<${url}>`)).toBe(
      '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="data:text/plain;base64,AAAA"\n#EXT-X-MAP:URI="<http://h/a/init.mp4>"\n<https://cdn.example/x.ts>\n',
    )
  })
})
