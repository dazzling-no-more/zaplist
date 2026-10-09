import { getCurrentFocusKey, setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { library, useLibrary } from '../data/library'
import { ALL, channelsByCategory, channelsForGroup } from '../data/lists'
import type { Channel } from '../data/models'
import { useUnlocked } from '../data/parental'
import { ASPECTS, toggleFavorite, updatePrefs, usePrefs, type Aspect } from '../data/prefs'
import { t } from '../i18n'
import { onRemoteKey } from '../platform/keys'
import { onNetworkChange } from '../platform/network'
import type { Engine, PlaybackError } from '../player/streams'
import { Playback, usePlaybackStatus } from '../player/playback'
import { Button } from '../ui/Button'
import { ChannelRow } from '../ui/ChannelRow'
import { Dialog } from '../ui/Dialog'
import { Logo } from '../ui/Logo'
import { NowNext } from '../ui/NowPlaying'
import { backStack, useBackHandler, type ScreenProps } from '../ui/navigation'
import { recordPlay } from '../ui/play'
import { Region } from '../ui/Region'
import { VirtualList } from '../ui/VirtualList'

const OSD_TIMEOUT_MS = 5000
const DIGIT_TIMEOUT_MS = 1500
const TOAST_MS = 2500
const ASPECT_CLASS: Record<Aspect, string> = { fit: 'fit', fill: 'fill', '16:9': 'ratio-16-9', '4:3': 'ratio-4-3' }

function describeError(error: PlaybackError): string {
  return t(`player.error.${error.code}`)
}

export function PlayerScreen({ entry }: ScreenProps<'player'>) {
  const { channels } = useLibrary()
  const prefs = usePrefs()
  const unlocked = useUnlocked()
  const memo = entry.memo as { channelId?: string }
  const [channelId, setChannelId] = useState(memo.channelId ?? entry.channelId)
  memo.channelId = channelId

  const byCategory = useMemo(() => channelsByCategory(channels), [channels])
  const visible = (groupId: string) => channelsForGroup(groupId, channels, (id) => library.channel(id), byCategory, prefs, unlocked)
  // Zapping stays in the list the channel was picked from, or All when it's no longer in it.
  const list = useMemo(() => {
    const fromList = visible(entry.listId)
    return fromList.some((c) => c.id === channelId) ? fromList : visible(ALL)
  }, [channels, byCategory, prefs.favorites, prefs.recents, prefs.pin, prefs.lockedCategories, unlocked, channelId])
  const channel = library.channel(channelId)
  const index = list.findIndex((c) => c.id === channelId)

  const video = useRef<HTMLVideoElement>(null)
  const [playback, setPlayback] = useState<Playback>()
  const status = usePlaybackStatus(playback)
  const [online, setOnline] = useState(true)
  const [shown, setShown] = useState(!document.hidden)
  const [attempt, setAttempt] = useState(0)

  const [osd, setOsd] = useState(true)
  const [miniList, setMiniList] = useState(false)
  const [listIndex, setListIndex] = useState(0)
  const [picker, setPicker] = useState<'audio' | 'subtitles'>()
  const [digits, setDigits] = useState('')
  const [toast, setToast] = useState<string>()
  const osdTimer = useRef<ReturnType<typeof setTimeout>>()
  const aspect: Aspect = prefs.aspect

  useEffect(() => {
    const instance = new Playback(video.current!)
    setPlayback(instance)
    return () => instance.stop()
  }, [])

  // (Re)start the stream whenever the channel changes, the user retries, or the app/network returns.
  useEffect(() => {
    if (!playback) return
    if (channel && online && shown) playback.play(channel.urls)
    else playback.stop()
  }, [playback, channelId, attempt, online, shown])

  useEffect(() => onNetworkChange(setOnline), [])
  useEffect(() => {
    // Hidden app: stop and free the decoder; it resumes the same channel when shown again.
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
    if (focusButtons) setFocus('osd-favorite')
  }
  const hideOsd = () => {
    clearTimeout(osdTimer.current)
    setOsd(false)
    if (getCurrentFocusKey().indexOf('osd-') === 0) setFocus('player-surface')
  }
  useEffect(() => {
    if (!osd) return
    armOsd()
    // Any key keeps the OSD up a while longer.
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

  const tune = (target: Channel) => {
    recordPlay(target, entry.listId)
    setChannelId(target.id)
    setAttempt((n) => n + 1)
    showOsd(false)
  }
  const zap = (delta: number) => {
    if (!list.length) return
    tune(list[((index < 0 ? 0 : index) + delta + list.length) % list.length])
  }
  const jumpTo = (number: number) => {
    const target = list.find((c) => c.number === number) ?? visible(ALL).find((c) => c.number === number)
    if (target) tune(target)
    else setToast(t('player.noChannel', { number }))
  }
  const openList = () => {
    hideOsd()
    setListIndex(Math.max(0, index))
    setMiniList(true)
  }
  const closeList = () => {
    setMiniList(false)
    setFocus('player-surface')
  }
  const cycleAspect = () => {
    const next = ASPECTS[(ASPECTS.indexOf(aspect) + 1) % ASPECTS.length]
    updatePrefs({ aspect: next })
    setToast(t('player.aspectIs', { aspect: t(`aspect.${next}`) }))
  }
  const favorite = () => {
    if (!channel) return
    const adding = !prefs.favorites.includes(channel.id)
    toggleFavorite(channel.id)
    setToast(t(adding ? 'player.favoriteAdded' : 'player.favoriteRemoved'))
  }

  useEffect(() => {
    if (!digits) return
    const timer = setTimeout(() => {
      jumpTo(Number(digits))
      setDigits('')
    }, DIGIT_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [digits])

  const latest = useRef({ zap, openList, showOsd, hideOsd, favorite, cycleAspect, osd, modal: false })
  latest.current = { zap, openList, showOsd, hideOsd, favorite, cycleAspect, osd, modal: miniList || !!picker }

  const { ref: surface } = useFocusable<object, HTMLDivElement>({
    focusKey: 'player-surface',
    onArrowPress: (direction) => {
      if (direction === 'up') latest.current.zap(1)
      else if (direction === 'down') latest.current.zap(-1)
      else latest.current.showOsd(true)
      return false
    },
    onEnterPress: () => latest.current.openList(),
  })

  useEffect(() => {
    setFocus('player-surface')
    return onRemoteKey((key, event) => {
      const s = latest.current
      if (s.modal) return
      if (key.length === 1) setDigits((d) => (d + key).slice(-4))
      else if (key === 'channelUp') s.zap(1)
      else if (key === 'channelDown') s.zap(-1)
      else if (key === 'info') s.osd ? s.hideOsd() : s.showOsd(true)
      else if (key === 'red') s.favorite()
      else if (key === 'yellow') s.cycleAspect()
      else if (key === 'pause') video.current?.pause()
      else if (key === 'play') void video.current?.play()
      else if (key === 'stop') backStack.pop()
      else return
      event.preventDefault()
    })
  }, [])

  // The error panel takes focus when playback gives up.
  useEffect(() => {
    if (status.state === 'failed') setFocus('player-retry')
    else if (getCurrentFocusKey() === 'player-retry' || getCurrentFocusKey() === 'player-next') setFocus('player-surface')
  }, [status.state])

  useBackHandler(() => {
    hideOsd()
    return true
  }, osd)
  useBackHandler(() => {
    closeList()
    return true
  }, miniList)

  const loadingText =
    status.state === 'retrying'
      ? `${describeError(status.error)} ${t('player.retrying', { attempt: status.retry, total: 3 })}`
      : status.state === 'loading'
        ? t('player.loading')
        : undefined

  return (
    <div className="player">
      <video ref={video} className={`player-video ${ASPECT_CLASS[aspect]}`} />
      <div ref={surface} className="player-surface" onClick={() => showOsd(true)} />

      {channel && (osd || status.state !== 'playing') && !miniList && (
        <div className="osd">
          <div className="osd-info">
            <span className="osd-number">{channel.number}</span>
            <Logo url={channel.logo} name={channel.name} />
            <div className="osd-text">
              <div className="osd-name">{channel.name}</div>
              {loadingText ? <div className="osd-status">{loadingText}</div> : <NowNext channel={channel} />}
            </div>
            <Clock />
          </div>
          {osd && (
            <Region focusKey="osd-buttons" className="osd-buttons">
              <Button focusKey="osd-favorite" onPress={favorite}>
                {t(prefs.favorites.includes(channel.id) ? 'menu.removeFavorite' : 'menu.addFavorite')}
              </Button>
              <Button focusKey="osd-audio" onPress={() => setPicker('audio')}>
                {t('player.audio')}
              </Button>
              <Button focusKey="osd-subtitles" onPress={() => setPicker('subtitles')}>
                {t('player.subtitles')}
              </Button>
              <Button focusKey="osd-aspect" onPress={cycleAspect}>
                {t('player.aspectIs', { aspect: t(`aspect.${aspect}`) })}
              </Button>
            </Region>
          )}
        </div>
      )}

      {(status.state === 'loading' || status.state === 'retrying') && <div className="spinner" />}

      {!online && <div className="banner">{t('player.offline')}</div>}

      {status.state === 'failed' && channel && (
        <Region focusKey="player-error" className="player-error" isFocusBoundary>
          <h2>{t('player.failed', { name: channel.name })}</h2>
          <p className="dim">{describeError(status.error)}</p>
          <div className="button-row">
            <Button focusKey="player-retry" onPress={() => setAttempt((n) => n + 1)}>
              {t('common.retry')}
            </Button>
            <Button focusKey="player-next" onPress={() => zap(1)}>
              {t('player.nextChannel')}
            </Button>
          </div>
        </Region>
      )}

      {digits && <div className="digits">{digits}</div>}
      {toast && <div className="toast">{toast}</div>}

      {miniList && (
        <div className="mini-list">
          <VirtualList
            focusKey="player-list"
            items={list}
            itemKey={(c) => c.id}
            rowHeight={84}
            height={924}
            index={listIndex}
            onIndexChange={setListIndex}
            onSelect={(c) => {
              closeList()
              if (c.id !== channelId) tune(c)
            }}
            renderRow={(c, _, focused) => (
              <ChannelRow channel={c} focused={focused} favorite={prefs.favorites.includes(c.id)} current={c.id === channelId} />
            )}
          />
        </div>
      )}
      {miniList && <FocusOnMount focusKey="player-list" />}

      {picker && <TrackDialog kind={picker} engine={playback?.current()} onClose={() => setPicker(undefined)} />}
    </div>
  )
}

function FocusOnMount({ focusKey }: { focusKey: string }) {
  useEffect(() => {
    setFocus(focusKey)
  }, [])
  return null
}

function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15_000)
    return () => clearInterval(timer)
  }, [])
  return <span className="osd-clock">{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
}

function TrackDialog({ kind, engine, onClose }: { kind: 'audio' | 'subtitles'; engine?: Engine; onClose: () => void }) {
  const tracks = engine ? (kind === 'audio' ? engine.audioTracks() : engine.subtitleTracks()) : []
  const selected = engine ? (kind === 'audio' ? engine.selectedAudio() : engine.selectedSubtitle()) : -1
  const select = (id: number) => {
    if (kind === 'audio') engine?.setAudioTrack(id)
    else engine?.setSubtitleTrack(id)
    onClose()
  }
  const options = kind === 'subtitles' && tracks.length ? [{ id: -1, label: t('player.subtitlesOff') }, ...tracks] : tracks
  return (
    <Dialog
      title={t(kind === 'audio' ? 'player.audio' : 'player.subtitles')}
      message={options.length ? undefined : t(kind === 'audio' ? 'player.noAudioTracks' : 'player.noSubtitles')}
      buttons={options.length ? [] : [{ label: t('common.ok'), onPress: onClose }]}
      initialFocus={options.length ? `track-${Math.max(0, options.findIndex((o) => o.id === selected))}` : 0}
      onCancel={onClose}
    >
      {options.length > 0 && (
        <div className="dialog-options">
          {options.map((option, i) => (
            <Button key={option.id} focusKey={`track-${i}`} selected={option.id === selected} onPress={() => select(option.id)}>
              {option.label}
            </Button>
          ))}
        </div>
      )}
    </Dialog>
  )
}
