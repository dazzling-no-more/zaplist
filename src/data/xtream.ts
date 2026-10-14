import type { Category, Channel, Episode, Movie, MovieDetails, Playlist, Programme, Series, XtreamAccount, XtreamSource } from './models'
import { assignNumbers, byEpisode, uniqueId } from './playlist'

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

export interface XtreamVodStream {
  name?: string
  stream_id?: number | string
  stream_icon?: string
  category_id?: string | number | null
  container_extension?: string
}

export interface XtreamSeriesItem {
  name?: string
  series_id?: number | string
  cover?: string
  plot?: string
  releaseDate?: string
  release_date?: string
  category_id?: string | number | null
}

export interface XtreamEpisode {
  id?: number | string
  episode_num?: number | string
  title?: string
  season?: number | string
  container_extension?: string
  info?: { duration_secs?: number | string; plot?: string; movie_image?: string } | unknown[]
}

export interface XtreamSeriesInfo {
  info?: { plot?: string; cover?: string }
  /** Episodes by season number. */
  episodes?: Record<string, XtreamEpisode[]> | XtreamEpisode[][]
}

export interface XtreamVodInfo {
  info?: {
    plot?: string
    description?: string
    releasedate?: string
    release_date?: string
    duration_secs?: number | string
    genre?: string
    cast?: string
    actors?: string
    director?: string
  }
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

/** A movie or an episode file: /movie/ or /series/ plus the server's container extension. */
export function vodUrl(source: Credentials, path: 'movie' | 'series', id: number, extension: string | undefined): string {
  const ext = (extension || 'mp4').replace(/^\./, '')
  return `${normalizeHost(source.host)}/${path}/${enc(source.username)}/${enc(source.password)}/${id}.${ext}`
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
  return { categories: sorted, channels, movies: [], series: [], epgUrls: [xmltvUrl(source)] }
}

/** Categories in the server's order, only those that have something in them. */
function usedCategories(sourceId: string, prefix: string, kind: 'movie' | 'series', list: XtreamCategory[], used: Set<string>): Category[] {
  const result: Category[] = []
  for (const c of list) {
    if (c.category_id == null || !used.has(String(c.category_id))) continue
    result.push({ id: `${sourceId}:${prefix}:${c.category_id}`, sourceId, name: c.category_name || String(c.category_id), kind })
    used.delete(String(c.category_id))
  }
  // Ids the category list doesn't name still group their items.
  for (const key of Array.from(used)) result.push({ id: `${sourceId}:${prefix}:${key}`, sourceId, name: key, kind })
  return result
}

const categoryKey = (value: string | number | null | undefined): string | undefined =>
  value == null || value === '' ? undefined : String(value)

/** Movies and series from get_vod_streams and get_series, with their categories. */
export function xtreamVod(
  source: XtreamSource,
  vodCategories: XtreamCategory[],
  vodStreams: XtreamVodStream[],
  seriesCategories: XtreamCategory[],
  seriesList: XtreamSeriesItem[],
): Pick<Playlist, 'categories' | 'movies' | 'series'> {
  const movieIds = new Set<string>()
  const usedMovieCategories = new Set<string>()
  const movies: Movie[] = []
  for (const stream of vodStreams) {
    const vodId = toInt(stream.stream_id)
    if (vodId === undefined) continue
    const key = categoryKey(stream.category_id)
    if (key) usedMovieCategories.add(key)
    movies.push({
      id: uniqueId(movieIds, `${source.id}:m:${vodId}`),
      sourceId: source.id,
      categoryId: key && `${source.id}:mc:${key}`,
      name: stream.name || String(vodId),
      poster: stream.stream_icon || undefined,
      urls: [vodUrl(source, 'movie', vodId, stream.container_extension)],
      vodId,
    })
  }

  const seriesIds = new Set<string>()
  const usedSeriesCategories = new Set<string>()
  const series: Series[] = []
  for (const item of seriesList) {
    const seriesId = toInt(item.series_id)
    if (seriesId === undefined) continue
    const key = categoryKey(item.category_id)
    if (key) usedSeriesCategories.add(key)
    series.push({
      id: uniqueId(seriesIds, `${source.id}:s:${seriesId}`),
      sourceId: source.id,
      categoryId: key && `${source.id}:sc:${key}`,
      name: item.name || String(seriesId),
      poster: item.cover || undefined,
      plot: item.plot || undefined,
      released: item.releaseDate || item.release_date || undefined,
      seriesId,
    })
  }

  return {
    categories: [
      ...usedCategories(source.id, 'mc', 'movie', vodCategories, usedMovieCategories),
      ...usedCategories(source.id, 'sc', 'series', seriesCategories, usedSeriesCategories),
    ],
    movies,
    series,
  }
}

/** A series' episodes from get_series_info, in season and episode order. */
export function parseSeriesInfo(source: Credentials & { id: string }, response: XtreamSeriesInfo): Episode[] {
  const groups = response.episodes ? Object.values(response.episodes) : []
  const episodes: Episode[] = []
  for (const group of groups) {
    if (!Array.isArray(group)) continue
    for (const item of group) {
      const id = toInt(item.id)
      if (id === undefined) continue
      const info = item.info && !Array.isArray(item.info) ? item.info : {}
      episodes.push({
        id: `${source.id}:e:${id}`,
        season: toInt(item.season) ?? 1,
        episode: toInt(item.episode_num) ?? episodes.length + 1,
        title: item.title || '',
        urls: [vodUrl(source, 'series', id, item.container_extension)],
        image: info.movie_image || undefined,
        plot: info.plot || undefined,
        duration: toInt(info.duration_secs) || undefined,
      })
    }
  }
  return episodes.sort(byEpisode)
}

export function parseVodInfo(response: XtreamVodInfo): MovieDetails {
  const info = response.info ?? {}
  return {
    plot: info.plot || info.description || undefined,
    released: info.releasedate || info.release_date || undefined,
    duration: toInt(info.duration_secs) || undefined,
    genre: info.genre || undefined,
    cast: info.cast || info.actors || undefined,
    director: info.director || undefined,
  }
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
