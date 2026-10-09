import { useEffect, useId, useState } from 'react'
import { t } from '../i18n'
import { onRemoteKey } from '../platform/keys'
import { Button } from './Button'
import { Dialog } from './Dialog'

const PIN_LENGTH = 4
const ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['clear', '0', 'delete'],
] as const

interface Props {
  title: string
  message?: string
  /** Called with all four digits. Return false when the PIN is wrong to clear it and show an error. */
  onSubmit: (pin: string) => boolean | void
  onCancel: () => void
}

/** Four-digit PIN entry with the remote's number keys or an on-screen keypad (arrows + OK). */
export function PinDialog({ title, message, onSubmit, onCancel }: Props) {
  const id = useId()
  const [digits, setDigits] = useState('')
  const [wrong, setWrong] = useState(false)

  const press = (key: string) => {
    setWrong(false)
    if (key === 'clear') setDigits('')
    else if (key === 'delete') setDigits((d) => d.slice(0, -1))
    else setDigits((d) => (d.length < PIN_LENGTH ? d + key : d))
  }

  useEffect(() => {
    if (digits.length < PIN_LENGTH) return
    if (onSubmit(digits) === false) {
      setWrong(true)
      setDigits('')
    }
  }, [digits])

  useEffect(
    () =>
      onRemoteKey((key, event) => {
        if (key.length !== 1) return
        event.preventDefault()
        press(key)
      }),
    [],
  )

  return (
    <Dialog
      title={title}
      message={wrong ? t('pin.wrong') : message}
      initialFocus={`${id}-5`}
      buttons={[{ label: t('common.cancel'), onPress: onCancel }]}
      onCancel={onCancel}
      className="pin-dialog"
    >
      <div className="pin-dots">
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <span key={i} className={i < digits.length ? 'filled' : ''} />
        ))}
      </div>
      {ROWS.map((row, r) => (
        <div key={r} className="keypad-row">
          {row.map((key) => (
            <Button key={key} focusKey={`${id}-${key}`} className="keypad-key" onPress={() => press(key)}>
              {key === 'clear' ? t('pin.clear') : key === 'delete' ? t('pin.delete') : key}
            </Button>
          ))}
        </div>
      ))}
    </Dialog>
  )
}
