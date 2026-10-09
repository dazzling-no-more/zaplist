import type { Category, Channel, Playlist, Programme, XtreamAccount, XtreamSource } from './models'
import { assignNumbers, uniqueId } from './playlist'

// Xtream Codes player_api.php responses. Panels differ, so every field is optional and loosely typed.
export interface XtreamLogin {
  user_info?: {
    auth?: number | string | boolean
    status?: string
    exp_date?: string | number | null
    max_connections?: string | number
    active_cons?: string | number
    is_trial?: string | number
    allowed_output_formats?: string[]
    message?: string
  }
  server_info?: Record<string, unknown>
}

export interface XtreamCategory {
  category_id?: string | number
  category_name?: string
}

export interface XtreamLiveStream {
  num?: number | string
  name?: string
  stream_id?: number | string
  stream_icon?: string
  epg_channel_id?: string | null
  category_id?: string | number | null
  tv_archive?: number | string
  tv_archive_duration?: number | string
}

export interface XtreamShortEpg {
  epg_listings?: {
    title?: string
    description?: string
    start_timestamp?: string | number
    stop_timestamp?: string | number
  }[]
}

type Credentials = Pick<XtreamSource, 'host' | 'username' | 'password'>

/** Accepts "host:port", full URLs, or a pasted player_api.php / get.php link; returns scheme://host[:port][/path]. */
export function normalizeHost(input: string): string {
  let host = input.trim()
  if (!/^https?:\/\//i.test(host)) host = 'http://' + host
  host = host.replace(/[?#].*$/, '')
  host = host.replace(/\/(player_api|get|xmltv|panel_api)\.php$/i, '')
  return host.replace(/\/+$/, '')
}

const enc = encodeURIComponent

export function apiUrl(source: Credentials, params: Record<string, string | number> = {}): string {
  let url = `${normalizeHost(source.host)}/player_api.php?username=${enc(source.username)}&password=${enc(source.password)}`
  for (const key of Object.keys(params)) url += `&${key}=${enc(String(params[key]))}`
  return url
}

export function xmltvUrl(source: Credentials): string {
  return `${normalizeHost(source.host)}/xmltv.php?username=${enc(source.username)}&password=${enc(source.password)}`
}

/** HLS first when the server allows it, MPEG-TS as the fallback. */
export function liveUrls(source: Credentials, streamId: number, outputFormats: string[]): string[] {
  const base = `${normalizeHost(source.host)}/live/${enc(source.username)}/${enc(source.password)}/${streamId}`
  const allowed = (format: string) => !outputFormats.length || outputFormats.indexOf(format) >= 0
  const urls: string[] = []
  if (allowed('m3u8')) urls.push(`${base}.m3u8`)
  if (allowed('ts') || !urls.length) urls.push(`${base}.ts`)
  return urls
}

const toInt = (value: unknown): number | undefined => {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10)
  return isFinite(n) ? n : undefined
}

export class XtreamAuthError extends Error {}

/** Reads the login response; throws XtreamAuthError when the server rejects the credentials. */
export function parseAccount(login: XtreamLogin): XtreamAccount {
  const info = login.user_info
  if (!info || (info.auth !== true && String(info.auth) !== '1')) throw new XtreamAuthError(info?.message || 'Login rejected')
  const expires = toInt(info.exp_date)
  return {
    status: info.status || 'Active',
    // Panels send 0, negative or missing values for accounts that don't expire.
    expiresAt: expires && expires > 0 ? expires * 1000 : undefined,
    maxConnections: toInt(info.max_connections),
    activeConnections: toInt(info.active_cons),
    trial: String(info.is_trial) === '1',
    outputFormats: Array.isArray(info.allowed_output_formats) ? info.allowed_output_formats : [],
  }
}

export function xtreamToPlaylist(
  source: XtreamSource,
  account: XtreamAccount,
  categoryList: XtreamCategory[],
  streams: XtreamLiveStream[],
): Playlist {
  const names = new Map<string, string>()
  for (const c of categoryList) {
    if (c.category_id != null) names.set(String(c.category_id), c.category_name || String(c.category_id))
  }
  const categories = new Map<string, Category>()
  const ids = new Set<string>()
  const channels: Channel[] = []

  for (const stream of streams) {
    const streamId = toInt(stream.stream_id)
    if (streamId === undefined) continue
    let categoryId: string | undefined
    if (stream.category_id != null && stream.category_id !== '') {
      const key = String(stream.category_id)
      categoryId = `${source.id}:c:${key}`
      if (!categories.has(categoryId)) {
        categories.set(categoryId, { id: categoryId, sourceId: source.id, name: names.get(key) || key })
      }
    }
    const archiveDays = toInt(stream.tv_archive_duration)
    channels.push({
      id: uniqueId(ids, `${source.id}:${streamId}`),
      sourceId: source.id,
      categoryId,
      name: stream.name || String(streamId),
      number: Math.max(toInt(stream.num) || 0, 0),
      logo: stream.stream_icon || undefined,
      tvgId: stream.epg_channel_id || undefined,
      urls: liveUrls(source, streamId, account.outputFormats),
      catchup: String(stream.tv_archive) === '1' ? { type: 'xc', days: archiveDays || undefined } : undefined,
      streamId,
    })
  }

  // Keep the server's category order.
  const order = new Map(categoryList.map((c, i) => [`${source.id}:c:${c.category_id}`, i]))
  const sorted = Array.from(categories.values()).sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9))
  assignNumbers(channels)
  return { categories: sorted, channels, epgUrls: [xmltvUrl(source)] }
}

/** Base64 (UTF-8) as used by get_short_epg titles and descriptions. */
export function decodeBase64Utf8(value: string): string {
  try {
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return new TextDecoder('utf-8').decode(bytes)
  } catch {
    return value
  }
}

export function parseShortEpg(response: XtreamShortEpg): Programme[] {
  const programmes: Programme[] = []
  for (const item of response.epg_listings ?? []) {
    const start = toInt(item.start_timestamp)
    const stop = toInt(item.stop_timestamp)
    if (start === undefined || stop === undefined) continue
    programmes.push({
      start: start * 1000,
      stop: stop * 1000,
      title: decodeBase64Utf8(item.title ?? ''),
      description: item.description ? decodeBase64Utf8(item.description) : undefined,
    })
  }
  return programmes.sort((a, b) => a.start - b.start)
}
