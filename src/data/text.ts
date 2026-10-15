/**
 * Decodes playlist bytes as UTF-8, falling back to Windows-1252 for files that aren't valid UTF-8.
 * A UTF-8 byte-order mark settles it: such files decode as UTF-8 with invalid bytes replaced.
 */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

/** Short, stable 32-bit FNV-1a hash in base 36. */
export function hash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/**
 * Lower-case, accents removed, only letters and digits: for search and guide name matching. Letters
 * are a-z plus those of the other scripts channel names use (Latin extensions, Greek, Cyrillic,
 * Armenian, Hebrew, Arabic, Indic, Thai, Georgian, Vietnamese, kana, CJK, Hangul and the jamo NFD
 * splits its syllables into), listed as ranges because \p{L} is ES2018. Everything else goes: punctuation, symbols, emoji, ᴴᴰ-style modifiers.
 */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(
      /[^a-z0-9\u00df-\u00f6\u00f8-\u024f\u0370-\u03ff\u0400-\u052f\u0531-\u058f\u05d0-\u05ea\u0620-\u064a\u0660-\u0669\u066e-\u06d3\u06f0-\u06ff\u0900-\u0dff\u0e01-\u0e5b\u10a0-\u10ff\u1100-\u11ff\u1e00-\u1fff\u3041-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7a3]+/g,
      '',
    )
}
