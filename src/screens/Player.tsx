import { getCurrentFocusKey, setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { library, useLibrary } from '../data/library'
import { ALL, buildGroups, channelsByCategory, channelsForGroup } from '../data/lists'
import type { Channel } from '../data/models'
import { useUnlocked } from '../data/parental'
import { ASPECTS, toggleFavorite, updatePrefs, usePrefs, type Aspect } from '../data/prefs'
import { t } from '../i18n'
import { onRemoteKey } from '../platform/keys'
import { onNetworkChange } from '../platform/network'
import { toggleFullscreen } from '../platform/screen'
import type { Engine, PlaybackError } from '../player/streams'
import { useSoundBlocked } from '../player/autoplay'
import { Playback, usePlaybackStatus } from '../player/playback'
import { Button } from '../ui/Button'
import { ChannelRow } from '../ui/ChannelRow'
import { Dialog } from '../ui/Dialog'
import { emptyListText, groupLabels, GroupRow } from '../ui/GroupRow'
import { Logo } from '../ui/Logo'
import { NowNext } from '../ui/NowPlaying'
import { backStack, navigate, useBackHandler, type ScreenProps } from '../ui/navigation'
import { recordPlay } from '../ui/play'
import { formatCount } from '../ui/format'
import { Region } from '../ui/Region'
import { clampIndex } from '../ui/scroll'
import { VirtualList } from '../ui/VirtualList'

const OSD_TIMEOUT_MS = 5000
const DIGIT_TIMEOUT_MS = 1500
const TOAST_MS = 2500
const GROUP_SELECT_DELAY_MS = 150
/** Channel list overlay: 1080 minus the safe area, panel padding and column header. */
const MINI_LIST_HEIGHT = 884
const ASPECT_CLASS: Record<Aspect, string> = { fit: 'fit', zoom: 'zoom', fill: 'fill', '16:9': 'ratio-16-9', '4:3': 'ratio-4-3' }

function describeError(error: PlaybackError): string {
  return t(`player.error.${error.code}`)
}

export function PlayerScreen({ entry }: ScreenProps<'player'>) {
  const { channels, categories, sources } = useLibrary()
  const prefs = usePrefs()
  const unlocked = useUnlocked()
  const memo = entry.memo as { channelId?: string; listId?: string }
  const [channelId, setChannelId] = useState(memo.channelId ?? entry.channelId)
  // The group zapping moves through; picking a channel from another group in the list switches it.
  const [listId, setListId] = useState(memo.listId ?? entry.listId)
  Object.assign(memo, { channelId, listId })

  const byCategory = useMemo(() => channelsByCategory(channels), [channels])
  const visible = (groupId: string) => channelsForGroup(groupId, channels, (id) => library.channel(id), byCategory, prefs, unlocked)
  const listDeps = [channels, byCategory, prefs.favorites, prefs.recents, prefs.pin, prefs.lockedCategories, unlocked]
  // Zapping stays in the list the channel was picked from, or All when it's no longer in it.
  const list = useMemo(() => {
    const fromList = visible(listId)
    return fromList.some((c) => c.id === channelId) ? fromList : visible(ALL)
  }, [...listDeps, listId, channelId])
  const groups = useMemo(() => buildGroups(categories, sources, prefs, groupLabels()), [categories, sources, prefs.pin, prefs.lockedCategories])
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
  // Channel list overlay: the group shown, the focused group row and the focused channel row.
  const [browseGroup, setBrowseGroup] = useState(listId)
  const [groupIndex, setGroupIndex] = useState(0)
  const [listIndex, setListIndex] = useState(0)
  const browseList = useMemo(() => visible(browseGroup), [...listDeps, browseGroup])
  const browseLocked = !!groups.find((g) => g.id === browseGroup)?.locked && !unlocked
  const groupCounts = useMemo(
    () => (miniList ? new Map(groups.map((g) => [g.id, visible(g.id).length])) : undefined),
    [...listDeps, groups, miniList],
  )
  const [picker, setPicker] = useState<'audio' | 'subtitles'>()
  const [digits, setDigits] = useState('')
  const [toast, setToast] = useState<string>()
  const osdTimer = useRef<ReturnType<typeof setTimeout>>()
  const aspect: Aspect = prefs.aspect
  const soundBlocked = useSoundBlocked()

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
    if (focusButtons) setFocus('osd-channels')
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

  const tune = (target: Channel, fromList = listId) => {
    recordPlay(target, fromList)
    setListId(fromList)
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
    // Open on the zapping list; from All, open on the channel's own category, which is easier to browse.
    const start = listId === ALL && channel?.categoryId && groups.some((g) => g.id === channel.categoryId) ? channel.categoryId : listId
    setBrowseGroup(start)
    setGroupIndex(Math.max(0, groups.findIndex((g) => g.id === start)))
    setListIndex(Math.max(0, visible(start).findIndex((c) => c.id === channelId)))
    setMiniList(true)
  }
  const showBrowseGroup = (groupId: string) => {
    if (groupId === browseGroup) return
    setBrowseGroup(groupId)
    setListIndex(0)
  }

  // Moving through the categories shows a category once it stays focused briefly (as on Home).
  useEffect(() => {
    if (!miniList) return
    const next = groups[groupIndex]
    if (!next || next.id === browseGroup) return
    const timer = setTimeout(() => showBrowseGroup(next.id), GROUP_SELECT_DELAY_MS)
    return () => clearTimeout(timer)
  }, [groupIndex])
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
      <div ref={surface} className="player-surface" onClick={() => showOsd(true)} onDoubleClick={toggleFullscreen} />

      {channel && (osd || status.state !== 'playing') && !miniList && (
        <div className="osd" onMouseMove={() => osd && armOsd()}>
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
              <Button focusKey="osd-channels" icon="all" onPress={openList}>
                {t('player.channelList')}
              </Button>
              <Button focusKey="osd-favorite" icon={prefs.favorites.includes(channel.id) ? 'star' : 'starOutline'} onPress={favorite}>
                {t(prefs.favorites.includes(channel.id) ? 'menu.removeFavorite' : 'menu.addFavorite')}
              </Button>
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

      {(status.state === 'loading' || status.state === 'retrying') && <div className="spinner" />}

      {!online && <div className="banner">{t('player.offline')}</div>}
      {online && soundBlocked && <div className="toast">{t('player.soundBlocked')}</div>}

      {status.state === 'failed' && channel && (
        <Region focusKey="player-error" className="player-error" isFocusBoundary>
          <h2>{t('player.failed', { name: channel.name })}</h2>
          <p className="dim">{describeError(status.error)}</p>
          {status.error.detail && <p className="dim small">{status.error.detail}</p>}
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
          <div className="mini-groups">
            <Region focusKey="player-list-actions" className="mini-header mini-actions">
              <Button focusKey="player-search" icon="search" onPress={() => navigate({ name: 'search' })}>
                {t('home.search')}
              </Button>
              <Button focusKey="player-guide" icon="guide" onPress={() => navigate({ name: 'guide', listId: browseGroup })}>
                {t('guide.title')}
              </Button>
            </Region>
            <VirtualList
              focusKey="player-groups"
              items={groups}
              itemKey={(g) => g.id}
              rowHeight={62}
              height={MINI_LIST_HEIGHT}
              index={groupIndex}
              onIndexChange={setGroupIndex}
              onSelect={(g) => {
                showBrowseGroup(g.id)
                if (visible(g.id).length) setFocus('player-list')
              }}
              renderRow={(g, _, focused) => (
                <GroupRow group={g} focused={focused} selected={g.id === browseGroup} unlocked={unlocked} count={groupCounts?.get(g.id)} />
              )}
            />
          </div>
          <div className="mini-channels">
            <div className="mini-header">
              <span className="mini-title">{groups.find((g) => g.id === browseGroup)?.name}</span>
              <span className="dim">
                {browseList.length ? `${clampIndex(listIndex, browseList.length) + 1} / ${formatCount(browseList.length)}` : ''}
              </span>
            </div>
            <VirtualList
              focusKey="player-list"
              items={browseList}
              itemKey={(c) => c.id}
              rowHeight={76}
              height={MINI_LIST_HEIGHT}
              index={listIndex}
              onIndexChange={setListIndex}
              onSelect={(c) => {
                closeList()
                if (c.id !== channelId) tune(c, browseGroup)
                else setListId(browseGroup)
              }}
              onRowAction={(c) => toggleFavorite(c.id)}
              renderRow={(c, _, focused, action) => (
                <ChannelRow
                  channel={c}
                  focused={focused}
                  actionFocused={action}
                  favorite={prefs.favorites.includes(c.id)}
                  onToggleFavorite={() => toggleFavorite(c.id)}
                  current={c.id === channelId}
                />
              )}
              empty={<p className="dim empty">{emptyListText(browseGroup, browseLocked)}</p>}
            />
          </div>
        </div>
      )}
      {miniList && <FocusOnMount focusKey={browseList.length ? 'player-list' : 'player-groups'} />}

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
