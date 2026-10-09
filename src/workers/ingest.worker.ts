// Downloads, parses and stores playlists off the UI thread.
import 'virtual:core-js'
import 'abortcontroller-polyfill/dist/polyfill-patch-fetch'
import { savePlaylist } from '../data/db'
import { fetchBytes, fetchJson, LoadError } from '../data/http'
import { parseM3u } from '../data/m3u'
import type { Playlist, Source } from '../data/models'
import { m3uToPlaylist } from '../data/playlist'
import { decodeText } from '../data/text'
import {
  apiUrl,
  parseAccount,
  xtreamToPlaylist,
  XtreamAuthError,
  type XtreamCategory,
  type XtreamLiveStream,
  type XtreamLogin,
} from '../data/xtream'
import type { IngestProgress, IngestResult, WorkerRequest, WorkerResponse } from './protocol'

const post = (message: WorkerResponse) => (self as unknown as Worker).postMessage(message)

async function ingest(source: Source, progress: (p: IngestProgress) => void): Promise<IngestResult> {
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

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, source } = event.data
  try {
    const result = await ingest(source, (progress) => post({ id, type: 'progress', progress }))
    post({ id, type: 'result', result })
  } catch (error) {
    if (error instanceof LoadError) post({ id, type: 'error', code: error.code, detail: error.detail })
    else if (error instanceof XtreamAuthError) post({ id, type: 'error', code: 'auth', detail: error.message })
    else post({ id, type: 'error', code: 'format', detail: String((error as Error)?.message ?? error) })
  }
}
