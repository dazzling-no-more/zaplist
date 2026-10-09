import { useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { useRef } from 'react'
import { hoverToFocus, isPointerVisible } from './focus'

interface Props {
  focusKey?: string
  label: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'password' | 'url'
  placeholder?: string
}

/**
 * A text input inside spatial navigation. OK starts editing (on webOS this opens the on-screen
 * keyboard); OK, Up/Down or Back stop editing. While editing, Left/Right move the caret.
 */
export function TextField({ focusKey, label, value, onChange, type = 'text', placeholder }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const editing = () => document.activeElement === input.current
  const { ref, focused, focusSelf } = useFocusable<object, HTMLLabelElement>({
    focusKey,
    onEnterPress: () => {
      if (editing()) input.current?.blur()
      else if (!isPointerVisible()) input.current?.focus()
    },
    onArrowPress: (direction) => {
      if (!editing()) return true
      if (direction === 'left' || direction === 'right') return false
      input.current?.blur()
      return true
    },
    onBlur: () => input.current?.blur(),
  })

  return (
    <label ref={ref} className={`field${focused ? ' focused' : ''}`} onMouseEnter={hoverToFocus(focusSelf)} onClick={focusSelf}>
      <span className="field-label">{label}</span>
      <input
        ref={input}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
      />
    </label>
  )
}
