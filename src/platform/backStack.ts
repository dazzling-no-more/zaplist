/** Returns true when it consumed the Back press. */
export type BackHandler = () => boolean

export interface Route {
  readonly name: string
}

export type ScreenEntry<R extends Route> = R & {
  /** Unique per visit, so a screen remounts when the user comes back to it. */
  readonly id: number
  /** What was focused when the user left this screen; restored on return. */
  readonly focusKey?: string
  /** UI state the screen keeps while it's in the stack (selected category, list position). */
  readonly memo: Record<string, unknown>
}

export interface BackStackState<R extends Route> {
  readonly screens: readonly ScreenEntry<R>[]
  /** The user pressed Back on the root screen and must confirm leaving the app. */
  readonly exitPrompt: boolean
}

/**
 * Routes the Back key. The most recently added handler goes first (overlays, OSD); if no handler
 * consumes the press, the top screen closes; on the root screen, an exit prompt is requested.
 */
export class BackStack<R extends Route> {
  private state: BackStackState<R>
  private readonly handlers: BackHandler[] = []
  private readonly listeners = new Set<() => void>()
  private nextId = 1

  constructor(root: R) {
    this.state = { screens: [{ ...root, id: 0, memo: {} }], exitPrompt: false }
  }

  getState = (): BackStackState<R> => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Opens `route` on top. `leavingFocusKey` is what to focus when the user comes back. */
  push(route: R, leavingFocusKey?: string): void {
    const screens = this.state.screens.slice()
    screens[screens.length - 1] = { ...screens[screens.length - 1], focusKey: leavingFocusKey }
    screens.push({ ...route, id: this.nextId++, memo: {} })
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
    if (!this.pop()) this.set({ exitPrompt: true })
  }

  /** Closes the top screen unless it is the root. Returns false at the root. */
  pop(): boolean {
    const { screens } = this.state
    if (screens.length < 2) return false
    this.set({ screens: screens.slice(0, -1) })
    return true
  }

  closeExitPrompt(): void {
    this.set({ exitPrompt: false })
  }

  private set(patch: Partial<BackStackState<R>>): void {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((listener) => listener())
  }
}
