import { setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { useEffect, useRef, useState } from 'react'
import { library, useLibrary } from '../data/library'
import type { MovieDetails } from '../data/models'
import { unlock, useUnlocked } from '../data/parental'
import { usePrefs } from '../data/prefs'
import { isVodLocked } from '../data/vod'
import { getWatch, resumePosition, useWatch } from '../data/watch'
import { t } from '../i18n'
import { Button } from '../ui/Button'
import { formatClock } from '../ui/format'
import { Poster } from '../ui/Logo'
import { navigate, useScreenFocus, type ScreenProps } from '../ui/navigation'
import { PinDialog } from '../ui/PinDialog'
import { Region } from '../ui/Region'

/** A movie's poster and details, with Play or Resume. */
export function MovieScreen({ entry }: ScreenProps<'movie'>) {
  useLibrary()
  useWatch()
  const prefs = usePrefs()
  const unlocked = useUnlocked()
  const movie = library.movie(entry.movieId)
  const [details, setDetails] = useState<MovieDetails>({})
  const [askPin, setAskPin] = useState(false)
  const locked = !!movie && isVodLocked(movie, prefs, unlocked)
  const resume = movie ? resumePosition(getWatch(movie.id)) : undefined

  useEffect(() => {
    if (movie) library.movieDetails(movie).then(setDetails, () => undefined)
  }, [movie?.id])
  useScreenFocus(entry, locked ? 'movie-unlock' : 'movie-play')
  const wasLocked = useRef(locked)
  useEffect(() => {
    if (wasLocked.current && !locked) setFocus('movie-play') // unlocked with the PIN
    wasLocked.current = locked
  }, [locked])

  if (!movie) return <p className="dim">{t('vod.notFound')}</p>
  const play = (fromStart: boolean) => navigate({ name: 'vodPlayer', itemId: movie.id, fromStart })
  const facts = [details.released, details.duration ? formatClock(details.duration) : undefined, details.genre].filter(Boolean).join(' · ')

  return (
    <div className="screen details">
      <Poster url={movie.poster} name={movie.name} className="details-poster" />
      <Region focusKey="movie-content" className="content">
        <h1 className="details-title">{movie.name}</h1>
        {facts && <p className="dim">{facts}</p>}
        {locked ? (
          <>
            <p className="dim">{t('home.locked')}</p>
            <Button focusKey="movie-unlock" className="inline" onPress={() => setAskPin(true)}>
              {t('home.unlock')}
            </Button>
          </>
        ) : (
          <>
            {details.plot && <p className="details-plot">{details.plot}</p>}
            {details.director && <p className="dim small">{t('vod.director', { name: details.director })}</p>}
            {details.cast && <p className="dim small details-cast">{t('vod.cast', { names: details.cast })}</p>}
            <div className="button-row">
              <Button focusKey="movie-play" className="inline primary" icon="play" onPress={() => play(false)}>
                {resume ? t('vod.resume', { time: formatClock(resume) }) : t('vod.play')}
              </Button>
              {resume !== undefined && (
                <Button focusKey="movie-restart" className="inline" icon="restart" onPress={() => play(true)}>
                  {t('vod.fromStart')}
                </Button>
              )}
            </div>
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
