// LG's app checklist asks that sensitive data saved on the TV be encrypted. Everything that can carry a
// login (sources, cached stream and guide URLs, the PIN) is sealed with AES-GCM under a key generated
// on the TV and kept non-extractable in IndexedDB (db.ts). That protects a copied database, not a TV
// someone fully controls.

export interface Sealed {
  iv: Uint8Array<ArrayBuffer>
  data: ArrayBuffer
}

/** Web Crypto exists only in secure contexts: on the TV (file://) and on localhost, not over a LAN address. */
export const canSeal = (): boolean => typeof crypto === 'object' && !!crypto.subtle

export const newVaultKey = (): Promise<CryptoKey> =>
  crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])

export async function seal(key: CryptoKey, value: unknown): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value)))
  return { iv, data }
}

export async function unseal<T>(key: CryptoKey, sealed: Sealed): Promise<T> {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.iv }, key, sealed.data)
  return JSON.parse(new TextDecoder().decode(plain)) as T
}
