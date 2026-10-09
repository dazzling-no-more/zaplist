import { isWebOS } from './webos'

interface ConnectionStatus {
  isInternetConnectionAvailable?: boolean
}

/**
 * Reports network up/down: the webOS connection manager (subscription) on the TV, the browser's
 * online/offline events elsewhere. May report the same state twice. Returns an unsubscribe function.
 */
export function onNetworkChange(listener: (online: boolean) => void): () => void {
  const online = () => listener(true)
  const offline = () => listener(false)
  window.addEventListener('online', online)
  window.addEventListener('offline', offline)
  const request =
    isWebOS() && window.webOS?.service
      ? window.webOS.service.request('luna://com.webos.service.connectionmanager', {
          method: 'getStatus',
          parameters: { subscribe: true },
          onSuccess: (status: ConnectionStatus) => {
            if (typeof status.isInternetConnectionAvailable === 'boolean') listener(status.isInternetConnectionAvailable)
          },
        })
      : undefined
  return () => {
    window.removeEventListener('online', online)
    window.removeEventListener('offline', offline)
    request?.cancel()
  }
}
