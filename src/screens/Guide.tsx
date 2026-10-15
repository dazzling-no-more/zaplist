import { useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useProgrammes } from '../data/guide'
import { guideWindow, programmeAt, shiftMs } from '../data/guideData'
import { library, useLibrary } from '../data/library'
import { channelsByCategory, channelsForGroup } from '../data/lists'
import type { Channel, Programme } from '../data/models'
import { useUnlocked } from '../data/parental'
import { usePrefs } from '../data/prefs'
import { t } from '../i18n'
import { onRemoteKey } from '../platform/keys'
import { formatTime, useNow } from '../ui/clock'
import { Dialog } from '../ui/Dialog'
import { canHover, isPointerVisible } from '../ui/focus'
import { Hint, Key } from '../ui/Hint'
import { Logo } from '../ui/Logo'
import { useScreenFocus, type ScreenProps } from '../ui/navigation'
import { playChannel } from '../ui/play'
import { clampIndex, scrollToKeepVisible, visibleRange } from '../ui/scroll'

const MINUTE = 60_000
const SLOT = 30 * MINUTE
const VIEW = 3 * 60 * MINUTE
const CHANNEL_COLUMN = 420
const GRID_WIDTH = 1728 - CHANNEL_COLUMN
const PX_PER_MS = GRID_WIDTH / VIEW
const ROW = 84
const BODY_HEIGHT = 672
/** Widths (px, 12-hour times) of the time-now label's half and of a slot label, so they don't overlap. */
const NOW_LABEL_HALF = 72
const SLOT_LABEL = 140

const floorSlot = (time: number) => Math.floor(time / SLOT) * SLOT

/** Programmes with times as shown (tvg-shift and the global offset applied). */
function useShownProgrammes(channel: Channel | undefined, offsetMinutes: number): readonly Programme[] {
  const programmes = useProgrammes(channel)
  return useMemo(() => {
    const shift = shiftMs(channel, offsetMinutes)
    return shift && programmes ? programmes.map((p) => ({ ...p, start: p.start + shift, stop: p.stop + shift })) : (programmes ?? [])
  }, [programmes, channel?.epgShift, offsetMinutes])
}

/** The programme covering `time`, if any. */
function programmeCovering(programmes: readonly Programme[], time: number): Programme | undefined {
  const i = programmeAt(programmes, time)
  return i >= 0 && programmes[i].start <= time ? programmes[i] : undefined
}

