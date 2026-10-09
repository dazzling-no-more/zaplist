import { useState } from 'react'
import { useLibrary } from '../data/library'
import { t } from '../i18n'
import { Button } from '../ui/Button'
import { formatCount } from '../ui/format'
import { navigate, useScreenFocus, type ScreenProps } from '../ui/navigation'
import { Region } from '../ui/Region'

const CATEGORIES = ['favorites', 'recent', 'all'] as const
type Category = (typeof CATEGORIES)[number]

export function HomeScreen({ entry }: ScreenProps<'home'>) {
  const { ready, sources, categories, channels } = useLibrary()
  if (!ready) return <p className="dim">{t('common.loading')}</p>
  if (!sources.length) return <Welcome entry={entry} />
  return <Browse entry={entry} summary={t('home.summary', { channels: formatCount(channels.length), categories: formatCount(categories.length) })} />
}

function Welcome({ entry }: ScreenProps<'home'>) {
  useScreenFocus(entry, 'home-add-source')
  return (
    <Region focusKey="home-welcome" className="welcome">
      <h1>{t('appName')}</h1>
      <h2>{t('home.welcome')}</h2>
      <p className="dim">{t('home.welcomeDetail')}</p>
      <Button focusKey="home-add-source" className="inline primary" onPress={() => navigate({ name: 'sourceEdit' })}>
        {t('home.addSource')}
      </Button>
    </Region>
  )
}

function Browse({ entry, summary }: ScreenProps<'home'> & { summary: string }) {
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
        <Button focusKey="home-settings" onPress={() => navigate({ name: 'settings' })}>
          {t('settings.title')}
        </Button>
      </Region>
      <div className="content">
        <h2>{t(`home.${category}`)}</h2>
        <p className="dim">{summary}</p>
      </div>
    </div>
  )
}
