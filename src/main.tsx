import './polyfills'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { library } from './data/library'
import { onRemoteKey } from './platform/keys'
import { installLifecycle } from './platform/lifecycle'
import { initFocus } from './ui/focus'
import { backStack } from './ui/navigation'
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
library.init()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
