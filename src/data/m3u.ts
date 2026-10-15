// Tolerant M3U / M3U8 playlist parser: BOM, CRLF, lower-case directives, unquoted or missing
// attributes, blank lines, URL lines without #EXTINF, and 50k+ entries. Other lines are skipped.

export interface M3uEntry {
  /** Display name after the comma in #EXTINF, empty when missing. */
  title: string
  url: string
  /** #EXTINF attributes with lower-cased keys (tvg-id, tvg-name, group-title, ...). */
  attrs: Record<string, string>
  /** #EXTGRP group, used when group-title is missing. */
  group?: string
  /** #EXTVLCOPT and #KODIPROP key=value options. */
  options: Record<string, string>
}

export interface M3uPlaylist {
  /** Attributes of the #EXTM3U header line. */
  header: Record<string, string>
  /** XMLTV URLs from url-tvg / x-tvg-url / tvg-url (comma-separated lists allowed). */
  epgUrls: string[]
  entries: M3uEntry[]
}

// key=value with a double-quoted, single-quoted or bare value. Sticky, so it matches at lastIndex.
const ATTRIBUTE = /\s*([^\s=,"']+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s,"']*))/y
// Fallback for junk between attributes: skip one token.
const TOKEN = /\s*[^\s,]+/y
// scheme://… (http, https, rtmp, rtsp, udp, …).
const STREAM_URL = /^[a-z][a-z0-9+.-]*:\/\//i

export function parseAttributes(text: string, start = 0): { attrs: Record<string, string>; end: number } {
  const attrs: Record<string, string> = {}
  let i = start
  while (i < text.length) {
    while (text.charCodeAt(i) === 32 || text.charCodeAt(i) === 9) i++
    if (i >= text.length || text[i] === ',') break
    ATTRIBUTE.lastIndex = i
    const match = ATTRIBUTE.exec(text)
    if (match) {
      attrs[match[1].toLowerCase()] = (match[2] ?? match[3] ?? match[4] ?? '').trim()
      i = ATTRIBUTE.lastIndex
      continue
    }
    TOKEN.lastIndex = i
    if (!TOKEN.exec(text)) break
    i = TOKEN.lastIndex
  }
  return { attrs, end: i }
}

function parseExtinf(body: string): { title: string; attrs: Record<string, string> } {
  const duration = /^\s*-?\d+(?:\.\d+)?/.exec(body)
  const { attrs, end } = parseAttributes(body, duration ? duration[0].length : 0)
  const comma = body.indexOf(',', end)
  return { attrs, title: comma >= 0 ? body.slice(comma + 1).trim() : '' }
}

function addOption(options: Record<string, string>, text: string): void {
  const eq = text.indexOf('=')
  if (eq > 0) options[text.slice(0, eq).trim().toLowerCase()] = text.slice(eq + 1).trim()
}

function splitUrls(value: string | undefined): string[] {
  return value ? value.split(',').map((u) => u.trim()).filter(Boolean) : []
}

const startsWith = (line: string, directive: string) =>
  line.length >= directive.length && line.slice(0, directive.length).toUpperCase() === directive

export function parseM3u(text: string): M3uPlaylist {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const lines = text.split(/\r\n|\n|\r/)
  let header: Record<string, string> = {}
  const entries: M3uEntry[] = []

  let info: { title: string; attrs: Record<string, string> } | undefined
  let group: string | undefined
  let options: Record<string, string> = {}

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (line[0] === '#') {
      if (startsWith(line, '#EXTM3U')) header = parseAttributes(line, 7).attrs
      else if (startsWith(line, '#EXTINF:')) info = parseExtinf(line.slice(8))
      else if (startsWith(line, '#EXTGRP:')) group = line.slice(8).trim() || undefined
      else if (startsWith(line, '#EXTVLCOPT:')) addOption(options, line.slice(11))
      else if (startsWith(line, '#KODIPROP:')) addOption(options, line.slice(10))
      continue
    }
    // Only stream URLs: an error page served in place of the playlist ("Account expired") isn't one.
    if (!STREAM_URL.test(line)) continue
    entries.push({ title: info?.title ?? '', url: line, attrs: info?.attrs ?? {}, group, options })
    info = undefined
    group = undefined
    options = {}
  }

  const epgUrls = [...splitUrls(header['url-tvg']), ...splitUrls(header['x-tvg-url']), ...splitUrls(header['tvg-url'])]
  return { header, epgUrls: Array.from(new Set(epgUrls)), entries }
}
