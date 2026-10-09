import { useState } from 'react'
import { t } from '../i18n'
import { Button } from '../ui/Button'
import { useScreenFocus, type ScreenProps } from '../ui/navigation'
import { Region } from '../ui/Region'

const SECTIONS = ['sources', 'guide', 'parental', 'about'] as const
type Section = (typeof SECTIONS)[number]

export function SettingsScreen({ entry }: ScreenProps) {
  const [section, setSection] = useState<Section>('sources')
  useScreenFocus(entry, 'settings-sources')

  return (
    <div className="screen">
      <Region focusKey="settings-menu" className="sidebar">
        <h1>{t('settings.title')}</h1>
        {SECTIONS.map((s) => (
          <Button key={s} focusKey={`settings-${s}`} selected={s === section} onPress={() => setSection(s)}>
            {t(`settings.${s}`)}
          </Button>
        ))}
      </Region>
      <div className="content">
        <h2>{t(`settings.${section}`)}</h2>
        <p className="dim">{t('settings.notAvailable')}</p>
      </div>
    </div>
  )
}
