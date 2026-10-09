import type { LoadErrorCode } from '../data/http'
import type { Source } from '../data/models'

export type WorkerRequest = { id: number; type: 'ingest'; source: Source }

export interface IngestProgress {
  stage: 'download' | 'parse' | 'save'
  /** Bytes downloaded so far (download stage). */
  bytes?: number
  /** Channels found (save stage). */
  channels?: number
}

export interface IngestResult {
  source: Source
  channels: number
  categories: number
}

export type WorkerResponse =
  | { id: number; type: 'progress'; progress: IngestProgress }
  | { id: number; type: 'result'; result: IngestResult }
  | { id: number; type: 'error'; code: LoadErrorCode; detail?: string }
