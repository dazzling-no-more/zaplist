import { useState } from 'react'
import { t } from '../i18n'
import { Button } from '../ui/Button'
import { navigate, useScreenFocus, type ScreenProps } from '../ui/navigation'
import { Region } from '../ui/Region'

const CATEGORIES = ['favorites', 'recent', 'all'] as const
type Category = (typeof CATEGORIES)[number]

export function HomeScreen({ entry }: ScreenProps) {
  const [category, setCategory] = useState<Category>('all')
  useScreenFocus(entry, 'home-all')

  return (
    <div className="screen">
      <Region focusKey="home-sidebar" className="sidebar">
        <h1>{t('appName')}</h1>
        {CATEGORIES.map((c) => (
          <Button key={c} focusKey={`home-${c}`} selected={c === category} onPress={() => setCategory(c)}>
            {t(`home.${c}`)}
          </Button>
        ))}
        <Button focusKey="home-settings" onPress={() => navigate('settings')}>
          {t('settings.title')}
        </Button>
      </Region>
      <Region focusKey="home-content" className="content">
        <h2>{t(`home.${category}`)}</h2>
        <p className="dim">{t('home.empty')}</p>
        <Button focusKey="home-open-settings" className="inline" onPress={() => navigate('settings')}>
          {t('home.openSettings')}
        </Button>
      </Region>
    </div>
  )
}
