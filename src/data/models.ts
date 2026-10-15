// The app's own data model. Parsers map M3U and Xtream data into these shapes; the UI never sees
// source-specific formats.

interface SourceBase {
  id: string
  name: string
  /** XMLTV URL the user entered for this source, used in addition to any the playlist names. */
  epgUrl?: string
  addedAt: number
  refreshedAt?: number
}

export interface M3uSource extends SourceBase {
  kind: 'm3u'
  url: string
}

export interface XtreamSource extends SourceBase {
  kind: 'xtream'
  host: string
  username: string
  password: string
  account?: XtreamAccount
}

export type Source = M3uSource | XtreamSource

export interface XtreamAccount {
  status: string
  /** Epoch ms; absent when the account doesn't expire. */
  expiresAt?: number
  maxConnections?: number
  activeConnections?: number
  trial: boolean
  /** Stream containers the server allows, e.g. ["m3u8", "ts"]. */
  outputFormats: string[]
}

export interface Category {
  id: string
  sourceId: string
  name: string
  /** Movie or series categories; absent for live TV. */
  kind?: 'movie' | 'series'
}

export interface CatchupInfo {
  /** `catchup` attribute (default, append, shift, flussonic, xc, ...). */
  type: string
  /** `catchup-source` URL template. */
  source?: string
  days?: number
}

export interface Channel {
  /** Stable across refreshes as long as the stream URL and name stay the same. */
  id: string
  sourceId: string
  categoryId?: string
  name: string
  number: number
  logo?: string
  /** tvg-id / Xtream epg_channel_id: the XMLTV channel id. */
  tvgId?: string
  tvgName?: string
  /** Hours added to this channel's guide times (M3U tvg-shift). */
  epgShift?: number
  /** Stream URLs to try in order. */
  urls: string[]
  catchup?: CatchupInfo
  /**
   * #EXTVLCOPT / #KODIPROP options. Stored for reference only: web code can't set headers such as
   * User-Agent or Referer, and DRM properties don't apply.
   */
  options?: Record<string, string>
  /** Xtream stream_id, used for the short EPG. */
  streamId?: number
}

export interface Programme {
  /** Epoch ms, as published by the guide (before tvg-shift and the global offset). */
  start: number
  stop: number
  title: string
  description?: string
}

export interface Movie {
  /** Stable across refreshes, like channel ids. */
  id: string
  sourceId: string
  categoryId?: string
  name: string
  poster?: string
  /** Stream URLs to try in order. */
  urls: string[]
  /** Xtream vod_id, for get_vod_info. */
  vodId?: number
}

export interface Episode {
  id: string
  season: number
  episode: number
  title: string
  urls: string[]
  /** Still image of the episode, when the server has one. */
  image?: string
  plot?: string
  /** Seconds, when the server says. */
  duration?: number
}

export interface Series {
  id: string
  sourceId: string
  categoryId?: string
  name: string
  poster?: string
  plot?: string
  /** Release year or date as the server gives it. */
  released?: string
  /** All episodes, for M3U series. Xtream servers list them per series on request (get_series_info). */
  episodes?: Episode[]
  /** Xtream series_id. */
  seriesId?: number
}

/** Details servers can give about a movie (Xtream get_vod_info). */
export interface MovieDetails {
  plot?: string
  released?: string
  /** Seconds. */
  duration?: number
  genre?: string
  cast?: string
  director?: string
  /** A wide image for the page's background. */
  backdrop?: string
  /** Out of 10. */
  rating?: number
}

/** Details servers can give about a series beyond the list (Xtream get_series_info). */
export type SeriesDetails = Pick<MovieDetails, 'backdrop' | 'rating'>

/** One source's channels, movies and series after parsing and mapping. */
export interface Playlist {
  categories: Category[]
  channels: Channel[]
  movies: Movie[]
  series: Series[]
  /** XMLTV URLs named by the source itself (M3U header, Xtream xmltv.php). */
  epgUrls: string[]
}
