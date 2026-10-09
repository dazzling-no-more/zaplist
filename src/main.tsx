import './polyfills'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { guide } from './data/guide'
import { library } from './data/library'
import { onRemoteKey } from './platform/keys'
import { installLifecycle } from './platform/lifecycle'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { initFocus } from './ui/focus'
import { backStack } from './ui/navigation'
import { resumeLastChannel } from './ui/play'
import './styles.css'

initFocus()
installLifecycle()
onRemoteKey((key, event) => {
  if (key !== 'back') return
  event.preventDefault()
  if (event.repeat) return
  // Back first leaves text entry, then walks the back stack.
  const active = document.activeElement
  if (active instanceof HTMLInputElement) active.blur()
  else backStack.back()
})
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
