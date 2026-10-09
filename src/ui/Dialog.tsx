import { doesFocusableExist, getCurrentFocusKey, setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { useEffect, useId } from 'react'
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
  buttons: DialogButton[]
  /** Index of the button focused when the dialog opens. */
  initialFocus?: number
  /** Back was pressed. */
  onCancel: () => void
}

/** Modal dialog: keeps focus inside, Back cancels, and focus returns to where it was on close. */
export function Dialog({ title, message, buttons, initialFocus = 0, onCancel }: Props) {
  const id = useId()
  useBackHandler(() => {
    onCancel()
    return true
  })
  useEffect(() => {
    const previous = getCurrentFocusKey()
    setFocus(`${id}-button-${initialFocus}`)
    return () => {
      if (doesFocusableExist(previous)) setFocus(previous)
    }
  }, [])

  return (
    <div className="dialog-backdrop">
      <Region focusKey={`${id}-dialog`} className="dialog" isFocusBoundary>
        <h2>{title}</h2>
        {message && <p>{message}</p>}
        <div className="dialog-buttons">
          {buttons.map((button, i) => (
            <Button key={i} focusKey={`${id}-button-${i}`} onPress={button.onPress}>
              {button.label}
            </Button>
          ))}
        </div>
      </Region>
    </div>
  )
}
