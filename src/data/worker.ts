import type { GuideProgress, GuideResult } from './guideIngest'
import { LoadError } from './http'
import { toLoadError } from './ingest'
import { runJob } from './jobs'
import type { Source } from './models'
import type { IngestProgress, IngestResult, Job, WorkerRequest, WorkerResponse } from '../workers/protocol'
import workerUrl from '../workers/ingest.worker?worker&url'

interface Pending {
  job: Job
  resolve: (result: IngestResult | GuideResult) => void
  reject: (error: LoadError) => void
  onProgress?: (progress: IngestProgress | GuideProgress) => void
}

/** undefined: not tried yet; null: workers unavailable here, so jobs run on the main thread. */
let worker: Worker | null | undefined
let workerAnswered = false
let nextId = 1
const pending = new Map<number, Pending>()

function runOnMainThread(entry: Pending): void {
  runJob(entry.job, (p) => entry.onProgress?.(p)).then(entry.resolve, (error) => entry.reject(toLoadError(error)))
}

function getWorker(): Worker | null {
  if (worker !== undefined) return worker
  try {
    // A separate file, not a Blob URL: Blob workers are unreliable on some webOS versions.
    // Desktop browsers refuse file:// workers outright, which lands in the catch below.
    worker = new Worker(workerUrl)
  } catch {
    return (worker = null)
  }
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    workerAnswered = true
    const message = event.data
    const entry = pending.get(message.id)
    if (!entry) return
    if (message.type === 'progress') return entry.onProgress?.(message.progress)
    pending.delete(message.id)
    if (message.type === 'result') entry.resolve(message.result)
    else entry.reject(new LoadError(message.code, message.detail))
  }
  worker.onerror = (event) => {
    const entries = Array.from(pending.values())
    pending.clear()
    worker?.terminate()
    if (workerAnswered) {
      worker = undefined
      for (const entry of entries) entry.reject(new LoadError('format', event.message))
    } else {
      // The script never started (blocked or missing): fall back for good.
      worker = null
      entries.forEach(runOnMainThread)
    }
  }
  return worker
}

function run(job: Job, onProgress?: (progress: IngestProgress | GuideProgress) => void): Promise<IngestResult | GuideResult> {
  return new Promise((resolve, reject) => {
    const entry: Pending = { job, resolve, reject, onProgress }
    const target = getWorker()
    if (!target) return runOnMainThread(entry)
    const id = nextId++
    pending.set(id, entry)
    const request: WorkerRequest = { ...job, id }
    target.postMessage(request)
  })
}

/** Downloads and parses a source off the UI thread when possible, then stores it in IndexedDB. */
export function ingestSource(source: Source, onProgress?: (progress: IngestProgress) => void): Promise<IngestResult> {
  return run({ type: 'ingest', source }, onProgress as (p: IngestProgress | GuideProgress) => void) as Promise<IngestResult>
}

/** Downloads the guide URLs and stores the programmes of the `wanted` guide keys. */
export function ingestGuideUrls(urls: string[], wanted: string[], onProgress?: (progress: GuideProgress) => void): Promise<GuideResult> {
  return run({ type: 'guide', urls, wanted }, onProgress as (p: IngestProgress | GuideProgress) => void) as Promise<GuideResult>
}
