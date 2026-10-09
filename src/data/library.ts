import { useSyncExternalStore } from 'react'
import { clearCache, deleteSource, getChannelChunk, getPlaylistMeta, getSources } from './db'
import type { Category, Channel, Source } from './models'
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
}

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

class Library {
  private state: LibraryState = { ready: false, sources: [], categories: [], channels: [], progress: {} }
  private readonly data = new Map<string, SourceData>()
  private byId = new Map<string, Channel>()
  private readonly listeners = new Set<() => void>()
  private initializing: Promise<void> | undefined

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
      const sources = await getSources()
      for (const source of sources) await this.load(source)
      this.set({ ready: true, sources, ...this.combine(sources) })
    })()
    return this.initializing
  }

  /** Validates and stores a new or edited source by downloading it. Rejects with a LoadError. */
  async save(source: Source): Promise<Source> {
    await this.init() // the startup load would otherwise overwrite this change
    this.setProgress(source.id, { stage: 'download' })
    try {
      const result = await ingestSource(source, (progress) => this.setProgress(source.id, progress))
      await this.load(result.source)
      const others = this.state.sources.filter((s) => s.id !== source.id)
      const sources = [...others, result.source].sort((a, b) => a.addedAt - b.addedAt)
      this.set({ sources, ...this.combine(sources) })
      return result.source
    } finally {
      this.setProgress(source.id, undefined)
    }
  }

  refresh(sourceId: string): Promise<Source> {
    const source = this.state.sources.find((s) => s.id === sourceId)
    if (!source) return Promise.reject(new Error(`Unknown source ${sourceId}`))
    return this.save(source)
  }

  async remove(sourceId: string): Promise<void> {
    await this.init()
    await deleteSource(sourceId)
    this.data.delete(sourceId)
    const sources = this.state.sources.filter((s) => s.id !== sourceId)
    this.set({ sources, ...this.combine(sources) })
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

  private async load(source: Source): Promise<void> {
    const meta = await getPlaylistMeta(source)
    const channels: Channel[] = []
    for (let i = 0; i < (meta?.chunks ?? 0); i++) {
      const chunk = await getChannelChunk(source, i)
      for (const channel of chunk) channels.push(channel)
      await yieldToUi()
    }
    this.data.set(source.id, { categories: meta?.categories ?? [], channels, epgUrls: meta?.epgUrls ?? [] })
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
