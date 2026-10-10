import { useSyncExternalStore } from 'react'
import { clearCache, deleteSource, getChannelChunk, getPlaylistMeta, getSources } from './db'
import type { Category, Channel, Source } from './models'
import { loadSecretPrefs } from './prefs'
import { ingestSource } from './worker'
import type { IngestProgress } from '../workers/protocol'

interface SourceData {
  categories: Category[]
  channels: Channel[]
  epgUrls: string[]
}

export interface LibraryState {
  /** False until the cached playlists have been read from IndexedDB. */
  ready: boolean
  sources: Source[]
  /** Categories and channels of all sources, in source order. */
  categories: Category[]
  channels: Channel[]
  /** Refreshes in progress, by source id. */
  progress: Record<string, IngestProgress>
  /** Set when the stored data couldn't be read at startup. */
  error?: unknown
}

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

class Library {
  private state: LibraryState = { ready: false, sources: [], categories: [], channels: [], progress: {} }
  private readonly data = new Map<string, SourceData>()
  private byId = new Map<string, Channel>()
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

  /** Guide URLs named by the playlists themselves. */
  epgUrls(): string[] {
    return Array.from(this.data.values()).flatMap((d) => d.epgUrls)
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

  /** Deletes cached channels and the guide, then downloads every source again. Returns how many failed. */
  async clearCache(): Promise<number> {
    await this.init()
    await clearCache()
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

  /** Reads a source's cached channels; false when none are cached. */
  private async load(source: Source): Promise<boolean> {
    const meta = await getPlaylistMeta(source.id)
    const channels: Channel[] = []
    for (let i = 0; i < (meta?.chunks ?? 0); i++) {
      const chunk = await getChannelChunk(source.id, i)
      for (const channel of chunk) channels.push(channel)
      await yieldToUi()
    }
    this.data.set(source.id, { categories: meta?.categories ?? [], channels, epgUrls: meta?.epgUrls ?? [] })
    return !!meta
  }

  private combine(sources: Source[]): Pick<LibraryState, 'categories' | 'channels'> {
    const categories: Category[] = []
    const channels: Channel[] = []
    for (const source of sources) {
      const data = this.data.get(source.id)
      if (!data) continue
      for (const c of data.categories) categories.push(c)
      for (const c of data.channels) channels.push(c)
    }
    this.byId = new Map(channels.map((c) => [c.id, c]))
    return { categories, channels }
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
