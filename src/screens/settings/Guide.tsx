import { guide, useGuideStatus } from '../../data/guide'
import { MAX_OFFSET_MINUTES } from '../../data/guideData'
import { updatePrefs, usePrefs } from '../../data/prefs'
import { t } from '../../i18n'
import { Button } from '../../ui/Button'
import { formatTime } from '../../ui/clock'
import { describeError, formatBytes, formatCount, formatDate } from '../../ui/format'
import { Region } from '../../ui/Region'
import { TextField } from '../../ui/TextField'

const OFFSET_STEP = 30
const INTERVALS = [6, 12, 24]

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '−' : '+'
  const abs = Math.abs(minutes)
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`
}

export function GuideSection() {
  const prefs = usePrefs()
  const status = useGuideStatus()
  const offset = prefs.epgOffsetMinutes
  const setOffset = (minutes: number) => updatePrefs({ epgOffsetMinutes: Math.max(-MAX_OFFSET_MINUTES, Math.min(MAX_OFFSET_MINUTES, minutes)) })

  let state: string
  if (status.progress?.stage === 'save') state = t('guideSettings.saving')
  else if (status.progress)
    state = status.progress.bytes
      ? t('guideSettings.downloading', { size: formatBytes(status.progress.bytes), url: status.progress.url ?? 1, urls: status.progress.urls ?? 1 })
      : t('progress.connecting')
  else if (status.refreshedAt)
    state = t('guideSettings.updated', {
      date: `${formatDate(status.refreshedAt)} ${formatTime(status.refreshedAt)}`,
      channels: formatCount(status.channels ?? 0),
      programmes: formatCount(status.programmes ?? 0),
    })
  else state = t('guideSettings.never')

  return (
    <Region focusKey="settings-content" className="content form">
      <h2>{t('settings.guide')}</h2>
      <p className="dim small">{state}</p>
      {!!status.failedUrls && !status.progress && <p className="error small">{t('guideSettings.someFailed', { count: status.failedUrls })}</p>}
      {status.error && !status.progress && <p className="error small">{describeError(status.error)}</p>}
      <Button focusKey="guide-refresh" className="inline" onPress={() => void guide.refresh()}>
        {t('guideSettings.refresh')}
      </Button>
      <h3>{t('guideSettings.urlTitle')}</h3>
      <TextField
        focusKey="guide-url"
        label={t('guideSettings.url')}
        value={prefs.epgUrl ?? ''}
        onChange={(value) => updatePrefs({ epgUrl: value.trim() ? value : undefined })}
        type="url"
        placeholder="http://"
      />
      <h3>{t('guideSettings.offset')}</h3>
      <div className="button-row stepper">
        <Button onPress={() => setOffset(offset - OFFSET_STEP)}>{t('guideSettings.earlier')}</Button>
        <span className="stepper-value">{formatOffset(offset)}</span>
        <Button onPress={() => setOffset(offset + OFFSET_STEP)}>{t('guideSettings.later')}</Button>
      </div>
      <h3>{t('guideSettings.interval')}</h3>
      <div className="button-row">
        {INTERVALS.map((hours) => (
          <Button key={hours} selected={prefs.epgRefreshHours === hours} onPress={() => updatePrefs({ epgRefreshHours: hours })}>
            {t('guideSettings.hours', { hours })}
          </Button>
        ))}
      </div>
    </Region>
  )
}
