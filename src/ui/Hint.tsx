import type { ReactNode } from 'react'

/** A remote key in a hint: a key cap with its name or an icon, or a color key's dot. */
export function Key({ children, color }: { children?: ReactNode; color?: 'red' | 'yellow' }) {
  return <span className={color ? `key color ${color}` : 'key'}>{children}</span>
}

/** Keys, then what they do (in a `.hints` bar). */
export function Hint({ keys, label }: { keys: ReactNode; label: string }) {
  return (
    <span className="hint">
      {keys}
      {label}
    </span>
  )
}
