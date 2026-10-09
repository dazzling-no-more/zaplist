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
  XtreamAuthError,
  type XtreamCategory,
  type XtreamLiveStream,
  type XtreamLogin,
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
    const [categories, streams] = await Promise.all([
      fetchJson<XtreamCategory[]>(apiUrl(source, { action: 'get_live_categories' })),
      fetchJson<XtreamLiveStream[]>(apiUrl(source, { action: 'get_live_streams' })),
    ])
    progress({ stage: 'parse' })
    playlist = xtreamToPlaylist(source, account, Array.isArray(categories) ? categories : [], Array.isArray(streams) ? streams : [])
    if (!playlist.channels.length) throw new LoadError('empty')
    saved = { ...source, refreshedAt: saved.refreshedAt, account }
  }

  progress({ stage: 'save', channels: playlist.channels.length })
  await savePlaylist(saved, playlist)
  return { source: saved, channels: playlist.channels.length, categories: playlist.categories.length }
}

export function toLoadError(error: unknown): LoadError {
  if (error instanceof LoadError) return error
  if (error instanceof XtreamAuthError) return new LoadError('auth', error.message)
  return new LoadError('format', String((error as Error)?.message ?? error))
}
