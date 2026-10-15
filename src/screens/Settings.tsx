import { useState } from 'react'
import { t } from '../i18n'
import { Button } from '../ui/Button'
import type { IconName } from '../ui/Icon'
import { useScreenFocus, type ScreenProps } from '../ui/navigation'
import { Region } from '../ui/Region'
import { AboutSection } from './settings/About'
import { GuideSection } from './settings/Guide'
import { ParentalSection } from './settings/Parental'
import { SourcesSection } from './settings/Sources'

const SECTIONS = ['sources', 'guide', 'parental', 'about'] as const
type Section = (typeof SECTIONS)[number]
const ICONS: Record<Section, IconName> = { sources: 'playlist', guide: 'guide', parental: 'lock', about: 'info' }

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
          <Button key={s} focusKey={`settings-${s}`} icon={ICONS[s]} selected={s === section} onPress={() => select(s)} onFocus={() => select(s)}>
            {t(`settings.${s}`)}
          </Button>
        ))}
      </Region>
      {section === 'sources' && <SourcesSection />}
      {section === 'guide' && <GuideSection />}
      {section === 'parental' && <ParentalSection />}
      {section === 'about' && <AboutSection />}
    </div>
  )
}
