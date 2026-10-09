import './polyfills'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { guide } from './data/guide'
import { library } from './data/library'
import { onRemoteKey } from './platform/keys'
import { installLifecycle } from './platform/lifecycle'
import { fitToWindow } from './platform/screen'
import { isWebOS } from './platform/webos'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { initFocus } from './ui/focus'
import { backStack } from './ui/navigation'
import { resumeLastChannel } from './ui/play'
import './styles.css'

fitToWindow()
initFocus()
installLifecycle()
/** Back first leaves text entry, then walks the back stack. */
function goBack() {
  const active = document.activeElement
  if (active instanceof HTMLInputElement) active.blur()
  else backStack.back()
}

onRemoteKey((key, event) => {
  if (key !== 'back') return
  event.preventDefault()
  if (!event.repeat) goBack()
})

// In a desktop browser, the browser's (or the mouse's) Back button acts like the remote's Back: keep
// one spare history entry and turn each return to it into an app Back. On the TV, Back is key 461.
if (!isWebOS()) {
  history.pushState(null, '')
  window.addEventListener('popstate', () => {
    history.pushState(null, '')
    goBack()
  })
}
// Dev builds only: lets browser automation reach any screen directly.
if (import.meta.env.DEV) Object.assign(window, { __app: { backStack, library, guide } })

library.init().then(() => {
  resumeLastChannel()
  void guide.start()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
