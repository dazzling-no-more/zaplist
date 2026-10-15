import * as net from 'net'
import { URL } from 'url' // not a global in Node 8

/** Connecting and the proxy's answers: a proxy that doesn't answer in this long counts as down. */
const TIMEOUT_MS = 15000

/**
 * A connection to `host`:`port` through the SOCKS5 proxy at `proxy` (socks5://user:password@host:port,
 * RFC 1928 with the user name and password of RFC 1929), the proxy looking the host's name up.
 */
export function socksConnect(proxy: string, host: string, port: number): Promise<net.Socket> {
  const server = new URL(proxy)
  const user = Buffer.from(decodeURIComponent(server.username))
  const password = Buffer.from(decodeURIComponent(server.password))
  const name = Buffer.from(host)
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(server.port) || 1080, server.hostname)
    let buffer = Buffer.alloc(0)
    let step: 'method' | 'login' | 'connect' = 'method'
    const fail = (why: string) => {
      socket.destroy()
      reject(new Error(`SOCKS proxy: ${why}`))
    }
    const onError = (error: Error) => fail(error.message)
    const onTimeout = () => fail('no answer')
    const connect = () => {
      const request = Buffer.alloc(7 + name.length)
      request.set([5, 1, 0, 3, name.length])
      name.copy(request, 5)
      request.writeUInt16BE(port, 5 + name.length)
      socket.write(request)
    }
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      if (step === 'method') {
        if (buffer.length < 2) return
        const method = buffer[1]
        buffer = buffer.slice(2)
        if (method === 2 && user.length) {
          step = 'login'
          socket.write(Buffer.concat([Buffer.from([1, user.length]), user, Buffer.from([password.length]), password]))
        } else if (method === 0) {
          step = 'connect'
          connect()
        } else return fail(user.length ? 'it takes neither this login nor none' : 'it needs a user name and password')
      }
      if (step === 'login') {
        if (buffer.length < 2) return
        if (buffer[1] !== 0) return fail('wrong user name or password')
        buffer = buffer.slice(2)
        step = 'connect'
        connect()
      }
      // Reply: version, status, reserved, address type, the address the proxy connected from, port.
      if (buffer.length < 5) return
      const length = 4 + (buffer[3] === 1 ? 4 : buffer[3] === 4 ? 16 : 1 + buffer[4]) + 2
      if (buffer[1] !== 0) return fail(`it couldn't reach ${host} (code ${buffer[1]})`)
      if (buffer.length < length) return
      socket.removeListener('data', onData)
      socket.removeListener('error', onError)
      socket.removeListener('timeout', onTimeout)
      socket.setTimeout(0)
      // The server speaks only after the request: nothing past the reply arrives before HTTP takes over.
      if (buffer.length > length) socket.unshift(buffer.slice(length))
      resolve(socket)
    }
    socket.setTimeout(TIMEOUT_MS)
    socket.on('timeout', onTimeout)
    socket.on('error', onError)
    socket.on('data', onData)
    socket.on('connect', () => socket.write(Buffer.from(user.length ? [5, 2, 0, 2] : [5, 1, 0])))
  })
}
