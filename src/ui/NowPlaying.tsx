import { useProgrammes } from '../data/guide'
import { nowNext, shiftMs } from '../data/guideData'
import type { Channel } from '../data/models'
import { usePrefs } from '../data/prefs'
import { t } from '../i18n'
import { formatTime, useNow } from './clock'

function Progress({ value }: { value: number }) {
  return (
    <span className="progress">
      <span style={{ transform: `scaleX(${Math.max(0, Math.min(1, value))})` }} />
    </span>
  )
}

/** The programme on now with a progress bar, for channel rows. */
export function NowPlaying({ channel }: { channel: Channel }) {
  const programmes = useProgrammes(channel)
  const now = useNow()
  const shift = shiftMs(channel, usePrefs().epgOffsetMinutes)
  const current = nowNext(programmes, now, shift).now
  if (!current) return null
  return (
    <div className="now-line">
      <span className="now-title">{current.title}</span>
      <Progress value={(now - shift - current.start) / (current.stop - current.start)} />
    </div>
  )
}

/** Now and next with times, for the player OSD. */
export function NowNext({ channel }: { channel: Channel }) {
  const programmes = useProgrammes(channel)
  const now = useNow()
  const shift = shiftMs(channel, usePrefs().epgOffsetMinutes)
  const { now: current, next } = nowNext(programmes, now, shift)
  const times = (p: { start: number; stop: number }) => `${formatTime(p.start + shift)}–${formatTime(p.stop + shift)}`
  if (!current && !next) return <div className="osd-programme dim">{t('guide.noInfo')}</div>
  return (
    <div className="osd-programme">
      {current && (
        <div className="osd-now">
          <span className="osd-times">{times(current)}</span>
          <span className="now-title">{current.title}</span>
          <Progress value={(now - shift - current.start) / (current.stop - current.start)} />
        </div>
      )}
      {next && (
        <div className="osd-next dim">
          <span className="osd-times">{times(next)}</span>
          {t('guide.next', { title: next.title })}
        </div>
      )}
    </div>
  )
}
