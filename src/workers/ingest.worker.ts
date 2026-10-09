// Downloads, parses and stores playlists off the UI thread.
import 'virtual:core-js'
import 'abortcontroller-polyfill/dist/polyfill-patch-fetch'
import { ingest, toLoadError } from '../data/ingest'
import type { WorkerRequest, WorkerResponse } from './protocol'

const post = (message: WorkerResponse) => (self as unknown as Worker).postMessage(message)

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, source } = event.data
  try {
    const result = await ingest(source, (progress) => post({ id, type: 'progress', progress }))
    post({ id, type: 'result', result })
  } catch (error) {
    const { code, detail } = toLoadError(error)
    post({ id, type: 'error', code, detail })
  }
}
