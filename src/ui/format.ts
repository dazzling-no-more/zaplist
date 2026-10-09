import { LoadError } from '../data/http'
import { t } from '../i18n'
import type { IngestProgress } from '../workers/protocol'

export const formatCount = (n: number): string => n.toLocaleString()

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export const formatDate = (ms: number): string => new Date(ms).toLocaleDateString()

export function describeError(error: unknown): string {
  if (!(error instanceof LoadError)) return t('error.format')
  switch (error.code) {
    case 'http':
      return t('error.http', { detail: error.detail ?? '' })
    default:
      return t(`error.${error.code}`)
  }
}

export function describeProgress(progress: IngestProgress): string {
  switch (progress.stage) {
    case 'download':
      return progress.bytes ? t('progress.download', { size: formatBytes(progress.bytes) }) : t('progress.connecting')
    case 'parse':
      return t('progress.parse')
    case 'save':
      return t('progress.save', { count: formatCount(progress.channels ?? 0) })
  }
}
