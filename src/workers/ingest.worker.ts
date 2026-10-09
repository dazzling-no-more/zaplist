// Downloads, parses and stores playlists and the guide off the UI thread.
import 'virtual:core-js'
import 'abortcontroller-polyfill/dist/polyfill-patch-fetch'
import { runJob } from '../data/jobs'
import { toLoadError } from '../data/ingest'
import type { WorkerRequest, WorkerResponse } from './protocol'

const post = (message: WorkerResponse) => (self as unknown as Worker).postMessage(message)

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id } = event.data
  try {
    const result = await runJob(event.data, (progress) => post({ id, type: 'progress', progress }))
    post({ id, type: 'result', result })
  } catch (error) {
    const { code, detail } = toLoadError(error)
    post({ id, type: 'error', code, detail })
  }
}
