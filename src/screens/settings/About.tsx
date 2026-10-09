import { useState } from 'react'
import appinfo from '../../../appinfo.json'
import { guide, useGuideStatus } from '../../data/guide'
import { library, useLibrary } from '../../data/library'
import { parsingMode } from '../../data/worker'
import { t } from '../../i18n'
import { deviceInfo, isWebOS } from '../../platform/webos'
import { diagnostics } from '../../player/diagnostics'
import { Button } from '../../ui/Button'
import { formatTime } from '../../ui/clock'
import { Dialog } from '../../ui/Dialog'
import { formatCount, formatDate } from '../../ui/format'
import { clearLogoCache } from '../../ui/Logo'
import { Region } from '../../ui/Region'

export function AboutSection() {
  const { sources, channels } = useLibrary()
  const guideStatus = useGuideStatus()
  const [confirm, setConfirm] = useState(false)
  const [clearing, setClearing] = useState<string>()
  const device = deviceInfo()
  const engine = /Chrome\/(\d+)/.exec(navigator.userAgent)?.[1]

  const rows: [string, string][] = [
    [t('about.version'), `${appinfo.title} ${appinfo.version}`],
    [t('about.model'), device?.modelName ?? (isWebOS() ? '—' : t('about.notWebOS'))],
    [t('about.webosVersion'), device?.platformVersion ?? '—'],
    [t('about.browser'), engine ? `Chromium ${engine}` : '—'],
    [t('about.playback'), diagnostics.engine ?? t('about.notYet')],
    [
      t('about.lastError'),
      diagnostics.lastError ? `${diagnostics.lastError} (${formatDate(diagnostics.lastErrorAt!)} ${formatTime(diagnostics.lastErrorAt!)})` : t('about.none'),
    ],
    [t('about.parsing'), parsingMode()],
    [
      t('about.data'),
      t('about.dataValue', {
        sources: sources.length,
        channels: formatCount(channels.length),
        programmes: formatCount(guideStatus.programmes ?? 0),
      }),
    ],
  ]

  const clear = async () => {
    setConfirm(false)
    setClearing(t('about.clearing'))
    clearLogoCache()
    const failed = await library.clearCache()
    guide.invalidate()
    void guide.refresh()
    setClearing(failed ? t('about.clearedSomeFailed', { count: failed }) : t('about.cleared'))
  }

  return (
    <Region focusKey="settings-content" className="content">
      <h2>{t('settings.about')}</h2>
      <table className="facts">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <th>{label}</th>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>{t('about.cache')}</h3>
      <p className="dim small">{clearing ?? t('about.cacheDetail')}</p>
      <Button focusKey="about-clear" className="inline" onPress={() => setConfirm(true)}>
        {t('about.clear')}
      </Button>
      <p className="dim small legal">{t('about.legal')}</p>
      {confirm && (
        <Dialog
          title={t('about.clearTitle')}
          message={t('about.clearMessage')}
          buttons={[
            { label: t('about.clear'), onPress: () => void clear() },
            { label: t('common.cancel'), onPress: () => setConfirm(false) },
          ]}
          initialFocus={1}
          onCancel={() => setConfirm(false)}
        />
      )}
    </Region>
  )
}
