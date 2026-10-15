import type { Channel, Programme } from './models'
import { hash, normalizeName } from './text'
import type { XmltvChannel, XmltvHandlers, XmltvProgramme } from './xmltv'

const HOUR = 3_600_000
/** Descriptions are cut to this length; they are only shown in the programme details. */
const MAX_DESCRIPTION = 600

/**
 * Guide keys for a channel, most specific first: its tvg-id, then its normalized name. Guide data is
 * stored under every key it matched, so a lookup tries them in this order.
 */
export function guideKeys(channel: Pick<Channel, 'tvgId' | 'tvgName' | 'name'>): string[] {
  const keys: string[] = []
  if (channel.tvgId) keys.push(channel.tvgId.trim().toLowerCase())
  const name = normalizeName(channel.tvgName || channel.name)
  if (name) keys.push('name:' + name)
  return keys
}

/** The guide's span: from 2 h ago to 24 h ahead, widened for tvg-shift. */
export function guideWindow(now: number): { from: number; to: number } {
  return { from: now - 3 * HOUR, to: now + 26 * HOUR }
}

/** The furthest the guide offset setting moves every guide time, either way. */
export const MAX_OFFSET_MINUTES = 12 * 60

/**
 * Programmes stored: the guide's span under any offset the setting allows, since the offset applies
 * when programmes are shown and can change without a new download.
 */
export function storedWindow(now: number): { from: number; to: number } {
  const { from, to } = guideWindow(now)
  return { from: from - MAX_OFFSET_MINUTES * 60_000, to: to + MAX_OFFSET_MINUTES * 60_000 }
}

/** How far back the guide goes for channels whose programmes can be watched again (catch-up). */
export const REPLAY_HOURS = 24

/** Where the stored programmes of catch-up channels start: REPLAY_HOURS back, under any offset. */
export const storedReplayFrom = (now: number): number => now - (REPLAY_HOURS + 1) * HOUR - MAX_OFFSET_MINUTES * 60_000

/**
 * Where a guide key's programmes from the guide at `url` are stored. Each guide file keeps its own,
 * since two providers can use the same channel id for different channels.
 */
export const storedGuideKey = (url: string, key: string): string => `${hash(url)}|${key}`

/** How far a channel's guide is moved: its tvg-shift plus the global offset setting. */
export const shiftMs = (channel: Pick<Channel, 'epgShift'> | undefined, offsetMinutes: number): number =>
  (channel?.epgShift ?? 0) * HOUR + offsetMinutes * 60_000

/** Collects programmes of the wanted channels from a parsed XMLTV stream. */
export class GuideCollector implements XmltvHandlers {
  private readonly lists = new Map<string, Programme[]>()
  private readonly keysById = new Map<string, string[]>()
  /** Guide channels and programmes kept, each counted once however many keys store it. */
  readonly kept = { channels: new Set<string>(), programmes: 0 }

  /** `replay`: keys of catch-up channels, whose programmes are kept from `replay.from` on. */
  constructor(
    private readonly wanted: Set<string>,
    private readonly window: { from: number; to: number },
    private readonly replay: { keys: Set<string>; from: number } = { keys: new Set(), from: window.from },
  ) {}

  /** Where the programmes kept for `key` start. */
  private from(key: string): number {
    return this.replay.keys.has(key) ? Math.min(this.replay.from, this.window.from) : this.window.from
  }

  channel(channel: XmltvChannel): void {
    const keys: string[] = []
    const id = channel.id.trim().toLowerCase()
    if (this.wanted.has(id)) keys.push(id)
    for (const name of channel.names) {
      const key = 'name:' + normalizeName(name)
      if (this.wanted.has(key) && keys.indexOf(key) < 0) keys.push(key)
    }
    this.keysById.set(channel.id, keys)
  }

  programme(p: XmltvProgramme): void {
    if (p.start > this.window.to || (p.stop > p.start && p.stop < Math.min(this.window.from, this.replay.from))) return
    let keys = this.keysById.get(p.channel)
    if (!keys) {
      // Programme for a channel without a <channel> element: match its id directly.
      const id = p.channel.trim().toLowerCase()
      keys = this.wanted.has(id) ? [id] : []
      this.keysById.set(p.channel, keys)
    }
    if (p.stop > p.start && p.stop < this.window.from) keys = keys.filter((key) => p.stop >= this.from(key))
    if (!keys.length) return
    this.kept.channels.add(p.channel)
    this.kept.programmes++
    const programme: Programme = {
      start: p.start,
      stop: p.stop,
      title: p.title,
      description: p.description && p.description.length > MAX_DESCRIPTION ? p.description.slice(0, MAX_DESCRIPTION) + '…' : p.description,
    }
    for (const key of keys) {
      let list = this.lists.get(key)
      if (!list) this.lists.set(key, (list = []))
      list.push(programme)
    }
  }

  /** Sorted, de-duplicated programmes per key; missing stop times end at the next programme. */
  finish(): Map<string, Programme[]> {
    for (const [key, list] of this.lists) {
      list.sort((a, b) => a.start - b.start)
      const clean: Programme[] = []
      for (let i = 0; i < list.length; i++) {
        const p = list[i]
        if (clean.length && clean[clean.length - 1].start === p.start) continue
        const next = list[i + 1]
        if (p.stop <= p.start) clean.push({ ...p, stop: next && next.start > p.start ? next.start : p.start + HOUR })
        else clean.push(p)
      }
      const from = this.from(key)
      this.lists.set(key, clean.filter((p) => p.stop >= from))
    }
    return this.lists
  }
}

/** Index of the programme on at `time`, else of the first one after it (or -1). */
export function programmeAt(programmes: readonly Programme[], time: number): number {
  let lo = 0
  let hi = programmes.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (programmes[mid].stop <= time) lo = mid + 1
    else if (programmes[mid].start > time) hi = mid - 1
    else return mid
  }
  return lo < programmes.length ? lo : -1
}

/** The programme on now and the next one; times in `programmes` are as published (unshifted). */
export function nowNext(programmes: readonly Programme[] | undefined, now: number, shift: number): { now?: Programme; next?: Programme } {
  if (!programmes?.length) return {}
  const time = now - shift
  const i = programmeAt(programmes, time)
  if (i < 0) return {}
  const current = programmes[i]
  if (current.start <= time) return { now: current, next: programmes[i + 1] }
  return { next: current }
}
