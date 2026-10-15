/** Bytes the app stores and its quota. TVs give an app a share of their free space: tens of megabytes. */
export interface StorageUse {
  usage: number
  quota: number
}

interface LegacyQuota {
  queryUsageAndQuota(success: (usage: number, quota: number) => void, error?: () => void): void
}

/** The app's storage use; undefined where the engine can't tell. */
export async function storageUse(): Promise<StorageUse | undefined> {
  // Chromium 61+ (webOS 5 and later).
  if (navigator.storage && navigator.storage.estimate) {
    const estimate = await navigator.storage.estimate().catch(() => undefined)
    if (estimate && estimate.quota) return { usage: estimate.usage ?? 0, quota: estimate.quota }
  }
  // Chromium 53 (webOS 4) has only the prefixed API.
  const legacy = (navigator as Navigator & { webkitTemporaryStorage?: LegacyQuota }).webkitTemporaryStorage
  if (!legacy) return undefined
  return new Promise((resolve) => legacy.queryUsageAndQuota((usage, quota) => resolve(quota ? { usage, quota } : undefined), () => resolve(undefined)))
}
