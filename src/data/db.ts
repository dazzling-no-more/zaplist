import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Category, Channel, Playlist, Programme, Source } from './models'
import { canSeal, loginParts, maskUrl, newVaultKey, seal, unmaskUrl, unseal, type Sealed } from './vault'

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

/** A source as stored: encrypted (see vault.ts), or plain where Web Crypto is unavailable. */
type StoredSource = Source | { id: string; addedAt: number; sealed: Sealed }

interface Schema extends DBSchema {
  sources: { key: string; value: StoredSource }
  playlists: { key: string; value: PlaylistMeta }
  channelChunks: { key: [string, number]; value: ChannelChunk }
  guide: { key: string; value: GuideRecord }
  meta: { key: string; value: unknown }
  /** The vault key. Kept apart from `meta`, which "clear cache" empties. */
  keys: { key: string; value: CryptoKey }
}

export type Db = IDBPDatabase<Schema>

let opening: Promise<Db> | undefined

export function db(): Promise<Db> {
  opening ??= openDB<Schema>('iptv-player', 2, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        database.createObjectStore('sources', { keyPath: 'id' })
        database.createObjectStore('playlists', { keyPath: 'sourceId' })
        database.createObjectStore('channelChunks', { keyPath: ['sourceId', 'index'] })
        database.createObjectStore('guide', { keyPath: 'key' })
        database.createObjectStore('meta')
      }
      if (oldVersion < 2) database.createObjectStore('keys')
    },
  })
  return opening
}

const chunkRange = (sourceId: string) => IDBKeyRange.bound([sourceId, 0], [sourceId, Infinity])

let vaultKey: Promise<CryptoKey> | undefined

/** The key sources are sealed with, created on first use. */
function getVaultKey(): Promise<CryptoKey> {
  vaultKey ??= (async () => {
    const database = await db()
    const stored = await database.get('keys', 'vault')
    if (stored) return stored
    const created = await newVaultKey()
    try {
      await database.add('keys', created, 'vault')
      return created
    } catch {
      // The worker and the page both store sources: if the other one won the race, use its key.
      return (await database.get('keys', 'vault'))!
    }
  })()
  return vaultKey
}

async function storeSource(source: Source): Promise<StoredSource> {
  if (!canSeal()) return source
  return { id: source.id, addedAt: source.addedAt, sealed: await seal(await getVaultKey(), source) }
}

async function openSource(stored: StoredSource): Promise<Source> {
  return 'sealed' in stored ? unseal<Source>(await getVaultKey(), stored.sealed) : stored
}

export async function getSources(): Promise<Source[]> {
  const sources = await Promise.all((await (await db()).getAll('sources')).map(openSource))
  return sources.sort((a, b) => a.addedAt - b.addedAt)
}

export async function putSource(source: Source): Promise<void> {
  await (await db()).put('sources', await storeSource(source))
}

/** Replaces a source and all of its channels in one transaction. The source's login is kept out of stored URLs. */
export async function savePlaylist(source: Source, playlist: Playlist): Promise<void> {
  const stored = await storeSource(source) // before the transaction: it would close while encryption runs
  const parts = loginParts(source)
  const mask = (url: string) => maskUrl(url, parts)
  const tx = (await db()).transaction(['sources', 'playlists', 'channelChunks'], 'readwrite')
  const chunks = Math.ceil(playlist.channels.length / CHUNK_SIZE)
  const writes: Promise<unknown>[] = [
    tx.objectStore('sources').put(stored),
    tx.objectStore('playlists').put({ sourceId: source.id, categories: playlist.categories, epgUrls: playlist.epgUrls.map(mask), chunks }),
    tx.objectStore('channelChunks').delete(chunkRange(source.id)),
  ]
  for (let index = 0; index < chunks; index++) {
    const channels = playlist.channels.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE).map((c) => mapUrls(c, mask))
    writes.push(tx.objectStore('channelChunks').put({ sourceId: source.id, index, channels }))
  }
  await Promise.all([...writes, tx.done])
}

/** The channel with `map` applied to every URL that can contain a login. */
function mapUrls(channel: Channel, map: (url: string) => string): Channel {
  const mapped: Channel = { ...channel, urls: channel.urls.map(map) }
  if (channel.logo) mapped.logo = map(channel.logo)
  if (channel.catchup?.source) mapped.catchup = { ...channel.catchup, source: map(channel.catchup.source) }
  return mapped
}

export async function getPlaylistMeta(source: Source): Promise<PlaylistMeta | undefined> {
  const meta = await (await db()).get('playlists', source.id)
  const parts = loginParts(source)
  return meta && { ...meta, epgUrls: meta.epgUrls.map((url) => unmaskUrl(url, parts)) }
}

export async function getChannelChunk(source: Source, index: number): Promise<Channel[]> {
  const channels = (await (await db()).get('channelChunks', [source.id, index]))?.channels ?? []
  const parts = loginParts(source)
  return parts.length ? channels.map((c) => mapUrls(c, (url) => unmaskUrl(url, parts))) : channels
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
