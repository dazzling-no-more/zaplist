import { describe, expect, it } from 'vitest'
import { KeyCode, toKey } from '../src/platform/keys'

const tv = { desktop: false, inTextField: false }
const desktop = { desktop: true, inTextField: false }
const desktopInput = { desktop: true, inTextField: true }

describe('toKey', () => {
  it('maps the remote keys', () => {
    expect(toKey(37, tv)).toBe('left')
    expect(toKey(38, tv)).toBe('up')
    expect(toKey(39, tv)).toBe('right')
    expect(toKey(40, tv)).toBe('down')
    expect(toKey(13, tv)).toBe('ok')
    expect(toKey(461, tv)).toBe('back')
    expect(toKey(403, tv)).toBe('red')
    expect(toKey(404, tv)).toBe('green')
    expect(toKey(405, tv)).toBe('yellow')
    expect(toKey(406, tv)).toBe('blue')
    expect(toKey(415, tv)).toBe('play')
    expect(toKey(19, tv)).toBe('pause')
    expect(toKey(413, tv)).toBe('stop')
    expect(toKey(412, tv)).toBe('rewind')
    expect(toKey(417, tv)).toBe('fastForward')
    expect(toKey(457, tv)).toBe('info')
    expect(toKey(33, tv)).toBe('channelUp')
    expect(toKey(34, tv)).toBe('channelDown')
  })

  it('maps digits 48-57 to "0"-"9"', () => {
    expect(toKey(48, tv)).toBe('0')
    expect(toKey(53, tv)).toBe('5')
    expect(toKey(57, tv)).toBe('9')
  })

  it('ignores unknown keys', () => {
    expect(toKey(65, tv)).toBeUndefined()
    expect(toKey(0, tv)).toBeUndefined()
  })

  it('treats Escape and Backspace as Back only on desktop', () => {
    expect(toKey(KeyCode.Escape, desktop)).toBe('back')
    expect(toKey(KeyCode.Backspace, desktop)).toBe('back')
    expect(toKey(KeyCode.Escape, tv)).toBeUndefined()
    expect(toKey(KeyCode.Backspace, tv)).toBeUndefined()
  })

  it('leaves typing keys alone in text fields', () => {
    expect(toKey(KeyCode.Backspace, desktopInput)).toBeUndefined()
    expect(toKey(53, desktopInput)).toBeUndefined()
    expect(toKey(KeyCode.Escape, desktopInput)).toBe('back')
    expect(toKey(461, { desktop: false, inTextField: true })).toBe('back')
  })
})
