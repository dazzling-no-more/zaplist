import { Component, useEffect, type ReactNode } from 'react'
import { t } from '../i18n'
import { recordError } from '../player/diagnostics'

interface State {
  error?: Error
}

/** Last line of defence: an unexpected crash shows a message and a way out instead of a blank screen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = {}

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error): void {
    recordError(`App error: ${error.message}`)
  }

  render() {
    return this.state.error ? <Crash message={this.state.error.message} /> : this.props.children
  }
}

function Crash({ message }: { message: string }) {
  // Spatial navigation may be in a broken state, so plain OK (or a click) restarts the app.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.keyCode === 13) location.reload()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  return (
    <div className="crash" onClick={() => location.reload()}>
      <h1>{t('crash.title')}</h1>
      <p>{t('crash.detail')}</p>
      <p className="dim small">{message}</p>
    </div>
  )
}
