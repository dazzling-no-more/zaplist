import { getCurrentFocusKey, setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { library, useLibrary } from '../data/library'
import type { Episode } from '../data/models'
import { ASPECTS, updatePrefs, usePrefs, type Aspect } from '../data/prefs'
import { getWatch, lastTracks, recordWatch, resumePosition } from '../data/watch'
import { t } from '../i18n'
import { onRemoteKey } from '../platform/keys'
import { onNetworkChange } from '../platform/network'
import { toggleFullscreen } from '../platform/screen'
import { useSoundBlocked } from '../player/autoplay'
import { Playback, usePlaybackStatus } from '../player/playback'
import { ASPECT_CLASS } from '../ui/aspect'
import { Button } from '../ui/Button'
import { formatClock } from '../ui/format'
import { backStack, useBackHandler, type ScreenProps } from '../ui/navigation'
import { Region } from '../ui/Region'
import { Subtitles } from '../ui/Subtitles'
import { TrackDialog } from '../ui/TrackDialog'
import { episodeLabel } from './SeriesDetails'

const OSD_TIMEOUT_MS = 5000
const TOAST_MS = 2500
const SAVE_EVERY_MS = 10_000
const STEP_S = 10
const JUMP_S = 30

/** Plays a movie or an episode: seeking, resume where it was left, the next episode after the last. */
export function VodPlayerScreen({ entry }: ScreenProps<'vodPlayer'>) {
  useLibrary()
  const prefs = usePrefs()
  const memo = entry.memo as { itemId?: string }
  const [itemId, setItemId] = useState(memo.itemId ?? entry.itemId)
  Object.assign(memo, { itemId })

  const series = entry.seriesId ? library.series(entry.seriesId) : undefined
  const [episodes, setEpisodes] = useState<Episode[]>()
  useEffect(() => {
    if (series) library.episodes(series).then(setEpisodes, () => setEpisodes([]))
  }, [series?.id])
  const movie = series ? undefined : library.movie(itemId)
  const episode = episodes?.find((e) => e.id === itemId)
  const next = episode && episodes ? episodes[episodes.indexOf(episode) + 1] : undefined
  const title = movie ? movie.name : (series?.name ?? '')
  const subtitle = episode ? `${episodeLabel(episode)}${episode.title ? ' · ' + episode.title : ''}` : undefined
  const urls = movie?.urls ?? episode?.urls

  const video = useRef<HTMLVideoElement>(null)
  const [playback, setPlayback] = useState<Playback>()
  const status = usePlaybackStatus(playback)
  const [online, setOnline] = useState(true)
  const [shown, setShown] = useState(!document.hidden)
  const [attempt, setAttempt] = useState(0)
  const [osd, setOsd] = useState(true)
  const [paused, setPaused] = useState(false)
  /** Playing, but waiting for data: a seek, a stall, or a new stream after a seek (remux engine). */
  const [buffering, setBuffering] = useState(false)
  const [time, setTime] = useState({ current: 0, duration: 0 })
  const [picker, setPicker] = useState<'audio' | 'subtitles'>()
  const [toast, setToast] = useState<string>()
  const osdTimer = useRef<ReturnType<typeof setTimeout>>()
  const soundBlocked = useSoundBlocked()
  const aspect: Aspect = prefs.aspect

  /** Where playback is: the stream starts here, and restarts here (retry, network, app hidden). */
  const position = useRef(0)
  const startedItem = useRef<string>()
  /** The video's length, kept while a seek restarts the stream (see the remux engine). */
  const knownLength = useRef(0)

  const duration = () => {
    const d = video.current?.duration
    if (d && isFinite(d)) knownLength.current = d
    return knownLength.current || (episode?.duration ?? 0)
  }
  const save = () => {
    if (position.current > 0) recordWatch(itemId, { position: position.current, duration: duration(), seriesId: series?.id, tracks: playback?.chosenLabels() })
  }
  const latestSave = useRef(save)
  latestSave.current = save

  useEffect(() => {
    const instance = new Playback(video.current!)
    setPlayback(instance)
    return () => {
      latestSave.current()
      instance.stop()
    }
  }, [])

  // (Re)start when the item changes, on retry, or when the app or the network comes back.
  useEffect(() => {
    if (!playback) return
    if (urls && online && shown) {
      if (startedItem.current !== itemId) {
        startedItem.current = itemId
        const fromStart = entry.fromStart && itemId === entry.itemId
        position.current = (fromStart ? undefined : resumePosition(getWatch(itemId))) ?? 0
        knownLength.current = 0
      }
      // An episode starts with the audio and subtitles chosen for the one before (by label).
      playback.play(urls, () => position.current, lastTracks(itemId, series?.id))
    } else {
      latestSave.current()
      playback.stop()
    }
  }, [playback, itemId, !!urls, attempt, online, shown])

  /** Puts `seconds` and the length on the progress bar. */
  const showTime = (seconds: number) => {
    const current = Math.floor(seconds)
    const length = Math.floor(duration())
    setTime((old) => (old.current === current && old.duration === length ? old : { current, duration: length }))
  }
  const latestShowTime = useRef(showTime)
  latestShowTime.current = showTime

  useEffect(() => {
    if (!playback) return
    const element = video.current!
    const onTime = () => {
      const current = playback.currentTime()
      // A stream that is (re)starting counts from 0 until it reaches its start position.
      if (current > 0 && playback.getStatus().state === 'playing') position.current = current
      latestShowTime.current(current)
    }
    const onPlayState = () => {
      setPaused(element.paused)
      if (element.paused) latestSave.current()
    }
    const onEnded = () => latestEnded.current()
    const waiting = ['waiting', 'seeking', 'loadstart']
    const going = ['playing', 'canplay', 'error', 'ended']
    const onWaiting = () => setBuffering(true)
    const onGoing = () => setBuffering(false)
    element.addEventListener('timeupdate', onTime)
    element.addEventListener('play', onPlayState)
    element.addEventListener('pause', onPlayState)
    element.addEventListener('ended', onEnded)
    waiting.forEach((type) => element.addEventListener(type, onWaiting))
    going.forEach((type) => element.addEventListener(type, onGoing))
    const timer = setInterval(() => latestSave.current(), SAVE_EVERY_MS)
    return () => {
      element.removeEventListener('timeupdate', onTime)
      element.removeEventListener('play', onPlayState)
      element.removeEventListener('pause', onPlayState)
      element.removeEventListener('ended', onEnded)
      waiting.forEach((type) => element.removeEventListener(type, onWaiting))
      going.forEach((type) => element.removeEventListener(type, onGoing))
      clearInterval(timer)
    }
  }, [playback])

  const close = () => backStack.close(entry.id)
  const playNext = () => {
    if (!next) return
    latestSave.current()
    setItemId(next.id)
    showOsd(false)
  }
  // At the end: mark it watched, then the next episode, or back to where it was started from.
  const ended = () => {
    const length = duration()
    recordWatch(itemId, { position: length, duration: length, seriesId: series?.id, tracks: playback?.chosenLabels() })
    position.current = 0
    if (next) playNext()
    else close()
  }
  const latestEnded = useRef(ended)
  latestEnded.current = ended

  useEffect(() => onNetworkChange(setOnline), [])
  useEffect(() => {
    // Hidden app: stop and free the decoder; it resumes at the same point when shown again.
    const onVisibility = () => setShown(!document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  const armOsd = () => {
    clearTimeout(osdTimer.current)
    osdTimer.current = setTimeout(hideOsd, OSD_TIMEOUT_MS)
  }
  const showOsd = (focusButtons: boolean) => {
    setOsd(true)
    armOsd()
    if (focusButtons) setFocus('osd-seek')
  }
  const hideOsd = () => {
    clearTimeout(osdTimer.current)
    setOsd(false)
    if (getCurrentFocusKey().indexOf('osd-') === 0) setFocus('player-surface')
  }
  useEffect(() => {
    if (!osd) return
    armOsd()
    const onKey = () => armOsd()
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      clearTimeout(osdTimer.current)
    }
  }, [osd])
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(undefined), TOAST_MS)
    return () => clearTimeout(timer)
  }, [toast])

  const seekTo = (seconds: number) => {
    playback?.seek(seconds)
    position.current = seconds
    showTime(seconds)
  }
  const seekBy = (seconds: number) => {
    const length = duration()
    if (!playback || !length || status.state !== 'playing') return
    seekTo(Math.max(0, Math.min(length - 1, playback.currentTime() + seconds)))
    setOsd(true)
    armOsd()
  }
  const seekToFraction = (event: MouseEvent<HTMLDivElement>) => {
    const length = duration()
    if (!playback || !length || status.state !== 'playing') return
    const box = event.currentTarget.getBoundingClientRect()
    seekTo(Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)) * length)
  }
  const togglePause = () => {
    const element = video.current
    if (element?.paused) void element.play()
    else element?.pause()
  }
  const cycleAspect = () => {
    const nextAspect = ASPECTS[(ASPECTS.indexOf(aspect) + 1) % ASPECTS.length]
    updatePrefs({ aspect: nextAspect })
    setToast(t('player.aspectIs', { aspect: t(`aspect.${nextAspect}`) }))
  }

  const latest = useRef({ seekBy, togglePause, showOsd, hideOsd, close, osd, modal: false })
  latest.current = { seekBy, togglePause, showOsd, hideOsd, close, osd, modal: !!picker }

  // With nothing on screen, Left/Right seek and OK pauses; Up or Down shows the controls.
  const { ref: surface } = useFocusable<object, HTMLDivElement>({
    focusKey: 'player-surface',
    onArrowPress: (direction) => {
      if (direction === 'left') latest.current.seekBy(-STEP_S)
      else if (direction === 'right') latest.current.seekBy(STEP_S)
      else latest.current.showOsd(true)
      return false
    },
    onEnterPress: () => {
      latest.current.togglePause()
      latest.current.showOsd(false)
    },
  })
  // The progress bar: Left/Right seek, Down moves to the buttons.
  const { ref: seekBar, focused: seekFocused } = useFocusable<object, HTMLDivElement>({
    focusKey: 'osd-seek',
    onArrowPress: (direction) => {
      if (direction === 'left' || direction === 'right') {
        latest.current.seekBy(direction === 'left' ? -STEP_S : STEP_S)
        return false
      }
      return direction === 'down'
    },
    onEnterPress: () => latest.current.togglePause(),
  })

  useEffect(() => {
    setFocus('player-surface')
    return onRemoteKey((key, event) => {
      const s = latest.current
      if (s.modal) return
      if (key === 'rewind') s.seekBy(-JUMP_S)
      else if (key === 'fastForward') s.seekBy(JUMP_S)
      else if (key === 'info') s.osd ? s.hideOsd() : s.showOsd(true)
      else if (key === 'pause') video.current?.pause()
      else if (key === 'play') void video.current?.play()
      else if (key === 'stop') s.close()
      else return
      event.preventDefault()
    })
  }, [])

  useEffect(() => {
    if (status.state === 'failed') setFocus('player-retry')
    else if (getCurrentFocusKey() === 'player-retry' || getCurrentFocusKey() === 'player-back') setFocus('player-surface')
  }, [status.state])

  useBackHandler(() => {
    hideOsd()
    return true
  }, osd && status.state !== 'failed')

  const loadingText =
    status.state === 'retrying'
      ? `${t(`player.error.${status.error.code}`)} ${t('player.retrying', { attempt: status.retry, total: 3 })}`
      : status.state === 'loading'
        ? t('player.loading')
        : undefined
  const length = time.duration || episode?.duration || 0
  const fraction = length ? Math.min(1, time.current / length) : 0

  return (
    <div className="player">
      <video ref={video} className={`player-video ${ASPECT_CLASS[aspect]}`} />
      <div ref={surface} className="player-surface" onClick={() => showOsd(true)} onDoubleClick={toggleFullscreen} />
      <Subtitles playback={playback} raised={osd || status.state !== 'playing' || paused} />

      {(osd || status.state !== 'playing' || paused) && (
        <div className="osd" onMouseMove={() => osd && armOsd()}>
          <div className="osd-info">
            <div className="osd-text">
              <div className="osd-name">{title}</div>
              {loadingText ? <div className="osd-status">{loadingText}</div> : subtitle && <div className="osd-status">{subtitle}</div>}
            </div>
          </div>
          <div className="vod-progress-row">
            <span className="vod-time">{formatClock(time.current)}</span>
            <div ref={seekBar} className={`vod-progress${seekFocused ? ' focused' : ''}`} onClick={seekToFraction}>
              <div className="vod-progress-fill" style={{ width: `${fraction * 100}%` }} />
            </div>
            <span className="vod-time">{length ? formatClock(length) : '--:--'}</span>
          </div>
          {osd && (
            <Region focusKey="osd-buttons" className="osd-buttons">
              <Button focusKey="osd-pause" icon={paused ? 'play' : 'pause'} onPress={togglePause}>
                {t(paused ? 'player.play' : 'player.pause')}
              </Button>
              <Button focusKey="osd-back" icon="rewind" onPress={() => seekBy(-STEP_S)}>
                {t('vod.back10')}
              </Button>
              <Button focusKey="osd-forward" icon="forward" onPress={() => seekBy(JUMP_S)}>
                {t('vod.forward30')}
              </Button>
              {next && (
                <Button focusKey="osd-next" icon="next" onPress={playNext}>
                  {t('vod.nextEpisode')}
                </Button>
              )}
              <Button focusKey="osd-audio" icon="audio" onPress={() => setPicker('audio')}>
                {t('player.audio')}
              </Button>
              <Button focusKey="osd-subtitles" icon="subtitles" onPress={() => setPicker('subtitles')}>
                {t('player.subtitles')}
              </Button>
              <Button focusKey="osd-aspect" icon="aspect" onPress={cycleAspect}>
                {t('player.aspectIs', { aspect: t(`aspect.${aspect}`) })}
              </Button>
            </Region>
          )}
        </div>
      )}

      {(status.state === 'loading' || status.state === 'retrying' || (status.state === 'playing' && buffering)) && <div className="spinner" />}
      {!online && <div className="banner">{t('player.offline')}</div>}
      {online && soundBlocked && <div className="toast">{t('player.soundBlocked')}</div>}
      {toast && <div className="toast">{toast}</div>}

      {status.state === 'failed' && (
        <Region focusKey="player-error" className="player-error" isFocusBoundary>
          <h2>{t('player.failed', { name: subtitle ? `${title} ${subtitle}` : title })}</h2>
          <p className="dim">{t(`player.error.${status.error.code}`)}</p>
          {status.error.detail && <p className="dim small">{status.error.detail}</p>}
          <div className="button-row">
            <Button focusKey="player-retry" onPress={() => setAttempt((n) => n + 1)}>
              {t('common.retry')}
            </Button>
            <Button focusKey="player-back" onPress={close}>
              {t('vod.back')}
            </Button>
          </div>
        </Region>
      )}

      {picker && <TrackDialog kind={picker} playback={playback} onClose={() => setPicker(undefined)} />}
    </div>
  )
}
