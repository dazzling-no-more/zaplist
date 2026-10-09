import { useState } from 'react'
import { t } from '../i18n'
import { Button } from '../ui/Button'
import { useScreenFocus, type ScreenProps } from '../ui/navigation'
import { Region } from '../ui/Region'
import { GuideSection } from './settings/Guide'
import { ParentalSection } from './settings/Parental'
import { SourcesSection } from './settings/Sources'

const SECTIONS = ['sources', 'guide', 'parental', 'about'] as const
type Section = (typeof SECTIONS)[number]

export function SettingsScreen({ entry }: ScreenProps<'settings'>) {
  const [section, setSection] = useState<Section>((entry.memo.section as Section) ?? 'sources')
  useScreenFocus(entry, `settings-${section}`)

  const select = (s: Section) => {
    entry.memo.section = s
    setSection(s)
  }

  return (
    <div className="screen">
      <Region focusKey="settings-menu" className="sidebar">
        <h1>{t('settings.title')}</h1>
        {SECTIONS.map((s) => (
          <Button key={s} focusKey={`settings-${s}`} selected={s === section} onPress={() => select(s)} onFocus={() => select(s)}>
            {t(`settings.${s}`)}
          </Button>
        ))}
      </Region>
      {section === 'sources' ? (
        <SourcesSection />
      ) : section === 'guide' ? (
        <GuideSection />
      ) : section === 'parental' ? (
        <ParentalSection />
      ) : (
        <div className="content">
          <h2>{t(`settings.${section}`)}</h2>
          <p className="dim">{t('settings.notAvailable')}</p>
        </div>
      )}
    </div>
  )
}
