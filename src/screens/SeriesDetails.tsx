import { doesFocusableExist, setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { useEffect, useMemo, useState } from 'react'
import { library, useLibrary } from '../data/library'
import type { Episode, SeriesDetails } from '../data/models'
import { unlock, useUnlocked } from '../data/parental'
import { usePrefs } from '../data/prefs'
import { isVodLocked } from '../data/vod'
import { isFinished, resumePosition, useWatch, type WatchEntry } from '../data/watch'
import { t } from '../i18n'
import { warmService } from '../player/engines'
import { withHeaders } from '../player/streams'
import { Button } from '../ui/Button'
import { Chips } from '../ui/Chips'
import { formatClock } from '../ui/format'
import { Icon } from '../ui/Icon'
import { Backdrop, Poster } from '../ui/Logo'
import { navigate, type ScreenProps } from '../ui/navigation'
import { PinDialog } from '../ui/PinDialog'
import { Region } from '../ui/Region'
import { clampIndex } from '../ui/scroll'
import { VirtualList } from '../ui/VirtualList'

const EPISODE_ROW = 92
const EPISODE_LIST_HEIGHT = 644

interface SeriesMemo {
  season?: number
  index?: number
}

/** The episode to offer first: the one last watched (or the next after it), else the first. */
export function nextUp(episodes: readonly Episode[], watch: Readonly<Record<string, WatchEntry>>): Episode | undefined {
  let last: Episode | undefined
  for (const episode of episodes) {
    const entry = watch[episode.id]
    if (entry && (!last || entry.at > watch[last.id].at)) last = episode
  }
  if (!last) return episodes[0]
  if (!isFinished(watch[last.id])) return last
  return episodes[episodes.indexOf(last) + 1] ?? last
}

export const episodeLabel = (episode: Pick<Episode, 'season' | 'episode'>): string => t('vod.episodeCode', { season: episode.season, episode: episode.episode })

/** A series: its details, a season picker and the season's episodes. */
export function SeriesScreen({ entry }: ScreenProps<'series'>) {
  useLibrary()
  const watch = useWatch()
  const prefs = usePrefs()
  const unlocked = useUnlocked()
  const memo = entry.memo as SeriesMemo
  const series = library.series(entry.seriesId)
  const [episodes, setEpisodes] = useState<Episode[] | 'loading' | 'failed'>('loading')
  const [attempt, setAttempt] = useState(0)
  const [details, setDetails] = useState<SeriesDetails>()
  const [askPin, setAskPin] = useState(false)
  const locked = !!series && isVodLocked(series, prefs, unlocked)

  useEffect(() => {
    if (!series) return
    setEpisodes('loading')
    library.episodes(series).then(setEpisodes, () => setEpisodes('failed'))
    library.seriesDetails(series).then(setDetails, () => setDetails({}))
  }, [series?.id, attempt])

  const list = Array.isArray(episodes) ? episodes : []
  const seasons = useMemo(() => Array.from(new Set(list.map((e) => e.season))), [episodes])
  const next = useMemo(() => nextUp(list, watch), [episodes, watch])
  useEffect(() => {
    if (next && !locked && next.urls[0]) warmService(withHeaders(next.urls, next.options)[0], resumePosition(watch[next.id]) ?? 0)
  }, [next?.id, locked])
  const [season, setSeason] = useState<number | undefined>(memo.season)
  const shownSeason = season !== undefined && seasons.indexOf(season) >= 0 ? season : (next?.season ?? seasons[0])
  const seasonEpisodes = useMemo(() => list.filter((e) => e.season === shownSeason), [episodes, shownSeason])
  const [index, setIndex] = useState(memo.index ?? 0)
  const current = clampIndex(index, seasonEpisodes.length)
  // Remembered for coming back from the player; not while loading, when there is no season yet.
  if (list.length) Object.assign(memo, { season: shownSeason, index: current })

  // What can take focus depends on the lock and on the episodes, which may still be loading: focus
  // once it's there, preferring what was focused when the user left (to play an episode).
  const content = locked ? 'locked' : Array.isArray(episodes) ? (episodes.length ? 'episodes' : 'empty') : episodes
  useEffect(() => {
    const saved = entry.focusKey
    if (content === 'locked') setFocus('series-unlock')
    else if (content === 'failed') setFocus('series-retry')
    else if (content === 'episodes') setFocus(saved && doesFocusableExist(saved) ? saved : next ? 'series-continue' : 'series-episodes')
  }, [content])

  if (!series) return <p className="dim">{t('vod.notFound')}</p>
  const play = (episode: Episode) => navigate({ name: 'vodPlayer', itemId: episode.id, seriesId: series.id })
  const nextEntry = next && watch[next.id]

  return (
    <div className="screen details">
      <Backdrop url={details && (details.backdrop ?? series.poster)} soft={!details?.backdrop} />
      <div className="sidebar series-sidebar">
        <Poster url={series.poster} name={series.name} className="series-poster" />
        <h1 className="details-title">{series.name}</h1>
        <Chips facts={series.released ? [series.released] : []} rating={details?.rating} />
        {series.plot && <p className="details-plot series-plot">{series.plot}</p>}
      </div>
      <Region focusKey="series-content" className="content">
        {locked ? (
          <>
            <p className="dim">{t('home.locked')}</p>
            <Button focusKey="series-unlock" className="inline" onPress={() => setAskPin(true)}>
              {t('home.unlock')}
            </Button>
          </>
        ) : episodes === 'loading' ? (
          <p className="dim">{t('vod.loadingEpisodes')}</p>
        ) : episodes === 'failed' ? (
          <>
            <p className="error">{t('vod.episodesFailed')}</p>
            <Button focusKey="series-retry" className="inline" onPress={() => setAttempt((n) => n + 1)}>
              {t('common.retry')}
            </Button>
          </>
        ) : !list.length ? (
          <p className="dim">{t('vod.noEpisodes')}</p>
        ) : (
          <>
            {next && (
              <Button focusKey="series-continue" className="inline primary" icon="play" onPress={() => play(next)}>
                {t(nextEntry && !isFinished(nextEntry) ? 'vod.continueEpisode' : 'vod.playEpisode', { episode: episodeLabel(next) })}
              </Button>
            )}
            {seasons.length > 1 && (
              <Region focusKey="series-seasons" className="segmented season-picker">
                {seasons.map((s) => (
                  <Button
                    key={s}
                    focusKey={`season-${s}`}
                    selected={s === shownSeason}
                    onPress={() => {
                      setSeason(s)
                      setIndex(0)
                      setFocus('series-episodes')
                    }}
                  >
                    {t('vod.season', { number: s })}
                  </Button>
                ))}
              </Region>
            )}
            <VirtualList
              focusKey="series-episodes"
              items={seasonEpisodes}
              itemKey={(e) => e.id}
              rowHeight={EPISODE_ROW}
              height={EPISODE_LIST_HEIGHT}
              index={current}
              onIndexChange={setIndex}
              onSelect={play}
              renderRow={(episode, _, focused) => <EpisodeRow episode={episode} focused={focused} entry={watch[episode.id]} />}
            />
          </>
        )}
      </Region>
      {askPin && (
        <PinDialog
          title={t('pin.enter')}
          onSubmit={(pin) => {
            if (!unlock(pin)) return false
            setAskPin(false)
          }}
          onCancel={() => setAskPin(false)}
        />
      )}
    </div>
  )
}

function EpisodeRow({ episode, focused, entry }: { episode: Episode; focused: boolean; entry?: WatchEntry }) {
  const finished = isFinished(entry)
  const fraction = entry && entry.duration > 0 && !finished ? Math.min(1, entry.position / entry.duration) : 0
  const length = episode.duration ?? (entry?.duration || undefined)
  return (
    <div className={`channel-row episode-row${focused ? ' focused' : ''}`}>
      <span className="episode-number">{episodeLabel(episode)}</span>
      <div className="channel-text">
        <div className="channel-name">{episode.title || t('vod.episode', { number: episode.episode })}</div>
        {fraction > 0 && (
          <div className="poster-progress episode-progress">
            <div style={{ width: `${fraction * 100}%` }} />
          </div>
        )}
      </div>
      {length !== undefined && <span className="episode-length">{formatClock(length)}</span>}
      {finished && <Icon name="check" className="episode-watched" />}
    </div>
  )
}
