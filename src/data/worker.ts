import { LoadError } from './http'
import type { Source } from './models'
import type { IngestProgress, IngestResult, WorkerRequest, WorkerResponse } from '../workers/protocol'
// Inlined as a Blob URL: a separate worker file can't be loaded from file:// in every engine.
import IngestWorker from '../workers/ingest.worker?worker&inline'

interface Pending {
  resolve: (result: IngestResult) => void
  reject: (error: LoadError) => void
  onProgress?: (progress: IngestProgress) => void
}

let worker: Worker | undefined
let nextId = 1
const pending = new Map<number, Pending>()

function getWorker(): Worker {
  if (worker) return worker
  worker = new IngestWorker()
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data
    const job = pending.get(message.id)
    if (!job) return
    if (message.type === 'progress') return job.onProgress?.(message.progress)
    pending.delete(message.id)
    if (message.type === 'result') job.resolve(message.result)
    else job.reject(new LoadError(message.code, message.detail))
  }
  worker.onerror = (event) => {
    for (const job of pending.values()) job.reject(new LoadError('format', event.message))
    pending.clear()
    worker?.terminate()
    worker = undefined
  }
  return worker
}

/** Downloads and parses a source in the worker, then stores it (source record included) in IndexedDB. */
export function ingestSource(source: Source, onProgress?: (progress: IngestProgress) => void): Promise<IngestResult> {
  return new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject, onProgress })
    const request: WorkerRequest = { id, type: 'ingest', source }
    getWorker().postMessage(request)
  })
}
