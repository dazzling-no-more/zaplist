// LG's app checklist asks that sensitive data saved on the TV be encrypted. Everything that can carry a
// login (sources, cached stream and guide URLs, the PIN) is sealed with AES-GCM under a key generated
// on the TV and kept non-extractable in IndexedDB (db.ts). That protects a copied database, not a TV
// someone fully controls.
//
// Values are compressed before they are encrypted: TVs give apps little storage (48 MB on a webOS 6
// set), and playlists, full of repeated server addresses and logins, shrink several times.

import { deflate, inflate } from 'pako'

export interface Sealed {
  iv: Uint8Array<ArrayBuffer>
  data: ArrayBuffer
  /** Deflated before encryption; absent in what older versions stored. */
  z?: 1
}

/** Web Crypto exists only in secure contexts: on the TV (file://) and on localhost, not over a LAN address. */
export const canSeal = (): boolean => typeof crypto === 'object' && !!crypto.subtle

export const newVaultKey = (): Promise<CryptoKey> =>
  crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])

export async function seal(key: CryptoKey, value: unknown): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, pack(value))
  return { iv, data, z: 1 }
}

export async function unseal<T>(key: CryptoKey, sealed: Sealed): Promise<T> {
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.iv }, key, sealed.data))
  return sealed.z ? unpack<T>(plain) : (JSON.parse(new TextDecoder().decode(plain)) as T)
}

/** JSON, deflated. Level 4 is several times faster than the default and nearly as small for this data. */
export const pack = (value: unknown): Uint8Array<ArrayBuffer> => deflate(new TextEncoder().encode(JSON.stringify(value)), { level: 4 }) as Uint8Array<ArrayBuffer>

export const unpack = <T>(bytes: Uint8Array): T => JSON.parse(new TextDecoder().decode(inflate(bytes))) as T
