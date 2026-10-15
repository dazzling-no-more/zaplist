import { useState } from 'react'
import { useLibrary } from '../../data/library'
import { toggleHiddenCategory, usePrefs } from '../../data/prefs'
import { t } from '../../i18n'
import { Region } from '../../ui/Region'
import { VirtualList } from '../../ui/VirtualList'

/** Hiding categories, which then leave every list, sidebar, the guide and search (no PIN involved). */
export function CategoriesSection() {
  const prefs = usePrefs()
  const { categories, sources } = useLibrary()
  const [index, setIndex] = useState(0)
  const several = sources.length > 1
  const sourceName = (id: string) => sources.find((s) => s.id === id)?.name

  return (
    <Region focusKey="settings-content" className="content">
      <h2>{t('settings.categories')}</h2>
      <p className="dim">{t('categories.detail')}</p>
      <VirtualList
        focusKey="categories-list"
        items={categories}
        itemKey={(c) => c.id}
        rowHeight={68}
        height={680}
        index={index}
        onIndexChange={setIndex}
        onSelect={(c) => toggleHiddenCategory(c.id)}
        renderRow={(c, _, focused) => {
          const hidden = prefs.hiddenCategories.includes(c.id)
          return (
            <div className={`group-row${focused ? ' focused' : ''}`}>
              <span className="group-name">{c.name}</span>
              <span className="group-detail">
                {several ? sourceName(c.sourceId) + ' · ' : ''}
                {c.kind ? t(c.kind === 'movie' ? 'vod.movies' : 'vod.series') + ' · ' : ''}
                {hidden ? t('categories.hidden') : t('categories.shown')}
              </span>
            </div>
          )
        }}
        empty={<p className="dim">{t('parental.noCategories')}</p>}
      />
    </Region>
  )
}
