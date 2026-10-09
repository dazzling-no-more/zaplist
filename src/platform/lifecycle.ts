import { activateApp } from './webos'

export function installLifecycle(): void {
  // With "handlesRelaunch": true in appinfo.json, webOS leaves bringing the app to the foreground to us.
  document.addEventListener('webOSRelaunch', activateApp, true)
}
