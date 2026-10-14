import type { M3uEntry, M3uPlaylist } from './m3u'
import type { Category, Channel, Episode, Movie, Playlist, Series } from './models'
import { hash, normalizeName } from './text'

/** Gives every channel a unique id, keeping ids stable for unchanged entries. */
export function uniqueId(used: Set<string>, base: string): string {
  let id = base
  for (let n = 2; used.has(id); n++) id = `${base}~${n}`
  used.add(id)
  return id
}

/** Channels without a number get consecutive numbers after the highest explicit one. */
export function assignNumbers(channels: { number: number }[]): void {
  let next = channels.reduce((max, c) => Math.max(max, c.number), 0) + 1
  for (const channel of channels) if (!channel.number) channel.number = next++
}

const positiveInt = (value: string | undefined): number => {
  const n = value ? parseInt(value, 10) : NaN
  return n > 0 ? n : 0
}

// Video files rather than live streams. Live streams are HLS, MPEG-TS or extensionless IPTV links.
const VOD_FILE = /\.(mp4|mkv|avi|m4v|mov|wmv|flv|webm|mpe?g|divx|xvid|3gp)$/
// "Name S01 E02", "Name S01E02", "Name - s1e2", "Name 1x02": series name, season, episode.
const EPISODE = /^(.*?)[\s._-]*\b[Ss](\d{1,2})[\s._-]*[Ee](\d{1,4})\b\s*[-–:]?\s*(.*)$/
const EPISODE_X = /^(.*?)[\s._-]*\b(\d{1,2})x(\d{1,3})\b\s*[-–:]?\s*(.*)$/

export type EntryKind = 'live' | 'movie' | 'episode'

/**
 * Xtream-made playlists put movies under /movie/ and series episodes under /series/; elsewhere a video
 * file is a movie, or an episode when its name says S01E02.
 */
export function entryKind(url: string, name: string): EntryKind {
  const path = url.split(/[?#]/)[0].toLowerCase()
  if (path.indexOf('/series/') >= 0) return 'episode'
  if (path.indexOf('/movie/') >= 0) return 'movie'
  if (!VOD_FILE.test(path)) return 'live'
  return EPISODE.test(name) || EPISODE_X.test(name) ? 'episode' : 'movie'
}

/** Series name, season and episode from an episode's name; season 1 and no number when it doesn't say. */
export function parseEpisodeName(name: string): { series: string; season: number; episode: number; title: string } {
  const match = EPISODE.exec(name) ?? EPISODE_X.exec(name)
  if (!match || !match[1].trim()) return { series: name, season: 1, episode: 0, title: name }
  return { series: match[1].trim(), season: parseInt(match[2], 10), episode: parseInt(match[3], 10), title: match[4].trim() }
}

export const byEpisode = (a: Episode, b: Episode): number => a.season - b.season || a.episode - b.episode

export function m3uToPlaylist(sourceId: string, playlist: M3uPlaylist): Playlist {
  const categories = new Map<string, Category>()
  const ids = new Set<string>()
  const channels: Channel[] = []
  const movies: Movie[] = []
  const series = new Map<string, Series>()

  // Live, movie and series categories with the same name stay apart.
  const category = (entry: M3uEntry, kind: EntryKind): string | undefined => {
    const name = entry.attrs['group-title'] || entry.group
    if (!name) return undefined
    const id = `${sourceId}:${kind === 'live' ? 'g' : kind === 'movie' ? 'm' : 's'}:${name}`
    if (!categories.has(id)) categories.set(id, kind === 'live' ? { id, sourceId, name } : { id, sourceId, name, kind: kind === 'movie' ? 'movie' : 'series' })
    return id
  }

  for (const entry of playlist.entries) {
    const { attrs } = entry
    const name = entry.title || attrs['tvg-name'] || entry.url
    const kind = entryKind(entry.url, name)
    const categoryId = category(entry, kind)
    const id = uniqueId(ids, `${sourceId}:${hash(entry.url + '\n' + name)}`)
    if (kind === 'movie') {
      movies.push({ id, sourceId, categoryId, name, poster: attrs['tvg-logo'] || undefined, urls: [entry.url] })
      continue
    }
    if (kind === 'episode') {
      const parsed = parseEpisodeName(name)
      const key = normalizeName(parsed.series) || parsed.series
      let show = series.get(key)
      if (!show) {
        show = { id: `${sourceId}:s:${hash(key)}`, sourceId, categoryId, name: parsed.series, poster: attrs['tvg-logo'] || undefined, episodes: [] }
        series.set(key, show)
      }
      show.poster ??= attrs['tvg-logo'] || undefined
      show.episodes!.push({ id, season: parsed.season, episode: parsed.episode || show.episodes!.length + 1, title: parsed.title, urls: [entry.url] })
      continue
    }
    const shift = parseFloat(attrs['tvg-shift'])
    const catchupDays = positiveInt(attrs['catchup-days'])
    const channel: Channel = {
      id,
      sourceId,
      categoryId,
      name,
      number: positiveInt(attrs['tvg-chno']),
      logo: attrs['tvg-logo'] || undefined,
      tvgId: attrs['tvg-id'] || undefined,
      tvgName: attrs['tvg-name'] || undefined,
      epgShift: shift ? shift : undefined,
      urls: [entry.url],
    }
    if (attrs.catchup || attrs['catchup-source']) {
      channel.catchup = {
        type: attrs.catchup || 'default',
        source: attrs['catchup-source'] || undefined,
        days: catchupDays || undefined,
      }
    }
    if (Object.keys(entry.options).length) channel.options = entry.options
    channels.push(channel)
  }

  assignNumbers(channels)
  const shows = Array.from(series.values())
  for (const show of shows) show.episodes!.sort(byEpisode)
  return { categories: Array.from(categories.values()), channels, movies, series: shows, epgUrls: playlist.epgUrls }
}
