/**
 * "Add from your phone": the TV shows a link (as a QR code) to the relay's page, with a session id
 * and a fresh AES key in its #fragment. The phone page encrypts the playlist the user enters with
 * that key and leaves it at the relay (relay/worker.js); the TV fetches and decrypts it. The key only
 * travels in the QR code, so the relay never sees the playlist.
 */
export const RELAY_URL: string = (import.meta.env.DEV && import.meta.env.VITE_RELAY_URL) || 'https://add.zaplist.workers.dev'

/** What the phone page sends: the fields of the "Add a source" form. */
export interface PhoneEntry {
  kind: 'm3u' | 'xtream'
  name: string
  url: string
  host: string
  username: string
  password: string
  epgUrl: string
}

export interface Pairing {
  id: string
  key: CryptoKey
  /** The phone page's address, for the QR code. */
  link: string
}

const MAX_FIELD = 4096

export const canPair = (): boolean => typeof crypto === 'object' && !!crypto.subtle && typeof fetch === 'function'

function toBase64url(bytes: Uint8Array): string {
  let text = ''
  for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i])
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export async function newPairing(): Promise<Pairing> {
  const id = toBase64url(crypto.getRandomValues(new Uint8Array(16)))
  const raw = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt'])
  return { id, key, link: `${RELAY_URL}/#${id}.${toBase64url(raw)}` }
}

function parseEntry(value: unknown): PhoneEntry | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const fields = value as Record<string, unknown>
  const text = (name: string) => (typeof fields[name] === 'string' ? (fields[name] as string).slice(0, MAX_FIELD) : '')
  const kind = fields.kind
  if (kind !== 'm3u' && kind !== 'xtream') return undefined
  const entry: PhoneEntry = { kind, name: text('name'), url: text('url'), host: text('host'), username: text('username'), password: text('password'), epgUrl: text('epgUrl') }
  return (kind === 'm3u' ? entry.url : entry.host && entry.username && entry.password) ? entry : undefined
}

/** Fetches what the phone sent, once. Undefined while nothing has arrived, or if it isn't readable. */
export async function receive(pairing: Pairing): Promise<PhoneEntry | undefined> {
  const response = await fetch(`${RELAY_URL}/s/${pairing.id}`)
  if (response.status !== 200) return undefined
  try {
    const { iv, data } = (await response.json()) as { iv: string; data: string }
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64url(iv) }, pairing.key, fromBase64url(data))
    return parseEntry(JSON.parse(new TextDecoder().decode(plain)))
  } catch {
    return undefined // not encrypted with this session's key
  }
}
