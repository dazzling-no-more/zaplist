import { ingestGuide, type GuideProgress, type GuideResult } from './guideIngest'
import { ingest } from './ingest'
import type { IngestProgress, IngestResult, Job } from '../workers/protocol'

/** Runs a job where it is called: in the worker, or on the main thread as the fallback. */
export function runJob(job: Job, progress: (p: IngestProgress | GuideProgress) => void): Promise<IngestResult | GuideResult> {
  return job.type === 'ingest' ? ingest(job.source, progress) : ingestGuide(job.urls, job.wanted, progress)
}
