import { setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { useEffect, useRef, useState } from 'react'
import { library, useLibrary } from '../data/library'
import type { MovieDetails } from '../data/models'
import { unlock, useUnlocked } from '../data/parental'
import { usePrefs } from '../data/prefs'
import { isVodLocked } from '../data/vod'
import { getWatch, resumePosition, useWatch } from '../data/watch'
import { t } from '../i18n'
import { warmService } from '../player/engines'
import { Button } from '../ui/Button'
import { Chips } from '../ui/Chips'
import { formatClock } from '../ui/format'
import { Backdrop, Poster } from '../ui/Logo'
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
  /** Undefined until the server answered, so the background doesn't start with the poster and switch. */
  const [details, setDetails] = useState<MovieDetails>()
  const [askPin, setAskPin] = useState(false)
  const locked = !!movie && isVodLocked(movie, prefs, unlocked)
  const resume = movie ? resumePosition(getWatch(movie.id)) : undefined

  useEffect(() => {
    if (movie) library.movieDetails(movie).then(setDetails, () => setDetails({}))
  }, [movie?.id])
  useEffect(() => {
    if (movie && !locked && movie.urls[0]) warmService(movie.urls[0], resume ?? 0)
  }, [movie?.id, locked])
  useScreenFocus(entry, locked ? 'movie-unlock' : 'movie-play')
  const wasLocked = useRef(locked)
  useEffect(() => {
    if (wasLocked.current && !locked) setFocus('movie-play') // unlocked with the PIN
    wasLocked.current = locked
  }, [locked])

  if (!movie) return <p className="dim">{t('vod.notFound')}</p>
  const play = (fromStart: boolean) => navigate({ name: 'vodPlayer', itemId: movie.id, fromStart })
  const info = details ?? {}
  const facts = [info.released, info.duration ? formatClock(info.duration) : undefined, info.genre].filter(Boolean)

  return (
    <div className="screen details">
      <Backdrop url={details && (details.backdrop ?? movie.poster)} soft={!details?.backdrop} />
      <Poster url={movie.poster} name={movie.name} className="details-poster" />
      <Region focusKey="movie-content" className="content">
        <h1 className="details-title">{movie.name}</h1>
        <Chips facts={facts} rating={info.rating} />
        {locked ? (
          <>
            <p className="dim">{t('home.locked')}</p>
            <Button focusKey="movie-unlock" className="inline" onPress={() => setAskPin(true)}>
              {t('home.unlock')}
            </Button>
          </>
        ) : (
          <>
            {info.plot && <p className="details-plot">{info.plot}</p>}
            {info.director && <p className="dim small">{t('vod.director', { name: info.director })}</p>}
            {info.cast && <p className="dim small details-cast">{t('vod.cast', { names: info.cast })}</p>}
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
