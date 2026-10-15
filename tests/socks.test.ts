import { createServer, type Server } from 'node:http'
import { connect, createServer as createTcpServer, type AddressInfo, type Server as TcpServer, type Socket } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { get, open } from '../service/fetch'
import { startServer, TOKEN } from '../service/server'

// A stream server that only answers requests coming through the proxy (as one the TV's connection
// can't reach would), behind a SOCKS5 proxy that wants a user name and password.
let upstream: Server
let socks: TcpServer
let origin = ''
let via = ''
let throughProxy = 0
const proxied = new Set<number>() // local ports of the proxy's connections to the stream server

beforeAll(async () => {
  upstream = createServer((req, res) => {
    if (!proxied.has(req.socket.remotePort!)) {
      res.writeHead(403)
      res.end()
      return
    }
    if (req.url === '/live/u/p/1.ts') {
      res.writeHead(302, { Location: '/stream/1.ts' })
      res.end()
    } else if (req.url === '/live/u/p/2.m3u8') {
      res.writeHead(200)
      res.end('#EXTM3U\n#EXTINF:4,\nseg.ts\n')
    } else {
      res.writeHead(200, { 'Content-Type': 'video/mp2t' })
      res.end('stream bytes')
    }
  })
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  origin = `http://localhost:${(upstream.address() as AddressInfo).port}`

  socks = createTcpServer((client: Socket) => {
    let buffer = Buffer.alloc(0)
    let step = 'greeting'
    client.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      if (step === 'greeting' && buffer.length >= 2 + buffer[1]) {
        const offersLogin = Array.from(buffer.subarray(2, 2 + buffer[1])).includes(2)
        buffer = buffer.subarray(2 + buffer[1])
        client.write(Buffer.from([5, offersLogin ? 2 : 0xff]))
        step = 'login'
      }
      if (step === 'login' && buffer.length >= 2 && buffer.length >= 3 + buffer[1] && buffer.length >= 3 + buffer[1] + buffer[2 + buffer[1]]) {
        const user = buffer.subarray(2, 2 + buffer[1]).toString()
        const password = buffer.subarray(3 + buffer[1], 3 + buffer[1] + buffer[2 + buffer[1]]).toString()
        buffer = buffer.subarray(3 + buffer[1] + buffer[2 + buffer[1]])
        const ok = user === 'zap list' && password === 'p@ss:word'
        client.write(Buffer.from([1, ok ? 0 : 1]))
        if (!ok) return client.end()
        step = 'connect'
      }
      if (step === 'connect' && buffer.length >= 5 && buffer.length >= 7 + buffer[4]) {
        const host = buffer.subarray(5, 5 + buffer[4]).toString()
        const port = buffer.readUInt16BE(5 + buffer[4])
        step = 'piping'
        throughProxy++
        const server = connect(port, host === 'localhost' ? '127.0.0.1' : host, () => {
          proxied.add(server.localPort!)
          client.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]))
          client.pipe(server).pipe(client)
        })
        server.on('error', () => client.destroy())
      }
    })
    client.on('error', () => undefined)
  })
  await new Promise<void>((resolve) => socks.listen(0, '127.0.0.1', resolve))
  via = `socks5://zap%20list:p%40ss%3Aword@127.0.0.1:${(socks.address() as AddressInfo).port}`
})
afterAll(() => {
  upstream.close()
  socks.close()
})

const text = (response: NodeJS.ReadableStream) =>
  new Promise<string>((resolve) => {
    let body = ''
    response.on('data', (chunk: Buffer) => (body += chunk.toString()))
    response.on('end', () => resolve(body))
  })

describe('SOCKS5 proxy', () => {
  it('fetches a stream through the proxy, following its redirect there too, with the proxy looking the name up', async () => {
    const before = throughProxy
    const response = await get(`${origin}/live/u/p/1.ts`, 0, {}, via)
    expect(await text(response)).toBe('stream bytes')
    expect(throughProxy - before).toBe(2) // the address, then where it redirected
    expect((await open(`${origin}/live/u/p/1.ts`, {})).response.statusCode).toBe(403) // the same, directly
  })

  it('says when the proxy refuses the login', async () => {
    await expect(get(`${origin}/live/u/p/1.ts`, 0, {}, via.replace('p%40ss', 'wrong'))).rejects.toThrow('SOCKS proxy: wrong user name or password')
  })

  it('serves the TV’s player through the proxy, playlists pointing back with it', async () => {
    const root = `http://127.0.0.1:${await startServer()}/${TOKEN}`
    const through = (url: string) => `${root}/proxy?u=${encodeURIComponent(url)}&h=&p=${encodeURIComponent(via)}`
    expect(await (await fetch(through(`${origin}/live/u/p/1.ts`))).text()).toBe('stream bytes')
    const playlist = await (await fetch(through(`${origin}/live/u/p/2.m3u8`))).text()
    const segment = playlist.split('\n')[2]
    expect(segment).toContain(`&p=${encodeURIComponent(via)}`)
    expect(await (await fetch(`http://127.0.0.1:${new URL(root).port}${segment}`)).text()).toBe('stream bytes')
  })
})
