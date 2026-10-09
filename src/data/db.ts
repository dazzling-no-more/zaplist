import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Category, Channel, Playlist, Programme, Source } from './models'

/** Channels are stored in chunks: 50k separate records would make every refresh slow. */
export const CHUNK_SIZE = 2000

export interface PlaylistMeta {
  sourceId: string
  categories: Category[]
  epgUrls: string[]
  chunks: number
}

export interface ChannelChunk {
  sourceId: string
  index: number
  channels: Channel[]
}

export interface GuideRecord {
  /** Guide channel key: lower-cased XMLTV id, or `name:` + normalized display name. */
  key: string
  programmes: Programme[]
}

interface Schema extends DBSchema {
  sources: { key: string; value: Source }
  playlists: { key: string; value: PlaylistMeta }
  channelChunks: { key: [string, number]; value: ChannelChunk }
  guide: { key: string; value: GuideRecord }
  meta: { key: string; value: unknown }
}

export type Db = IDBPDatabase<Schema>

let opening: Promise<Db> | undefined

export function db(): Promise<Db> {
  opening ??= openDB<Schema>('iptv-player', 1, {
    upgrade(database) {
      database.createObjectStore('sources', { keyPath: 'id' })
      database.createObjectStore('playlists', { keyPath: 'sourceId' })
      database.createObjectStore('channelChunks', { keyPath: ['sourceId', 'index'] })
      database.createObjectStore('guide', { keyPath: 'key' })
      database.createObjectStore('meta')
    },
  })
  return opening
}

const chunkRange = (sourceId: string) => IDBKeyRange.bound([sourceId, 0], [sourceId, Infinity])

export async function getSources(): Promise<Source[]> {
  const sources = await (await db()).getAll('sources')
  return sources.sort((a, b) => a.addedAt - b.addedAt)
}

export async function putSource(source: Source): Promise<void> {
  await (await db()).put('sources', source)
}

/** Replaces a source and all of its channels in one transaction. */
export async function savePlaylist(source: Source, playlist: Playlist): Promise<void> {
  const tx = (await db()).transaction(['sources', 'playlists', 'channelChunks'], 'readwrite')
  const chunks = Math.ceil(playlist.channels.length / CHUNK_SIZE)
  const writes: Promise<unknown>[] = [
    tx.objectStore('sources').put(source),
    tx.objectStore('playlists').put({ sourceId: source.id, categories: playlist.categories, epgUrls: playlist.epgUrls, chunks }),
    tx.objectStore('channelChunks').delete(chunkRange(source.id)),
  ]
  for (let index = 0; index < chunks; index++) {
    const channels = playlist.channels.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE)
    writes.push(tx.objectStore('channelChunks').put({ sourceId: source.id, index, channels }))
  }
  await Promise.all([...writes, tx.done])
}

export async function getPlaylistMeta(sourceId: string): Promise<PlaylistMeta | undefined> {
  return (await db()).get('playlists', sourceId)
}

export async function getChannelChunk(sourceId: string, index: number): Promise<Channel[]> {
  return (await (await db()).get('channelChunks', [sourceId, index]))?.channels ?? []
}

export async function deleteSource(sourceId: string): Promise<void> {
  const tx = (await db()).transaction(['sources', 'playlists', 'channelChunks'], 'readwrite')
  await Promise.all([
    tx.objectStore('sources').delete(sourceId),
    tx.objectStore('playlists').delete(sourceId),
    tx.objectStore('channelChunks').delete(chunkRange(sourceId)),
    tx.done,
  ])
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get('meta', key)) as T | undefined
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await (await db()).put('meta', value, key)
}

/** Replaces the whole guide. Written in batches so no single transaction gets huge. */
export async function saveGuide(programmes: Map<string, Programme[]>): Promise<void> {
  const database = await db()
  await database.clear('guide')
  const entries = Array.from(programmes)
  for (let i = 0; i < entries.length; i += 1000) {
    const tx = database.transaction('guide', 'readwrite')
    const writes = entries.slice(i, i + 1000).map(([key, list]) => tx.store.put({ key, programmes: list }))
    await Promise.all([...writes, tx.done])
  }
}

export async function getGuide(key: string): Promise<Programme[] | undefined> {
  return (await (await db()).get('guide', key))?.programmes
}

/** Removes cached playlists and the guide; sources stay and download again on refresh. */
export async function clearCache(): Promise<void> {
  const tx = (await db()).transaction(['playlists', 'channelChunks', 'guide', 'meta'], 'readwrite')
  await Promise.all([
    tx.objectStore('playlists').clear(),
    tx.objectStore('channelChunks').clear(),
    tx.objectStore('guide').clear(),
    tx.objectStore('meta').clear(),
    tx.done,
  ])
}
