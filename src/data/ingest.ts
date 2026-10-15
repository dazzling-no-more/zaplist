import { savePlaylist } from './db'
import { fetchBytes, fetchJson, LoadError } from './http'
import { parseM3u } from './m3u'
import type { Playlist, Source } from './models'
import { m3uToPlaylist } from './playlist'
import { decodeText } from './text'
import {
  apiUrl,
  parseAccount,
  xtreamToPlaylist,
  xtreamVod,
  XtreamAuthError,
  type XtreamCategory,
  type XtreamLiveStream,
  type XtreamLogin,
  type XtreamSeriesItem,
  type XtreamVodStream,
} from './xtream'
import type { IngestProgress, IngestResult } from '../workers/protocol'

/** Downloads and parses a source, then stores it with its channels. Runs in the worker when possible. */
export async function ingest(source: Source, progress: (p: IngestProgress) => void): Promise<IngestResult> {
  let saved: Source = { ...source, refreshedAt: Date.now() }
  let playlist: Playlist

  if (source.kind === 'm3u') {
    let last = 0
    const bytes = await fetchBytes(source.url, (loaded) => {
      if (Date.now() - last < 250) return
      last = Date.now()
      progress({ stage: 'download', bytes: loaded })
    })
    progress({ stage: 'parse' })
    const parsed = parseM3u(decodeText(bytes))
    if (!parsed.entries.length) throw new LoadError(bytes.length ? 'format' : 'empty')
    playlist = m3uToPlaylist(source.id, parsed)
  } else {
    const account = parseAccount(await fetchJson<XtreamLogin>(apiUrl(source)))
    progress({ stage: 'download' })
    const list = <T>(action: string, required: boolean): Promise<T[]> => {
      const request = fetchJson<T[]>(apiUrl(source, { action })).then((items) => (Array.isArray(items) ? items : []))
      // Movies and series are extras: a server that can't list them still gives its live channels.
      return required ? request : request.catch(() => [])
    }
    const [categories, streams, vodCategories, vodStreams, seriesCategories, seriesList] = await Promise.all([
      list<XtreamCategory>('get_live_categories', true),
      list<XtreamLiveStream>('get_live_streams', true),
      list<XtreamCategory>('get_vod_categories', false),
      list<XtreamVodStream>('get_vod_streams', false),
      list<XtreamCategory>('get_series_categories', false),
      list<XtreamSeriesItem>('get_series', false),
    ])
    progress({ stage: 'parse' })
    const live = xtreamToPlaylist(source, account, categories, streams)
    const vod = xtreamVod(source, vodCategories, vodStreams, seriesCategories, seriesList)
    playlist = { ...live, categories: [...live.categories, ...vod.categories], movies: vod.movies, series: vod.series }
    saved = { ...source, refreshedAt: saved.refreshedAt, account }
  }
  if (!playlist.channels.length && !playlist.movies.length && !playlist.series.length) throw new LoadError('empty')

  progress({ stage: 'save', channels: playlist.channels.length + playlist.movies.length + playlist.series.length })
  await savePlaylist(saved, playlist)
  return {
    source: saved,
    channels: playlist.channels.length,
    movies: playlist.movies.length,
    series: playlist.series.length,
    categories: playlist.categories.length,
  }
}

export function toLoadError(error: unknown): LoadError {
  if (error instanceof LoadError) return error
  if (error instanceof XtreamAuthError) return new LoadError('auth', error.message)
  // IndexedDB is full: TVs give an app tens of megabytes, which a big playlist can fill.
  if ((error as Error)?.name === 'QuotaExceededError') return new LoadError('storage', (error as Error).message)
  return new LoadError('format', String((error as Error)?.message ?? error))
}