export function GuideScreen({ entry }: ScreenProps<'guide'>) {
  const { channels } = useLibrary()
  const prefs = usePrefs()
  const unlocked = useUnlocked()
  const now = useNow()
  const memo = entry.memo as { row?: number; focusTime?: number; viewStart?: number }
  const list = useMemo(
    () => channelsForGroup(entry.listId, channels, (id) => library.channel(id), channelsByCategory(channels), prefs, unlocked),
    [channels, prefs.favorites, prefs.recents, prefs.pin, prefs.lockedCategories, unlocked],
  )
  const range = useMemo(() => {
    const { from, to } = guideWindow(Date.now())
    return { from: floorSlot(from + 60 * MINUTE), to: to - 2 * 60 * MINUTE }
  }, [])
  const [row, setRow] = useState(() => memo.row ?? Math.max(0, list.findIndex((c) => c.id === prefs.lastChannelId)))
  const [focusTime, setFocusTime] = useState(memo.focusTime ?? now)
  const [viewStart, setViewStart] = useState(memo.viewStart ?? floorSlot(now) - SLOT)
  const [details, setDetails] = useState<{ channel: Channel; programme: Programme }>()
  const top = useRef(0)
  const current = clampIndex(row, list.length)
  const channel = list[current]
  const programmes = useShownProgrammes(channel, prefs.epgOffsetMinutes)
  const focused = programmeCovering(programmes, focusTime)
  Object.assign(memo, { row: current, focusTime, viewStart })

  useScreenFocus(entry, 'guide-grid')

  const show = (time: number) => {
    const clamped = Math.max(range.from, Math.min(range.to, time))
    setFocusTime(clamped)
    setViewStart((start) => {
      if (clamped < start) return floorSlot(clamped)
      if (clamped >= start + VIEW - SLOT) return floorSlot(clamped) - SLOT
      return start
    })
  }

  const actions = {
    vertical: (delta: number) => setRow((r) => clampIndex(r + delta, list.length)),
    horizontal: (direction: -1 | 1) => {
      if (direction > 0) {
        if (focused) return show(focused.stop)
        const next = programmes[programmeAt(programmes, focusTime)]
        return show(next && next.start - focusTime <= SLOT ? next.start : focusTime + SLOT)
      }
      // Left: the programme right before this one, or half an hour back across a gap.
      const edge = focused ? focused.start : focusTime
      const before = programmeCovering(programmes, edge - 1)
      show(before ? Math.max(before.start, range.from) : edge - SLOT)
    },
    /** OK on a programme: one on air (or no guide data) plays the channel, others show their details. */
    open: (target: Channel | undefined, programme: Programme | undefined) => {
      if (!target) return
      if (programme && !(programme.start <= now && now < programme.stop)) setDetails({ channel: target, programme })
      else playChannel(target, entry.listId)
    },
    select: () => actions.open(channel, focused),
  }
  const latest = useRef(actions)
  latest.current = actions

  const { ref, focused: gridFocused, focusSelf } = useFocusable<object, HTMLDivElement>({
    focusKey: 'guide-grid',
    focusable: list.length > 0,
    onArrowPress: (direction) => {
      if (direction === 'up') latest.current.vertical(-1)
      else if (direction === 'down') latest.current.vertical(1)
      else latest.current.horizontal(direction === 'left' ? -1 : 1)
      return false
    },
    onEnterPress: () => {
      if (!isPointerVisible()) latest.current.select()
    },
  })

  useEffect(() => {
    if (!gridFocused) return
    const page = Math.floor(BODY_HEIGHT / ROW) - 1
    return onRemoteKey((key, event) => {
      if (key === 'channelUp') latest.current.vertical(-page)
      else if (key === 'channelDown') latest.current.vertical(page)
      else return
      event.preventDefault()
    })
  }, [gridFocused])

  top.current = scrollToKeepVisible(top.current, current, ROW, BODY_HEIGHT, list.length)
  const [first, last] = visibleRange(top.current, ROW, BODY_HEIGHT, list.length, 1)
  const slots: number[] = []
  for (let s = viewStart; s < viewStart + VIEW; s += SLOT) slots.push(s)
  const nowLeft = (now - viewStart) * PX_PER_MS
  const nowShown = nowLeft >= 0 && nowLeft <= GRID_WIDTH

  const rows = []
  for (let i = first; i <= last; i++) {
    rows.push(
      <GuideRow
        key={list[i].id}
        channel={list[i]}
        top={i * ROW - top.current}
        viewStart={viewStart}
        now={now}
        offsetMinutes={prefs.epgOffsetMinutes}
        focusTime={gridFocused && i === current ? focusTime : undefined}
        onPointer={(time, select, programme) => {
          if (!canHover() && !select) return
          focusSelf()
          setRow(i)
          setFocusTime(time)
          // The clicked row and programme: the focused ones are still from before this click.
          if (select) latest.current.open(list[i], programme)
        }}
      />,
    )
  }

  return (
    <div className="guide">
      <div className="guide-details">
        <div className="guide-details-title">
          {channel ? `${channel.number} · ${channel.name}` : t('guide.empty')}
          {focused && <span className="dim"> · {formatTime(focused.start)}–{formatTime(focused.stop)}</span>}
        </div>
        <div className="guide-details-programme">{focused ? focused.title : channel ? t('guide.noInfo') : ''}</div>
        <div className="guide-details-desc dim">{focused?.description ?? ''}</div>
      </div>
      <div className="guide-header">
        <span className="guide-header-day">{new Date(viewStart).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}</span>
        {slots.map((s) => {
          const left = (s - viewStart) * PX_PER_MS
          // The time-now label takes the place of a slot label it would cover.
          if (nowShown && nowLeft > left - NOW_LABEL_HALF && nowLeft < left + SLOT_LABEL + NOW_LABEL_HALF) return null
          return (
            <span key={s} className="guide-slot" style={{ left: CHANNEL_COLUMN + left }}>
              {formatTime(s)}
            </span>
          )
        })}
        {nowShown && (
          <span className="guide-now-time" style={{ left: CHANNEL_COLUMN + nowLeft }}>
            {formatTime(now)}
          </span>
        )}
      </div>
      <div ref={ref} className="guide-body" style={{ height: BODY_HEIGHT }} onWheel={(e) => latest.current.vertical(e.deltaY > 0 ? 3 : -3)}>
        {rows}
        {nowShown && <div className="guide-now" style={{ left: CHANNEL_COLUMN + nowLeft }} />}
      </div>
      <div className="hints">
        <Hint keys={<Key>{t('key.ok')}</Key>} label={t('guide.hintWatch')} />
        <Hint keys={<Key>{t('key.channel')}</Key>} label={t('guide.hintPage')} />
      </div>
      {details && (
        <Dialog
          title={details.programme.title}
          message={`${details.channel.name} · ${formatTime(details.programme.start)}–${formatTime(details.programme.stop)}${details.programme.description ? '\n\n' + details.programme.description : ''}`}
          buttons={[{ label: t('common.ok'), onPress: () => setDetails(undefined) }]}
          onCancel={() => setDetails(undefined)}
          className="details-dialog"
        />
      )}
    </div>
  )
}

