import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Category, Channel, Movie, Playlist, Programme, Series, Source } from './models'
import { canSeal, newVaultKey, seal, unseal, type Sealed } from './vault'

const NAME = 'iptv-player'

/** Channels are stored in chunks: 50k separate records would make every refresh slow. */
export const CHUNK_SIZE = 2000

export interface PlaylistMeta {
  sourceId: string
  categories: Category[]
  epgUrls: string[]
  chunks: number
  /** Chunks in `vodChunks`; absent in playlists saved before movies and series were kept apart. */
  vodChunks?: number
}

/** A chunk of movies or of series. A series counts as one item plus one per episode it carries. */
export type VodChunk = { movies: Movie[]; series?: undefined } | { series: Series[]; movies?: undefined }

export interface GuideRecord {
  /** Guide channel key: lower-cased XMLTV id, or `name:` + normalized display name. */
  key: string
  programmes: Programme[]
}

// Anything that can carry a login (sources, stream and guide URLs, the PIN) is stored encrypted, see
// vault.ts; it stays readable only where Web Crypto is unavailable (desktop over a LAN address).
interface SealedValue {
  sealed: Sealed
}
type Stored<T> = T | SealedValue
type StoredSource = Source | ({ id: string; addedAt: number } & SealedValue)

interface Schema extends DBSchema {
  sources: { key: string; value: StoredSource }
  playlists: { key: string; value: Omit<PlaylistMeta, 'epgUrls'> & { epgUrls: Stored<string[]> } }
  channelChunks: { key: [string, number]; value: { sourceId: string; index: number; channels: Stored<Channel[]> } }
  vodChunks: { key: [string, number]; value: { sourceId: string; index: number; items: Stored<VodChunk> } }
  guide: { key: string; value: GuideRecord }
  meta: { key: string; value: unknown }
  /** The vault key. Kept apart from `meta`, which "clear cache" empties. */
  keys: { key: string; value: CryptoKey }
  /** Settings kept out of localStorage (see prefs.ts). */
  settings: { key: string; value: unknown }
}

export type Db = IDBPDatabase<Schema>

let opening: Promise<Db> | undefined

export function db(): Promise<Db> {
  opening ??= openDB<Schema>(NAME, 4, {
    upgrade(database, oldVersion, _newVersion, transaction) {
      if (oldVersion < 1) {
        database.createObjectStore('sources', { keyPath: 'id' })
        database.createObjectStore('playlists', { keyPath: 'sourceId' })
        database.createObjectStore('channelChunks', { keyPath: ['sourceId', 'index'] })
        database.createObjectStore('guide', { keyPath: 'key' })
        database.createObjectStore('meta')
      }
      if (oldVersion < 2) database.createObjectStore('keys')
      if (oldVersion < 3) {
        database.createObjectStore('settings')
        // Older versions cached channel lists unencrypted: drop them, the library downloads them again.
        void transaction.objectStore('playlists').clear()
        void transaction.objectStore('channelChunks').clear()
      }
      if (oldVersion < 4) {
        database.createObjectStore('vodChunks', { keyPath: ['sourceId', 'index'] })
        // Playlists cached before listed movies and episodes as channels: download them again.
        if (oldVersion >= 3) {
          void transaction.objectStore('playlists').clear()
          void transaction.objectStore('channelChunks').clear()
        }
      }
    },
  })
  return opening
}

/** Deletes the whole database: the last resort when it can't be opened. */
export async function deleteDatabase(): Promise<void> {
  const current = opening
  opening = undefined
  await current?.then(
    (database) => database.close(),
    () => undefined,
  )
  await deleteDB(NAME)
}

const chunkRange = (sourceId: string) => IDBKeyRange.bound([sourceId, 0], [sourceId, Infinity])

let vaultKey: Promise<CryptoKey> | undefined

/** The key everything is sealed with, created on first use. */
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

const isSealed = (value: unknown): value is SealedValue => typeof value === 'object' && value !== null && 'sealed' in value

async function protect<T>(value: T): Promise<Stored<T>> {
  return canSeal() ? { sealed: await seal(await getVaultKey(), value) } : value
}

async function reveal<T>(stored: Stored<T>): Promise<T> {
  return isSealed(stored) ? unseal<T>(await getVaultKey(), stored.sealed) : stored
}

async function storeSource(source: Source): Promise<StoredSource> {
  if (!canSeal()) return source
  return { id: source.id, addedAt: source.addedAt, sealed: await seal(await getVaultKey(), source) }
}

