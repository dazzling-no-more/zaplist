import { doesFocusableExist, getCurrentFocusKey, ROOT_FOCUS_KEY, setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { useEffect, useId, type ReactNode } from 'react'
import { Button } from './Button'
import { useBackHandler } from './navigation'
import { Region } from './Region'

interface DialogButton {
  label: string
  onPress: () => void
}

interface Props {
  title: string
  message?: string
  children?: ReactNode
  buttons?: DialogButton[]
  /** Button index, or the focus key of a child, focused when the dialog opens. */
  initialFocus?: number | string
  /** Back was pressed. */
  onCancel: () => void
  className?: string
}

/** Modal dialog: keeps focus inside, Back cancels, and focus returns to where it was on close. */
export function Dialog({ title, message, children, buttons = [], initialFocus = 0, onCancel, className }: Props) {
  const id = useId()
  useBackHandler(() => {
    onCancel()
    return true
  })
  useEffect(() => {
    const previous = getCurrentFocusKey()
    setFocus(typeof initialFocus === 'string' ? initialFocus : `${id}-button-${initialFocus}`)
    return () => {
      setFocus(doesFocusableExist(previous) ? previous : ROOT_FOCUS_KEY)
    }
  }, [])

  return (
    <div className="dialog-backdrop">
      <Region focusKey={`${id}-dialog`} className={`dialog${className ? ' ' + className : ''}`} isFocusBoundary>
        <h2>{title}</h2>
        {message && <p>{message}</p>}
        {children}
        {buttons.length > 0 && (
          <div className="dialog-buttons">
            {buttons.map((button, i) => (
              <Button key={i} focusKey={`${id}-button-${i}`} onPress={button.onPress}>
                {button.label}
              </Button>
            ))}
          </div>
        )}
      </Region>
    </div>
  )
}
