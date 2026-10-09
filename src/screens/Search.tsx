import { useEffect, useMemo, useState } from 'react'
import { library, useLibrary } from '../data/library'
import { ALL, channelsByCategory, channelsForGroup, searchChannels } from '../data/lists'
import { useUnlocked } from '../data/parental'
import { toggleFavorite, usePrefs } from '../data/prefs'
import { t } from '../i18n'
import { ChannelRow } from '../ui/ChannelRow'
import { formatCount } from '../ui/format'
import { useScreenFocus, type ScreenProps } from '../ui/navigation'
import { playChannel } from '../ui/play'
import { Region } from '../ui/Region'
import { clampIndex } from '../ui/scroll'
import { TextField } from '../ui/TextField'
import { VirtualList } from '../ui/VirtualList'

const DEBOUNCE_MS = 300
const ROW = 84
const LIST_HEIGHT = 672

interface SearchMemo {
  query?: string
  index?: number
}

export function SearchScreen({ entry }: ScreenProps<'search'>) {
  const { channels } = useLibrary()
  const prefs = usePrefs()
  const unlocked = useUnlocked()
  const memo = entry.memo as SearchMemo
  const [query, setQuery] = useState(memo.query ?? '')
  const [debounced, setDebounced] = useState(query)
  const [index, setIndex] = useState(memo.index ?? 0)
  const [resultsFor, setResultsFor] = useState(debounced)
  if (resultsFor !== debounced) {
    setResultsFor(debounced)
    setIndex(0)
  }

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  // Locked categories stay out of search results too.
  const searchable = useMemo(
    () => channelsForGroup(ALL, channels, (id) => library.channel(id), channelsByCategory(channels), prefs, unlocked),
    [channels, prefs.pin, prefs.lockedCategories, unlocked],
  )
  const results = useMemo(() => searchChannels(searchable, debounced), [searchable, debounced])
  const current = clampIndex(index, results.length)
  Object.assign(memo, { query, index: current })

  useScreenFocus(entry, 'search-input')

  return (
    <div className="screen">
      <div className="sidebar">
        <h1>{t('search.title')}</h1>
        <p className="dim">{t('search.hint')}</p>
      </div>
      <Region focusKey="search-content" className="content">
        <TextField focusKey="search-input" label={t('search.label')} value={query} onChange={setQuery} autoEdit={!entry.focusKey} />
        <p className="dim small">
          {debounced && (results.length ? t('search.results', { count: formatCount(results.length) }) : t('search.none', { query: debounced }))}
        </p>
        <VirtualList
          focusKey="search-results"
          items={results}
          itemKey={(c) => c.id}
          rowHeight={ROW}
          height={LIST_HEIGHT}
          index={current}
          onIndexChange={setIndex}
          onSelect={(channel) => playChannel(channel, ALL)}
          onKey={(key, channel) => {
            if (key !== 'red' || !channel) return false
            toggleFavorite(channel.id)
            return true
          }}
          onRowAction={(channel) => toggleFavorite(channel.id)}
          renderRow={(channel, _, focused, action) => (
            <ChannelRow
              channel={channel}
              focused={focused}
              actionFocused={action}
              favorite={prefs.favorites.includes(channel.id)}
              onToggleFavorite={() => toggleFavorite(channel.id)}
            />
          )}
        />
      </Region>
    </div>
  )
}
