import type { M3uPlaylist } from './m3u'
import type { Category, Channel, Playlist } from './models'
import { hash } from './text'

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

export function m3uToPlaylist(sourceId: string, playlist: M3uPlaylist): Playlist {
  const categories = new Map<string, Category>()
  const ids = new Set<string>()
  const channels: Channel[] = []

  for (const entry of playlist.entries) {
    const { attrs } = entry
    const groupName = attrs['group-title'] || entry.group
    let categoryId: string | undefined
    if (groupName) {
      categoryId = `${sourceId}:g:${groupName}`
      if (!categories.has(categoryId)) categories.set(categoryId, { id: categoryId, sourceId, name: groupName })
    }
    const name = entry.title || attrs['tvg-name'] || entry.url
    const shift = parseFloat(attrs['tvg-shift'])
    const catchupDays = positiveInt(attrs['catchup-days'])
    const channel: Channel = {
      id: uniqueId(ids, `${sourceId}:${hash(entry.url + '\n' + name)}`),
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
  return { categories: Array.from(categories.values()), channels, epgUrls: playlist.epgUrls }
}
