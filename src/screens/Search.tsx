import { useEffect, useMemo, useState } from 'react'
import { library, useLibrary } from '../data/library'
import { ALL, channelsByCategory, channelsForGroup, searchChannels } from '../data/lists'
import type { Channel, Movie, Series } from '../data/models'
import { useUnlocked } from '../data/parental'
import { toggleFavorite, usePrefs } from '../data/prefs'
import { isVodLocked } from '../data/vod'
import { t } from '../i18n'
import { ChannelRow } from '../ui/ChannelRow'
import { formatCount } from '../ui/format'
import { Poster } from '../ui/Logo'
import { navigate, useScreenFocus, type ScreenProps } from '../ui/navigation'
import { playChannel } from '../ui/play'
import { Region } from '../ui/Region'
import { clampIndex } from '../ui/scroll'
import { TextField } from '../ui/TextField'
import { VirtualList } from '../ui/VirtualList'

const DEBOUNCE_MS = 300
const ROW = 84
const LIST_HEIGHT = 672

type Result = { kind: 'channel'; item: Channel } | { kind: 'movie'; item: Movie } | { kind: 'series'; item: Series }

interface SearchMemo {
  query?: string
  index?: number
}

export function SearchScreen({ entry }: ScreenProps<'search'>) {
  const { channels, movies, series } = useLibrary()
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
  // Channels first, then movies, then series; locked categories stay out here too.
  const results = useMemo((): Result[] => {
    const shown = (item: Movie | Series) => !isVodLocked(item, prefs, unlocked)
    return [
      ...searchChannels(searchable, debounced).map((item): Result => ({ kind: 'channel', item })),
      ...searchChannels(movies, debounced)
        .filter(shown)
        .map((item): Result => ({ kind: 'movie', item })),
      ...searchChannels(series, debounced)
        .filter(shown)
        .map((item): Result => ({ kind: 'series', item })),
    ]
  }, [searchable, movies, series, debounced, prefs.pin, prefs.lockedCategories, unlocked])
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
          itemKey={(r) => r.item.id}
          rowHeight={ROW}
          height={LIST_HEIGHT}
          index={current}
          onIndexChange={setIndex}
          onSelect={(r) => {
            if (r.kind === 'channel') playChannel(r.item, ALL)
            else navigate(r.kind === 'movie' ? { name: 'movie', movieId: r.item.id } : { name: 'series', seriesId: r.item.id })
          }}
          onKey={(key, r) => {
            if (key !== 'red' || r?.kind !== 'channel') return false
            toggleFavorite(r.item.id)
            return true
          }}
          onRowAction={(r) => {
            if (r.kind === 'channel') toggleFavorite(r.item.id)
          }}
          hasRowAction={(r) => r.kind === 'channel'}
          renderRow={(r, _, focused, action) =>
            r.kind === 'channel' ? (
              <ChannelRow
                channel={r.item}
                focused={focused}
                actionFocused={action}
                favorite={prefs.favorites.includes(r.item.id)}
                onToggleFavorite={() => toggleFavorite(r.item.id)}
              />
            ) : (
              <div className={`channel-row${focused ? ' focused' : ''}`}>
                <Poster url={r.item.poster} name={r.item.name} className="poster-small" />
                <div className="channel-text">
                  <div className="channel-name">{r.item.name}</div>
                </div>
                <span className="result-kind">{t(r.kind === 'movie' ? 'search.movie' : 'search.series')}</span>
              </div>
            )
          }
        />
      </Region>
    </div>
  )
}
