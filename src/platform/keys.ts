import { isWebOS } from './webos'

/** LG remote key codes. webOS 4 doesn't fill `KeyboardEvent.key` for remote keys, so we match on `keyCode`. */
export const KeyCode = {
  Left: 37,
  Up: 38,
  Right: 39,
  Down: 40,
  Ok: 13,
  Back: 461,
  Red: 403,
  Green: 404,
  Yellow: 405,
  Blue: 406,
  Play: 415,
  Pause: 19,
  Stop: 413,
  Rewind: 412,
  FastForward: 417,
  ChannelUp: 33,
  ChannelDown: 34,
  Digit0: 48,
  Digit9: 57,
  // Desktop keyboards only.
  Escape: 27,
  Backspace: 8,
} as const

export type Digit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'

export type Key =
  | 'left'
  | 'up'
  | 'right'
  | 'down'
  | 'ok'
  | 'back'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'play'
  | 'pause'
  | 'stop'
  | 'rewind'
  | 'fastForward'
  | 'channelUp'
  | 'channelDown'
  | Digit

const REMOTE_KEYS: Record<number, Key> = {
  [KeyCode.Left]: 'left',
  [KeyCode.Up]: 'up',
  [KeyCode.Right]: 'right',
  [KeyCode.Down]: 'down',
  [KeyCode.Ok]: 'ok',
  [KeyCode.Back]: 'back',
  [KeyCode.Red]: 'red',
  [KeyCode.Green]: 'green',
  [KeyCode.Yellow]: 'yellow',
  [KeyCode.Blue]: 'blue',
  [KeyCode.Play]: 'play',
  [KeyCode.Pause]: 'pause',
  [KeyCode.Stop]: 'stop',
  [KeyCode.Rewind]: 'rewind',
  [KeyCode.FastForward]: 'fastForward',
  [KeyCode.ChannelUp]: 'channelUp',
  [KeyCode.ChannelDown]: 'channelDown',
}

export interface KeyContext {
  /** Running in a desktop browser: Escape and Backspace also mean Back. */
  desktop: boolean
  /** The key went to a text field, so digits and Backspace are typing, not commands. */
  inTextField: boolean
}

export function toKey(keyCode: number, { desktop, inTextField }: KeyContext): Key | undefined {
  if (keyCode >= KeyCode.Digit0 && keyCode <= KeyCode.Digit9) {
    return inTextField ? undefined : (String(keyCode - KeyCode.Digit0) as Digit)
  }
  if (desktop && keyCode === KeyCode.Escape) return 'back'
  if (desktop && keyCode === KeyCode.Backspace) return inTextField ? undefined : 'back'
  return REMOTE_KEYS[keyCode]
}

/** Calls `handler` for every keydown that maps to a remote key. Returns a function that stops listening. */
export function onRemoteKey(handler: (key: Key, event: KeyboardEvent) => void): () => void {
  const desktop = !isWebOS()
  const listener = (event: KeyboardEvent) => {
    const target = event.target
    const inTextField = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
    const key = toKey(event.keyCode, { desktop, inTextField })
    if (key) handler(key, event)
  }
  window.addEventListener('keydown', listener)
  return () => window.removeEventListener('keydown', listener)
}
