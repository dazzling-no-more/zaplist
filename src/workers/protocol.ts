import type { GuideProgress, GuideResult, GuideUrl } from '../data/guideIngest'
import type { LoadErrorCode } from '../data/http'
import type { Source } from '../data/models'

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
  movies: number
  series: number
  categories: number
}

/** Work the worker does: download and store one source, or the whole guide. */
export type Job = { type: 'ingest'; source: Source } | { type: 'guide'; guides: GuideUrl[] }

export type WorkerRequest = Job & { id: number }

export type WorkerResponse =
  | { id: number; type: 'progress'; progress: IngestProgress | GuideProgress }
  | { id: number; type: 'result'; result: IngestResult | GuideResult }
  | { id: number; type: 'error'; code: LoadErrorCode; detail?: string }
