// LG's app checklist asks that sensitive data saved on the TV be encrypted. Sources (Xtream logins,
// playlist URLs that carry one) are sealed with AES-GCM under a key generated on the TV and kept
// non-extractable in IndexedDB. That protects a copied database, not a TV someone fully controls.
// Stream and guide URLs often contain the same login, so it is replaced by placeholders there.

import type { Source } from './models'

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

const MARK = '\u0001' // can't occur in a URL
const DELIMITERS = /([/?&=#:@])/
const PLACEHOLDER = /\u0001(\d+)\u0001/g

/** The login values a source's URLs can contain, as typed and percent-encoded. */
export function loginParts(source: Source): string[] {
  let parts: (string | null)[] = []
  if (source.kind === 'xtream') parts = [source.username, source.password]
  else {
    try {
      const query = new URL(source.url).searchParams // Xtream-style get.php playlists
      parts = [query.get('username'), query.get('password')]
    } catch {
      // not an absolute URL: nothing to look for
    }
  }
  const values = parts.filter((p): p is string => !!p).flatMap((p) => [p, encodeURIComponent(p)])
  return Array.from(new Set(values))
}

/** Replaces URL path segments and query values equal to a login part with placeholders. */
export function maskUrl(url: string, parts: readonly string[]): string {
  if (!parts.length || url.indexOf(MARK) >= 0) return url
  return url
    .split(DELIMITERS)
    .map((piece, i) => {
      const index = i % 2 === 0 ? parts.indexOf(piece) : -1
      return index >= 0 ? MARK + index + MARK : piece
    })
    .join('')
}

/** Puts the login back into a URL from `maskUrl`. */
export function unmaskUrl(url: string, parts: readonly string[]): string {
  return url.indexOf(MARK) < 0 ? url : url.replace(PLACEHOLDER, (_, index: string) => parts[Number(index)] ?? '')
}
