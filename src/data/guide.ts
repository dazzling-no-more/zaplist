import { useEffect, useSyncExternalStore } from 'react'
import { getGuide, getMeta, setMeta } from './db'
import { guideKeys, storedGuideKey } from './guideData'
import type { GuideProgress } from './guideIngest'
import { fetchJson, LoadError } from './http'
import { toLoadError } from './ingest'
import { library } from './library'
import type { Channel, Programme } from './models'
import { getPrefs } from './prefs'
import { ingestGuideUrls } from './worker'
import { apiUrl, parseShortEpg, type XtreamShortEpg } from './xtream'

/** Channels whose programmes stay in memory. */
const CACHE_LIMIT = 800
/** Xtream short-EPG answers are re-fetched after this long. */
const SHORT_EPG_TTL_MS = 10 * 60_000
const SCHEDULE_CHECK_MS = 15 * 60_000
/** A refresh where a guide URL failed is tried again after this long, not the usual 6 to 24 hours. */
const RETRY_FAILED_MS = 60 * 60_000

export interface GuideInfo {
  refreshedAt?: number
  channels?: number
  programmes?: number
  /** Guide URLs that couldn't be read at the last refresh. */
  failedUrls?: number
  /** GUIDE_FORMAT of the stored guide; absent for guides stored before it. */
  format?: number
}

/** 2: programmes stored per guide URL (guideData.ts storedGuideKey). */
const GUIDE_FORMAT = 2

export interface GuideStatus extends GuideInfo {
  progress?: GuideProgress
  error?: LoadError
}

const NO_PROGRAMMES: readonly Programme[] = []

class Guide {
  private status: GuideStatus = {}
  private readonly cache = new Map<string, readonly Programme[]>()
  private readonly shortEpgAt = new Map<string, number>()
  private readonly loading = new Set<string>()
  private readonly listeners = new Set<() => void>()
  private refreshing: Promise<void> | undefined
  /** A refresh asked for while one runs: it runs after, with the sources as they are then. */
  private queued: Promise<void> | undefined
  private generation = 0

  getStatus = (): GuideStatus => this.status

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Programmes in memory for a channel; undefined until `load` has run. */
  cached(channelId: string): readonly Programme[] | undefined {
    const programmes = this.cache.get(channelId)
    const fetchedAt = this.shortEpgAt.get(channelId)
    if (fetchedAt !== undefined && Date.now() - fetchedAt > SHORT_EPG_TTL_MS) return undefined
    return programmes
  }

  /** Loads a channel's programmes from IndexedDB (or the Xtream short EPG) into memory. */
  async load(channel: Channel): Promise<void> {
    if (this.cached(channel.id) || this.loading.has(channel.id)) return
    this.loading.add(channel.id)
    const generation = this.generation
    let programmes: readonly Programme[] | undefined
    let shortEpg = false
    try {
      const urls = this.urls(channel.sourceId)
      for (const key of guideKeys(channel).flatMap((key) => urls.map((url) => storedGuideKey(url, key)))) {
        programmes = await getGuide(key)
        if (programmes?.length) break
      }
      if (!programmes?.length && channel.streamId !== undefined) {
        shortEpg = true
        programmes = await this.fetchShortEpg(channel)
      }
    } catch {
      // Remembered as no programmes for the short EPG's time to live, then asked again.
      programmes = undefined
      shortEpg = true
    } finally {
      this.loading.delete(channel.id)
    }
    if (generation !== this.generation) return
    this.remember(channel.id, programmes?.length ? programmes : NO_PROGRAMMES, shortEpg)
  }

  /** A source's guide URLs, in the order they are looked in: its own setting, its playlist's, and the global setting. */
  urls(sourceId: string): string[] {
    const source = library.getState().sources.find((s) => s.id === sourceId)
    const urls = [source?.epgUrl ?? '', ...library.epgUrls(sourceId), getPrefs().epgUrl ?? '']
    return Array.from(new Set(urls.map((u) => u.trim()).filter(Boolean)))
  }

  /**
   * Downloads all guides in the worker and replaces the stored programmes. While a refresh runs, one
   * more follows it: the running one was set up before a source or guide URL that was just added.
   */
  refresh(): Promise<void> {
    if (this.refreshing) {
      this.queued ??= this.refreshing.then(() => {
        this.queued = undefined
        return this.refresh()
      })
      return this.queued
    }
    this.refreshing = this.runRefresh().finally(() => (this.refreshing = undefined))
    return this.refreshing
  }

