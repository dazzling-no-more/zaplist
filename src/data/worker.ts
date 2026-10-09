import { LoadError } from './http'
import { ingest, toLoadError } from './ingest'
import type { Source } from './models'
import type { IngestProgress, IngestResult, WorkerRequest, WorkerResponse } from '../workers/protocol'
import workerUrl from '../workers/ingest.worker?worker&url'

interface Job {
  source: Source
  resolve: (result: IngestResult) => void
  reject: (error: LoadError) => void
  onProgress?: (progress: IngestProgress) => void
}

/** undefined: not tried yet; null: workers unavailable here, so jobs run on the main thread. */
let worker: Worker | null | undefined
let workerAnswered = false
let nextId = 1
const jobs = new Map<number, Job>()

function runOnMainThread(job: Job): void {
  ingest(job.source, (p) => job.onProgress?.(p)).then(job.resolve, (error) => job.reject(toLoadError(error)))
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
    const job = jobs.get(message.id)
    if (!job) return
    if (message.type === 'progress') return job.onProgress?.(message.progress)
    jobs.delete(message.id)
    if (message.type === 'result') job.resolve(message.result)
    else job.reject(new LoadError(message.code, message.detail))
  }
  worker.onerror = (event) => {
    const pending = Array.from(jobs.values())
    jobs.clear()
    worker?.terminate()
    if (workerAnswered) {
      worker = undefined
      for (const job of pending) job.reject(new LoadError('format', event.message))
    } else {
      // The script never started (blocked or missing): fall back for good.
      worker = null
      pending.forEach(runOnMainThread)
    }
  }
  return worker
}

/** Downloads and parses a source off the UI thread when possible, then stores it in IndexedDB. */
export function ingestSource(source: Source, onProgress?: (progress: IngestProgress) => void): Promise<IngestResult> {
  return new Promise((resolve, reject) => {
    const job: Job = { source, resolve, reject, onProgress }
    const target = getWorker()
    if (!target) return runOnMainThread(job)
    const id = nextId++
    jobs.set(id, job)
    const request: WorkerRequest = { id, type: 'ingest', source }
    target.postMessage(request)
  })
}