export async function getSources(): Promise<Source[]> {
  const sources = await Promise.all((await (await db()).getAll('sources')).map((stored) => reveal<Source>(stored)))
  return sources.sort((a, b) => a.addedAt - b.addedAt)
}

export async function putSource(source: Source): Promise<void> {
  await (await db()).put('sources', await storeSource(source))
}

/** Splits movies and series into chunks of about CHUNK_SIZE items, episodes included. */
export function vodChunks(movies: readonly Movie[], series: readonly Series[]): VodChunk[] {
  const chunks: VodChunk[] = []
  for (let i = 0; i < movies.length; i += CHUNK_SIZE) chunks.push({ movies: movies.slice(i, i + CHUNK_SIZE) })
  let current: Series[] = []
  let size = 0
  for (const show of series) {
    current.push(show)
    size += 1 + (show.episodes?.length ?? 0)
    if (size >= CHUNK_SIZE) {
      chunks.push({ series: current })
      current = []
      size = 0
    }
  }
  if (current.length) chunks.push({ series: current })
  return chunks
}

/** Replaces a source and all of its channels, movies and series in one transaction. */
export async function savePlaylist(source: Source, playlist: Playlist): Promise<void> {
  // Encrypt first: a transaction closes while it waits for anything but IndexedDB.
  const stored = await storeSource(source)
  const epgUrls = await protect(playlist.epgUrls)
  const chunks: Stored<Channel[]>[] = []
  for (let i = 0; i < playlist.channels.length; i += CHUNK_SIZE) chunks.push(await protect(playlist.channels.slice(i, i + CHUNK_SIZE)))
  const vod: Stored<VodChunk>[] = []
  for (const chunk of vodChunks(playlist.movies, playlist.series)) vod.push(await protect(chunk))

  const tx = (await db()).transaction(['sources', 'playlists', 'channelChunks', 'vodChunks'], 'readwrite')
  const writes: Promise<unknown>[] = [
    tx.objectStore('sources').put(stored),
    tx.objectStore('playlists').put({ sourceId: source.id, categories: playlist.categories, epgUrls, chunks: chunks.length, vodChunks: vod.length }),
    tx.objectStore('channelChunks').delete(chunkRange(source.id)),
    tx.objectStore('vodChunks').delete(chunkRange(source.id)),
  ]
  chunks.forEach((channels, index) => writes.push(tx.objectStore('channelChunks').put({ sourceId: source.id, index, channels })))
  vod.forEach((items, index) => writes.push(tx.objectStore('vodChunks').put({ sourceId: source.id, index, items })))
  await Promise.all([...writes, tx.done])
}

export async function getPlaylistMeta(sourceId: string): Promise<PlaylistMeta | undefined> {
  const meta = await (await db()).get('playlists', sourceId)
  return meta && { ...meta, epgUrls: await reveal(meta.epgUrls) }
}

export async function getChannelChunk(sourceId: string, index: number): Promise<Channel[]> {
  const chunk = await (await db()).get('channelChunks', [sourceId, index])
  return chunk ? reveal(chunk.channels) : []
}

export async function getVodChunk(sourceId: string, index: number): Promise<VodChunk> {
  const chunk = await (await db()).get('vodChunks', [sourceId, index])
  return chunk ? reveal(chunk.items) : { movies: [] }
}

export async function getSecretSettings<T>(): Promise<T | undefined> {
  const stored = (await (await db()).get('settings', 'secrets')) as Stored<T> | undefined
  return stored === undefined ? undefined : reveal(stored)
}

export async function putSecretSettings<T>(value: T): Promise<void> {
  await (await db()).put('settings', await protect(value), 'secrets')
}

export async function deleteSource(sourceId: string): Promise<void> {
  const tx = (await db()).transaction(['sources', 'playlists', 'channelChunks', 'vodChunks'], 'readwrite')
  await Promise.all([
    tx.objectStore('sources').delete(sourceId),
    tx.objectStore('playlists').delete(sourceId),
    tx.objectStore('channelChunks').delete(chunkRange(sourceId)),
    tx.objectStore('vodChunks').delete(chunkRange(sourceId)),
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
  const tx = (await db()).transaction(['playlists', 'channelChunks', 'vodChunks', 'guide', 'meta'], 'readwrite')
  await Promise.all([
    tx.objectStore('playlists').clear(),
    tx.objectStore('channelChunks').clear(),
    tx.objectStore('vodChunks').clear(),
    tx.objectStore('guide').clear(),
    tx.objectStore('meta').clear(),
    tx.done,
  ])
}