interface RowProps {
  channel: Channel
  top: number
  viewStart: number
  /** Programmes before it are dimmed, the one on air is marked. */
  now: number
  offsetMinutes: number
  /** Set on the focused row: the time whose programme is highlighted. */
  focusTime?: number
  /** `programme`: the one under the pointer, if any. */
  onPointer: (time: number, select: boolean, programme?: Programme) => void
}

const GuideRow = memo(function GuideRow({ channel, top, viewStart, now, offsetMinutes, focusTime, onPointer }: RowProps) {
  const programmes = useShownProgrammes(channel, offsetMinutes)
  const viewEnd = viewStart + VIEW
  const cells = []
  let i = programmeAt(programmes, viewStart)
  for (; i >= 0 && i < programmes.length && programmes[i].start < viewEnd; i++) {
    const p = programmes[i]
    const left = (Math.max(p.start, viewStart) - viewStart) * PX_PER_MS
    const width = (Math.min(p.stop, viewEnd) - Math.max(p.start, viewStart)) * PX_PER_MS
    const isFocused = focusTime !== undefined && p.start <= focusTime && focusTime < p.stop
    const time = Math.max(p.start, viewStart)
    const when = p.stop <= now ? ' past' : p.start <= now ? ' live' : ''
    cells.push(
      <div
        key={p.start}
        className={`guide-cell${when}${isFocused ? ' focused' : ''}`}
        style={{ left, width: Math.max(0, width - 4) }}
        onMouseEnter={() => onPointer(time, false, p)}
        onClick={() => onPointer(time, true, p)}
      >
        {p.title}
      </div>,
    )
  }
  if (!cells.length) {
    const isFocused = focusTime !== undefined
    cells.push(
      <div
        key="none"
        className={`guide-cell empty${isFocused ? ' focused' : ''}`}
        style={{ left: 0, width: GRID_WIDTH - 4 }}
        onMouseEnter={() => onPointer(viewStart, false)}
        onClick={() => onPointer(viewStart, true)}
      >
        {t('guide.noInfo')}
      </div>,
    )
  }
  return (
    <div className="guide-row" style={{ transform: `translate3d(0, ${top}px, 0)` }}>
      <div className={`guide-channel${focusTime !== undefined ? ' focused-row' : ''}`}>
        <span className="channel-number">{channel.number}</span>
        <Logo url={channel.logo} name={channel.name} />
        <span className="guide-channel-name">{channel.name}</span>
      </div>
      <div className="guide-cells">{cells}</div>
    </div>
  )
})
