import { useSyncExternalStore } from 'react'
import { deleteSource, getChannelChunk, getPlaylistMeta, getSources, getVodChunk, rebuildDatabase } from './db'
import { fetchJson } from './http'
import type { Category, Channel, Episode, Movie, MovieDetails, Series, SeriesDetails, Source } from './models'
import { loadSecretPrefs } from './prefs'
import { ingestSource } from './worker'
import { apiUrl, parseSeriesDetails, parseSeriesInfo, parseVodInfo, type XtreamSeriesInfo, type XtreamVodInfo } from './xtream'
import type { IngestProgress } from '../workers/protocol'

interface SourceData {
  categories: Category[]
  channels: Channel[]
  movies: Movie[]
  series: Series[]
  epgUrls: string[]
}

export interface LibraryState {
  /** False until the cached playlists have been read from IndexedDB. */
  ready: boolean
  sources: Source[]
  /** Categories (live, movie and series), channels, movies and series of all sources, in source order. */
  categories: Category[]
  channels: Channel[]
  movies: Movie[]
  series: Series[]
  /** Refreshes in progress, by source id. */
  progress: Record<string, IngestProgress>
  /** Set when the stored data couldn't be read at startup. */
  error?: unknown
}

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

class Library {
  private state: LibraryState = { ready: false, sources: [], categories: [], channels: [], movies: [], series: [], progress: {} }
  private readonly data = new Map<string, SourceData>()
  private byId = new Map<string, Channel>()
  private moviesById = new Map<string, Movie>()
  private seriesById = new Map<string, Series>()
  /** Xtream series (episodes and details) and movie details, fetched when first opened. */
  private readonly seriesInfo = new Map<string, Promise<{ episodes: Episode[]; details: SeriesDetails }>>()
  private readonly details = new Map<string, Promise<MovieDetails>>()
  private readonly listeners = new Set<() => void>()
  private initializing: Promise<void> | undefined
  /** Per source, the end of its queue of saves and deletion. */
  private readonly tasks = new Map<string, Promise<unknown>>()
  /** Sources deleted in this session: saves still queued or downloading for them must not bring them back. */
  private readonly removed = new Set<string>()

  getState = (): LibraryState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  channel(id: string): Channel | undefined {
    return this.byId.get(id)
  }

  movie(id: string): Movie | undefined {
    return this.moviesById.get(id)
  }

  series(id: string): Series | undefined {
    return this.seriesById.get(id)
  }

  /** A series' episodes: from the playlist (M3U), or asked from the Xtream server the first time. */
  episodes(series: Series): Promise<Episode[]> {
    if (series.episodes) return Promise.resolve(series.episodes)
    return this.xtreamSeries(series).then((info) => info.episodes)
  }

  /** Backdrop and rating of an Xtream series, from the same request as its episodes; empty for M3U series. */
  seriesDetails(series: Series): Promise<SeriesDetails> {
    if (series.episodes) return Promise.resolve({})
    return this.xtreamSeries(series).then((info) => info.details)
  }

  private xtreamSeries(series: Series): Promise<{ episodes: Episode[]; details: SeriesDetails }> {
    const source = this.state.sources.find((s) => s.id === series.sourceId)
    if (!source || source.kind !== 'xtream' || series.seriesId === undefined) return Promise.resolve({ episodes: [], details: {} })
    let request = this.seriesInfo.get(series.id)
    if (!request) {
      request = fetchJson<XtreamSeriesInfo>(apiUrl(source, { action: 'get_series_info', series_id: series.seriesId })).then((info) => ({
        episodes: parseSeriesInfo(source, info),
        details: parseSeriesDetails(info),
      }))
      this.seriesInfo.set(series.id, request)
      request.catch(() => this.seriesInfo.delete(series.id)) // try again next time
    }
    return request
  }

  /** Plot, year and so on for an Xtream movie; empty for M3U movies, whose playlists don't say. */
  movieDetails(movie: Movie): Promise<MovieDetails> {
    const source = this.state.sources.find((s) => s.id === movie.sourceId)
    if (!source || source.kind !== 'xtream' || movie.vodId === undefined) return Promise.resolve({})
    let request = this.details.get(movie.id)
    if (!request) {
      request = fetchJson<XtreamVodInfo>(apiUrl(source, { action: 'get_vod_info', vod_id: movie.vodId })).then(parseVodInfo)
      this.details.set(movie.id, request)
      request.catch(() => this.details.delete(movie.id))
    }
    return request
  }

  /** Guide URLs named by a source's playlist itself. */
  epgUrls(sourceId: string): string[] {
    return this.data.get(sourceId)?.epgUrls ?? []
  }

  /** Reads all cached sources. Chunks load with yields in between so the UI keeps responding. */
  init(): Promise<void> {
    this.initializing ??= (async () => {
      // The PIN first: it decides which categories may be shown at all.
      await loadSecretPrefs()
      const sources = await getSources()
      const uncached: Source[] = []
      for (const source of sources) if (!(await this.load(source))) uncached.push(source)
      this.set({ ready: true, error: undefined, sources, ...this.combine(sources) })
      // Channel lists a storage upgrade dropped download again, in the background.
      for (const source of uncached) void this.save(source).catch(() => undefined)
    })().catch((error: unknown) => {
      this.initializing = undefined
      this.set({ error })
      throw error
    })
    return this.initializing
  }

