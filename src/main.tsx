import './polyfills'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
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
  if (!event.repeat) backStack.back()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
