/** Returns true when it consumed the Back press. */
export type BackHandler = () => boolean

export interface ScreenEntry<S extends string> {
  /** Unique per visit, so a screen remounts when the user comes back to it. */
  readonly id: number
  readonly name: S
  /** What was focused when the user left this screen; restored on return. */
  readonly focusKey?: string
}

export interface BackStackState<S extends string> {
  readonly screens: readonly ScreenEntry<S>[]
  /** The user pressed Back on the root screen and must confirm leaving the app. */
  readonly exitPrompt: boolean
}

/**
 * Routes the Back key. The most recently added handler goes first (overlays, OSD); if no handler
 * consumes the press, the top screen closes; on the root screen, an exit prompt is requested.
 */
export class BackStack<S extends string> {
  private state: BackStackState<S>
  private readonly handlers: BackHandler[] = []
  private readonly listeners = new Set<() => void>()
  private nextId = 1

  constructor(root: S) {
    this.state = { screens: [{ id: 0, name: root }], exitPrompt: false }
  }

  getState = (): BackStackState<S> => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Opens `name` on top. `leavingFocusKey` is what to focus when the user comes back. */
  push(name: S, leavingFocusKey?: string): void {
    const screens = this.state.screens.slice()
    screens[screens.length - 1] = { ...screens[screens.length - 1], focusKey: leavingFocusKey }
    screens.push({ id: this.nextId++, name })
    this.set({ screens })
  }

  /** Adds a handler above all others. Returns a function that removes it. */
  addHandler(handler: BackHandler): () => void {
    this.handlers.push(handler)
    return () => {
      const index = this.handlers.lastIndexOf(handler)
      if (index >= 0) this.handlers.splice(index, 1)
    }
  }

  back(): void {
    for (let i = this.handlers.length - 1; i >= 0; i--) {
      if (this.handlers[i]()) return
    }
    const { screens } = this.state
    if (screens.length > 1) this.set({ screens: screens.slice(0, -1) })
    else this.set({ exitPrompt: true })
  }

  closeExitPrompt(): void {
    this.set({ exitPrompt: false })
  }

  private set(patch: Partial<BackStackState<S>>): void {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((listener) => listener())
  }
}