  /** Validates and stores a new or edited source by downloading it. Rejects with a LoadError. */
  async save(source: Source): Promise<Source> {
    await this.init() // the startup load would otherwise overwrite this change
    return this.queue(source.id, async () => {
      if (this.removed.has(source.id)) throw new Error('Source deleted')
      this.setProgress(source.id, { stage: 'download' })
      try {
        const result = await ingestSource(source, (progress) => this.setProgress(source.id, progress))
        // Deleted while downloading: the deletion queued behind this save removes what it stored.
        if (this.removed.has(source.id)) throw new Error('Source deleted')
        await this.load(result.source)
        const others = this.state.sources.filter((s) => s.id !== source.id)
        const sources = [...others, result.source].sort((a, b) => a.addedAt - b.addedAt)
        this.set({ sources, ...this.combine(sources) })
        return result.source
      } finally {
        this.setProgress(source.id, undefined)
      }
    })
  }

  refresh(sourceId: string): Promise<Source> {
    const source = this.state.sources.find((s) => s.id === sourceId)
    if (!source) return Promise.reject(new Error(`Unknown source ${sourceId}`))
    return this.save(source)
  }

  /** Removes a source and its stored data, also what a save still running for it stores afterwards. */
  async remove(sourceId: string): Promise<void> {
    await this.init()
    const source = this.state.sources.find((s) => s.id === sourceId)
    if (!source) return
    const data = this.data.get(sourceId)
    this.removed.add(sourceId)
    this.data.delete(sourceId)
    const remaining = this.state.sources.filter((s) => s !== source)
    this.set({ sources: remaining, ...this.combine(remaining) })
    try {
      await deleteSource(sourceId)
      // A save still downloading stores the source again when it finishes: delete it once more after that.
      await this.queue(sourceId, () => deleteSource(sourceId))
    } catch (error) {
      // Still stored, so it would come back on the next start: show it again.
      this.removed.delete(sourceId)
      if (data) this.data.set(sourceId, data)
      const sources = [...this.state.sources, source].sort((a, b) => a.addedAt - b.addedAt)
      this.set({ sources, ...this.combine(sources) })
      throw error
    }
  }

  /**
   * Deletes cached channels, movies, series and the guide, and frees the storage space they held, then
   * downloads every source again. Returns how many failed.
   */
  async clearCache(): Promise<number> {
    await this.init()
    await rebuildDatabase()
    this.data.clear()
    const { sources } = this.state
    this.set(this.combine(sources))
    let failed = 0
    for (const source of sources) await this.save(source).catch(() => failed++)
    return failed
  }

  /** Runs `job` once the source's earlier saves and deletion have finished, whether or not they failed. */
  private queue<T>(sourceId: string, job: () => Promise<T>): Promise<T> {
    const result = (this.tasks.get(sourceId) ?? Promise.resolve()).then(job)
    this.tasks.set(sourceId, result.catch(() => undefined))
    return result
  }

  /** Reads a source's cached channels, movies and series; false when none are cached. */
  private async load(source: Source): Promise<boolean> {
    const meta = await getPlaylistMeta(source.id)
    const channels: Channel[] = []
    for (let i = 0; i < (meta?.chunks ?? 0); i++) {
      const chunk = await getChannelChunk(source.id, i)
      for (const channel of chunk) channels.push(channel)
      await yieldToUi()
    }
    const movies: Movie[] = []
    const series: Series[] = []
    for (let i = 0; i < (meta?.vodChunks ?? 0); i++) {
      const chunk = await getVodChunk(source.id, i)
      for (const movie of chunk.movies ?? []) movies.push(movie)
      for (const show of chunk.series ?? []) series.push(show)
      await yieldToUi()
    }
    this.data.set(source.id, { categories: meta?.categories ?? [], channels, movies, series, epgUrls: meta?.epgUrls ?? [] })
    // A refresh can change a series' episodes or a movie's details.
    for (const show of series) this.seriesInfo.delete(show.id)
    for (const movie of movies) this.details.delete(movie.id)
    return !!meta
  }

  private combine(sources: Source[]): Pick<LibraryState, 'categories' | 'channels' | 'movies' | 'series'> {
    const categories: Category[] = []
    const channels: Channel[] = []
    const movies: Movie[] = []
    const series: Series[] = []
    for (const source of sources) {
      const data = this.data.get(source.id)
      if (!data) continue
      for (const c of data.categories) categories.push(c)
      for (const c of data.channels) channels.push(c)
      for (const m of data.movies) movies.push(m)
      for (const s of data.series) series.push(s)
    }
    this.byId = new Map(channels.map((c) => [c.id, c]))
    this.moviesById = new Map(movies.map((m) => [m.id, m]))
    this.seriesById = new Map(series.map((s) => [s.id, s]))
    return { categories, channels, movies, series }
  }

  private setProgress(sourceId: string, progress: IngestProgress | undefined): void {
    const next = { ...this.state.progress }
    if (progress) next[sourceId] = progress
    else delete next[sourceId]
    this.set({ progress: next })
  }

  private set(patch: Partial<LibraryState>): void {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((listener) => listener())
  }
}

export const library = new Library()

export const useLibrary = (): LibraryState => useSyncExternalStore(library.subscribe, library.getState)

export function newSourceId(): string {
  return 's' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36)
}