  /** Reads the last refresh time and keeps the guide fresh: on start and every 15 minutes. */
  async start(): Promise<void> {
    const info = await getMeta<GuideInfo>('guide')
    this.set({ ...info })
    const check = () => {
      // A guide stored in an older format can't be looked up any more: refresh it now.
      const every = this.status.failedUrls ? RETRY_FAILED_MS : getPrefs().epgRefreshHours * 3_600_000
      const due = this.status.format === GUIDE_FORMAT ? (this.status.refreshedAt ?? 0) + every : 0
      if (!this.refreshing && Date.now() >= due && library.getState().sources.some((s) => this.urls(s.id).length)) void this.refresh()
    }
    check()
    setInterval(check, SCHEDULE_CHECK_MS)
  }

  /** Drops everything in memory (after the guide or the offset changed). */
  invalidate(): void {
    this.generation++
    this.cache.clear()
    this.shortEpgAt.clear()
    this.emit()
  }

  private async runRefresh(): Promise<void> {
    const { sources, channels } = library.getState()
    const urls = new Map(sources.map((s) => [s.id, this.urls(s.id)]))
    // Per guide URL, the keys of the channels whose sources use it, and of those with catch-up.
    const wanted = new Map<string, Set<string>>()
    const replayable = new Map<string, Set<string>>()
    const add = (map: Map<string, Set<string>>, url: string, channel: Channel) => {
      let keys = map.get(url)
      if (!keys) map.set(url, (keys = new Set()))
      for (const key of guideKeys(channel)) keys.add(key)
    }
    for (const channel of channels) {
      for (const url of urls.get(channel.sourceId) ?? []) {
        add(wanted, url, channel)
        if (channel.catchup) add(replayable, url, channel)
      }
    }
    if (!wanted.size) return
    this.set({ progress: { stage: 'download' }, error: undefined })
    try {
      const guides = Array.from(wanted, ([url, keys]) => ({ url, wanted: Array.from(keys), replayable: Array.from(replayable.get(url) ?? []) }))
      const result = await ingestGuideUrls(guides, (progress) => this.set({ progress }))
      const info: GuideInfo = { refreshedAt: Date.now(), channels: result.channels, programmes: result.programmes, failedUrls: result.failed, format: GUIDE_FORMAT }
      await setMeta('guide', info)
      this.set({ ...info, progress: undefined })
      this.invalidate()
    } catch (error) {
      this.set({ progress: undefined, error: toLoadError(error) })
    }
  }

  private async fetchShortEpg(channel: Channel): Promise<Programme[]> {
    const source = library.getState().sources.find((s) => s.id === channel.sourceId)
    if (source?.kind !== 'xtream') return []
    const response = await fetchJson<XtreamShortEpg>(apiUrl(source, { action: 'get_short_epg', stream_id: channel.streamId!, limit: 10 }))
    return parseShortEpg(response)
  }

  private remember(channelId: string, programmes: readonly Programme[], shortEpg: boolean): void {
    this.cache.delete(channelId)
    this.cache.set(channelId, programmes)
    if (shortEpg) this.shortEpgAt.set(channelId, Date.now())
    else this.shortEpgAt.delete(channelId)
    if (this.cache.size > CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value!
      this.cache.delete(oldest)
      this.shortEpgAt.delete(oldest)
    }
    this.emit()
  }

  private set(patch: Partial<GuideStatus>): void {
    this.status = { ...this.status, ...patch }
    this.emit()
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener())
  }
}

export const guide = new Guide()

export const useGuideStatus = (): GuideStatus => useSyncExternalStore(guide.subscribe, guide.getStatus)

/** A channel's programmes (as published, unshifted), loading them when needed. */
export function useProgrammes(channel: Channel | undefined): readonly Programme[] | undefined {
  const programmes = useSyncExternalStore(guide.subscribe, () => (channel ? guide.cached(channel.id) : undefined))
  useEffect(() => {
    if (channel && !programmes) void guide.load(channel)
  }, [channel?.id, programmes === undefined])
  return programmes
}
