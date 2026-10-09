import { describe, expect, it, vi } from 'vitest'
import { BackStack } from '../src/platform/backStack'

const create = () => new BackStack<{ name: string }>({ name: 'home' })
const names = (stack: BackStack<{ name: string }>) => stack.getState().screens.map((s) => s.name)

describe('BackStack', () => {
  it('starts at the root screen', () => {
    expect(names(create())).toEqual(['home'])
  })

  it('pops screens on Back, then hands Back to the system at the root', () => {
    const onRootBack = vi.fn()
    const stack = new BackStack<{ name: string }>({ name: 'home' }, onRootBack)
    stack.push({ name: 'settings' })
    stack.push({ name: 'about' })
    stack.back()
    expect(names(stack)).toEqual(['home', 'settings'])
    stack.back()
    expect(names(stack)).toEqual(['home'])
    expect(onRootBack).not.toHaveBeenCalled()
    stack.back()
    expect(names(stack)).toEqual(['home'])
    expect(onRootBack).toHaveBeenCalledOnce()
  })

  it('remembers the focus key of the screen being left', () => {
    const stack = create()
    stack.push({ name: 'settings' }, 'home-settings')
    stack.push({ name: 'about' }, 'settings-about')
    stack.back()
    const [home, settings] = stack.getState().screens
    expect(home.focusKey).toBe('home-settings')
    expect(settings.focusKey).toBe('settings-about')
  })

  it('keeps route params and gives each visit its own memo', () => {
    const stack = new BackStack<{ name: string; channelId?: string }>({ name: 'home' })
    stack.push({ name: 'player', channelId: 'c1' })
    const [home, player] = stack.getState().screens
    expect(player.channelId).toBe('c1')
    home.memo.index = 5
    stack.push({ name: 'settings' })
    expect(stack.getState().screens[0].memo).toEqual({ index: 5 })
    expect(stack.getState().screens[2].memo).toEqual({})
  })

  it('gives every visit a new id so returning remounts the screen', () => {
    const stack = create()
    stack.push({ name: 'settings' })
    const first = stack.getState().screens[1].id
    stack.back()
    stack.push({ name: 'settings' })
    expect(stack.getState().screens[1].id).not.toBe(first)
  })

  it('lets the newest handler consume Back before screens pop', () => {
    const stack = create()
    stack.push({ name: 'settings' })
    const calls: string[] = []
    stack.addHandler(() => (calls.push('screen'), false))
    const removeOverlay = stack.addHandler(() => (calls.push('overlay'), true))

    stack.back()
    expect(calls).toEqual(['overlay'])
    expect(names(stack)).toEqual(['home', 'settings'])

    removeOverlay()
    stack.back()
    expect(calls).toEqual(['overlay', 'screen'])
    expect(names(stack)).toEqual(['home'])
  })

  it('does not leave the app while a handler consumes Back at the root', () => {
    const onRootBack = vi.fn()
    const stack = new BackStack<{ name: string }>({ name: 'home' }, onRootBack)
    stack.addHandler(() => true)
    stack.back()
    expect(onRootBack).not.toHaveBeenCalled()
  })

  it('removes only the handler it was given', () => {
    const stack = create()
    const a = vi.fn(() => false)
    const b = vi.fn(() => false)
    stack.addHandler(a)
    const removeB = stack.addHandler(b)
    removeB()
    removeB()
    stack.back()
    expect(a).toHaveBeenCalledOnce()
    expect(b).not.toHaveBeenCalled()
  })

  it('notifies subscribers with a new state object on every change', () => {
    const stack = create()
    const listener = vi.fn()
    const unsubscribe = stack.subscribe(listener)
    const before = stack.getState()
    stack.push({ name: 'settings' })
    expect(listener).toHaveBeenCalledOnce()
    expect(stack.getState()).not.toBe(before)
    unsubscribe()
    stack.back()
    expect(listener).toHaveBeenCalledOnce()
  })
})
