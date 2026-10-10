import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { newPairing, receive, RELAY_URL } from '../src/data/relay'

// relay/worker.js runs on Cloudflare; here its Durable Object namespace is an in-memory stand-in.
const relay = (await import('../relay/worker.js' as string)) as {
  default: { fetch: (request: Request, env: unknown) => Promise<Response> }
  Session: new (state: { storage: FakeStorage }) => { fetch: (request: Request) => Promise<Response>; alarm: () => Promise<void> }
}

class FakeStorage {
  readonly values = new Map<string, unknown>()
  alarm?: number
  async get(key: string) {
    return this.values.get(key)
  }
  async put(key: string | Record<string, unknown>, value?: unknown) {
    if (typeof key === 'string') this.values.set(key, value)
    else for (const [k, v] of Object.entries(key)) this.values.set(k, v)
  }
  async delete(key: string) {
    this.values.delete(key)
  }
  async deleteAll() {
    this.values.clear()
  }
  async setAlarm(time: number) {
    this.alarm = time
  }
}

let sessions: Map<string, InstanceType<typeof relay.Session>>
const env = {
  SESSIONS: {
    idFromName: (name: string) => name,
    get: (id: string) => {
      if (!sessions.has(id)) sessions.set(id, new relay.Session({ storage: new FakeStorage() }))
      return sessions.get(id)!
    },
  },
}
const call = (path: string, init?: RequestInit) => relay.default.fetch(new Request(`https://add.example.workers.dev${path}`, init), env)
const ID = 'AAAAAAAAAAAAAAAAAAAAAA'

const toBase64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url')

/** What the phone page does with the link's fragment and the form. */
async function sendFromPhone(link: string, entry: object, path = (id: string) => `/s/${id}`) {
  const [id, rawKey] = new URL(link).hash.slice(1).split('.')
  const key = await crypto.subtle.importKey('raw', Buffer.from(rawKey, 'base64url'), 'AES-GCM', false, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(entry))))
  return call(path(id), { method: 'POST', body: JSON.stringify({ iv: toBase64url(iv), data: toBase64url(data) }) })
}

beforeEach(() => {
  sessions = new Map()
})

describe('relay', () => {
  it('hands a message to the TV once, then tells the phone it arrived', async () => {
    expect((await call(`/s/${ID}`, { method: 'POST', body: '{"iv":"a","data":"b"}' })).status).toBe(204)
    expect(await (await call(`/s/${ID}/status`)).json()).toEqual({ delivered: false })

    const delivered = await call(`/s/${ID}`)
    expect(delivered.status).toBe(200)
    expect(delivered.headers.get('access-control-allow-origin')).toBe('*')
    expect(await delivered.text()).toBe('{"iv":"a","data":"b"}')
    expect((await call(`/s/${ID}`)).status).toBe(204)
    expect(await (await call(`/s/${ID}/status`)).json()).toEqual({ delivered: true })
  })

  it('forgets everything when the session expires', async () => {
    await call(`/s/${ID}`, { method: 'POST', body: 'x' })
    const session = sessions.get(ID)!
    await session.alarm()
    expect((await call(`/s/${ID}`)).status).toBe(204)
  })

  it('refuses large bodies, unknown paths and malformed ids', async () => {
    expect((await call(`/s/${ID}`, { method: 'POST', body: 'x'.repeat(9000) })).status).toBe(413)
    expect((await call('/s/short')).status).toBe(404)
    expect((await call('/anything')).status).toBe(404)
  })

  it('serves the phone page without letting it leak the link', async () => {
    const page = await call('/')
    expect(page.headers.get('content-type')).toContain('text/html')
    expect(page.headers.get('referrer-policy')).toBe('no-referrer')
    expect(page.headers.get('content-security-policy')).toContain("connect-src 'self'")
    expect(await page.text()).toContain('Send to TV')
  })
})

describe('add from phone, end to end', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', (input: string) => call(input.slice(RELAY_URL.length)))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('brings what the phone encrypted to the TV, and only the TV can read it', async () => {
    const pairing = await newPairing()
    expect(pairing.link).toMatch(/^https:\/\/add\.zaplist\.workers\.dev\/#[\w-]{22}\.[\w-]{22}$/)
    expect(await receive(pairing)).toBeUndefined() // nothing sent yet

    const entry = { v: 1, kind: 'xtream', name: 'Home', host: 'http://tv.example:8080', username: 'me', password: 'secret', epgUrl: '' }
    expect((await sendFromPhone(pairing.link, entry)).status).toBe(204)
    const stored = sessions.get(pairing.id)!
    expect(JSON.stringify([...(await (stored as unknown as { storage: FakeStorage }).storage.values.values())])).not.toContain('secret')

    expect(await receive(pairing)).toEqual({ kind: 'xtream', name: 'Home', url: '', host: 'http://tv.example:8080', username: 'me', password: 'secret', epgUrl: '' })
    expect(await receive(pairing)).toBeUndefined() // delivered once
  })

  it('ignores messages it cannot decrypt or that are incomplete', async () => {
    const pairing = await newPairing()
    const other = await newPairing()
    await sendFromPhone(other.link, { kind: 'm3u', url: 'http://x' }, () => `/s/${pairing.id}`) // another session's key
    expect(await receive(pairing)).toBeUndefined()
    await sendFromPhone(pairing.link, { kind: 'm3u', url: '' })
    expect(await receive(pairing)).toBeUndefined()
  })
})
