import { setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { deleteDatabase } from '../data/db'
import { library, useLibrary } from '../data/library'
import { ALL, buildGroups, channelsByCategory, channelsForGroup, FAVORITES, OVERVIEW, type ChannelGroup } from '../data/lists'
import type { Channel } from '../data/models'
import { unlock, useUnlocked } from '../data/parental'
import { clearPrefs, moveFavorite, toggleFavorite, usePrefs } from '../data/prefs'
import { canPair } from '../data/relay'
import { clearWatch } from '../data/watch'
import { t } from '../i18n'
import { Button } from '../ui/Button'
import { ChannelRow } from '../ui/ChannelRow'
import { Dialog } from '../ui/Dialog'
import { Hint, Key } from '../ui/Hint'
import { formatCount } from '../ui/format'
import { emptyListText, groupLabels, GroupRow } from '../ui/GroupRow'
import { Icon } from '../ui/Icon'
import { navigate, useBackHandler, useScreenFocus, type ScreenProps } from '../ui/navigation'
import { PhonePanel } from '../ui/PhonePanel'
import { PinDialog } from '../ui/PinDialog'
import { playChannel } from '../ui/play'
import { Region } from '../ui/Region'
import { clampIndex } from '../ui/scroll'
import { VirtualList } from '../ui/VirtualList'
import { HomeOverview, isOverviewEmpty, overviewFocusKey, useOverview } from './HomeOverview'

const GROUP_ROW = 60
const GROUP_LIST_HEIGHT = 576
/** A sidebar button (Movies, Series), which the category list makes room for. */
const NAV_BUTTON = 85
/** Room for the 76 px favorite star (LG recommends click targets of at least 75 x 75 px). */
const CHANNEL_ROW = 86
const CHANNEL_LIST_HEIGHT = 860
/** The content column while the sidebar is a rail: 1728 minus the 112 px rail and its 64 px margin. */
const OVERVIEW_WIDTH = 1552
/** Moving through the sidebar shows a category after it stays focused this long. */
const GROUP_SELECT_DELAY_MS = 150

interface HomeMemo {
  groupIndex?: number
  groupId?: string
  channelIndex?: number
  /** The last played channel when Home was last shown; a different one means the player was used since. */
  lastPlayed?: string
  /** The overview's focused card per shelf. */
  overview?: Record<string, number>
}

/** Focus keys in Home's content column; the sidebar is a rail while one of them has focus. */
const isContentKey = (key: string): boolean => key === 'home-channels' || key === 'home-unlock' || key.indexOf('overview-') === 0

export function HomeScreen({ entry }: ScreenProps<'home'>) {
  const { ready, sources, error } = useLibrary()
  if (error) return <StorageError entry={entry} error={error} />
  if (!ready) return <p className="dim">{t('common.loading')}</p>
  if (!sources.length) return <Welcome entry={entry} />
  return <Browse entry={entry} />
}

/** First launch: add a playlist on the TV, or scan the QR code and type it on a phone. */
function Welcome({ entry }: ScreenProps<'home'>) {
  useScreenFocus(entry, 'home-add-source')
  return (
    <Region focusKey="home-welcome" className="welcome welcome-split">
      <div className="welcome-main">
        <img className="welcome-logo" src="largeIcon.png" alt="" />
        <h1>{t('appName')}</h1>
        <h2>{t('home.welcome')}</h2>
        <p className="dim">{t('home.welcomeDetail')}</p>
        <Button focusKey="home-add-source" className="inline primary" icon="add" onPress={() => navigate({ name: 'sourceEdit' })}>
          {t('home.addSource')}
        </Button>
      </div>
      {canPair() && (
        <div className="welcome-phone">
          <PhonePanel qrSize={380} onReceive={(phone) => navigate({ name: 'sourceEdit', phone })} />
        </div>
      )}
    </Region>
  )
}

/** The stored data couldn't be read: try again, or start over with empty storage. */
function StorageError({ entry, error }: ScreenProps<'home'> & { error: unknown }) {
  useScreenFocus(entry, 'storage-retry')
  const [confirm, setConfirm] = useState(false)
  const reset = async () => {
    await deleteDatabase().catch(() => undefined)
    clearPrefs()
    clearWatch()
    location.reload()
  }
  return (
    <Region focusKey="home-storage-error" className="welcome">
      <h1>{t('appName')}</h1>
      <h2>{t('storage.title')}</h2>
      <p className="dim">{t('storage.detail')}</p>
      <p className="dim small">{String(error)}</p>
      <div className="button-row">
        <Button focusKey="storage-retry" className="inline primary" onPress={() => location.reload()}>
          {t('storage.retry')}
        </Button>
        <Button focusKey="storage-reset" className="inline" onPress={() => setConfirm(true)}>
          {t('storage.reset')}
        </Button>
      </div>
      {confirm && (
        <Dialog
          title={t('storage.resetTitle')}
          message={t('storage.resetMessage')}
          buttons={[
            { label: t('storage.reset'), onPress: () => void reset() },
            { label: t('common.cancel'), onPress: () => setConfirm(false) },
          ]}
          initialFocus={1}
          onCancel={() => setConfirm(false)}
        />
      )}
    </Region>
  )
}

function Browse({ entry }: ScreenProps<'home'>) {
  const { channels, categories, sources, movies, series } = useLibrary()
  const prefs = usePrefs()
  const unlocked = useUnlocked()
  const memo = entry.memo as HomeMemo

  const groups = useMemo(
    () => [{ id: OVERVIEW, name: t('home.overview'), locked: false }, ...buildGroups(categories, sources, prefs, groupLabels())],
    [categories, sources, prefs.pin, prefs.lockedCategories],
  )
  const byCategory = useMemo(() => channelsByCategory(channels), [channels])
  const overview = useOverview()
  const overviewEmpty = isOverviewEmpty(overview)
  // Open the group of the last played channel on the first visit and after the player was used (it can
  // switch groups); otherwise keep the group the user left Home on, and the overview always.
  const [groupId, setGroupId] = useState(() => {
    const lastList = groups.some((g) => g.id === prefs.lastListId) ? prefs.lastListId : undefined
    const playedSince = memo.lastPlayed !== prefs.lastChannelId
    if (memo.groupId && (memo.groupId === OVERVIEW || !(playedSince && lastList))) return memo.groupId
    return lastList ?? (overviewEmpty ? ALL : OVERVIEW)
  })
  const [groupIndex, setGroupIndex] = useState(() =>
    clampIndex(
      groupId === memo.groupId && memo.groupIndex !== undefined ? memo.groupIndex : Math.max(0, groups.findIndex((g) => g.id === groupId)),
      groups.length,
    ),
  )
  const [menu, setMenu] = useState<Channel>()
  const [moving, setMoving] = useState<string>()
  const [askPin, setAskPin] = useState(false)

  const list = useMemo(
    () => channelsForGroup(groupId, channels, (id) => library.channel(id), byCategory, prefs, unlocked),
    [groupId, channels, byCategory, prefs.favorites, prefs.recents, prefs.pin, prefs.lockedCategories, unlocked],
  )
  /** The channel played since Home was last shown (by zapping, it may not be the one picked here). */
  const [played] = useState(() => (memo.lastPlayed !== prefs.lastChannelId ? prefs.lastChannelId : undefined))
  // Coming back from the player: show the channel watched last (it may have changed by zapping).
  const [channelIndex, setChannelIndex] = useState(() => {
    const at = played ? list.findIndex((c) => c.id === played) : -1
    return at >= 0 ? at : (memo.channelIndex ?? 0)
  })
  const groupCounts = useMemo(
    () =>
      new Map(
        groups
          .filter((g) => g.id !== OVERVIEW)
          .map((g) => [g.id, channelsForGroup(g.id, channels, (id) => library.channel(id), byCategory, prefs, unlocked).length]),
      ),
    [groups, channels, byCategory, prefs.favorites, prefs.recents, prefs.pin, prefs.lockedCategories, unlocked],
  )
  const group: ChannelGroup | undefined = groups.find((g) => g.id === groupId)
  const index = clampIndex(channelIndex, list.length)
  const locked = !!group?.locked && !unlocked
  const isOverview = groupId === OVERVIEW
  const contentKey = isOverview ? overviewFocusKey(overview) : 'home-channels'
  const hasContent = isOverview ? !overviewEmpty : list.length > 0
  Object.assign(memo, { groupIndex, groupId, channelIndex: index })
  // After rendering rather than during it: `played` must see the previous value even when React renders
  // twice (development mode).
  useEffect(() => {
    memo.lastPlayed = prefs.lastChannelId
  })

  useScreenFocus(entry, hasContent ? contentKey : 'home-groups')
  // The sidebar is a rail of icons while the content has focus; moving into it opens the full panel.
  const [rail, setRail] = useState(() => isContentKey(entry.focusKey ?? (hasContent ? contentKey : 'home-groups')))
  // OK on a group focuses its channels (or the overview) once they're rendered.
  const [contentFocus, setContentFocus] = useState(0)
  useEffect(() => {
    if (contentFocus && hasContent) setFocus(contentKey)
  }, [contentFocus])
  // Unlocked with the PIN: the Unlock button that had focus is gone, so focus what the group shows now.
  const wasUnlocked = useRef(unlocked)
  useEffect(() => {
    if (!wasUnlocked.current && unlocked) setFocus(hasContent ? contentKey : 'home-groups')
    wasUnlocked.current = unlocked
  }, [unlocked])

  const showGroup = (id: string) => {
    if (id === groupId) return
    setGroupId(id)
    setChannelIndex(0)
    setMoving(undefined)
  }

  useEffect(() => {
    const next = groups[groupIndex]
    if (!next || next.id === groupId) return
    const timer = setTimeout(() => showGroup(next.id), GROUP_SELECT_DELAY_MS)
    return () => clearTimeout(timer)
  }, [groupIndex])

  useBackHandler(() => {
    setMoving(undefined)
    return true
  }, !!moving)

  const play = (channel: Channel) => {
    if (moving) return setMoving(undefined)
    playChannel(channel, groupId)
  }

  const empty = locked ? null : <p className="dim empty">{emptyListText(groupId, false)}</p>

  return (
    <div className="screen">
      <Region focusKey="home-sidebar" className={`sidebar panel${rail ? ' rail' : ''}`} preferredChild="home-groups" onFocusWithin={() => setRail(false)}>
        <h1 className="brand">
          <span className="brand-mark">
            <Icon name="logo" />
          </span>
          <span className="brand-name">{t('appName')}</span>
        </h1>
        <Button focusKey="home-search" className="nav" icon="search" onPress={() => navigate({ name: 'search' })}>
          {t('home.search')}
        </Button>
        <Button focusKey="home-guide" className="nav" icon="guide" onPress={() => navigate({ name: 'guide', listId: isOverview ? ALL : groupId })}>
          {t('guide.title')}
        </Button>
        {movies.length > 0 && (
          <Button focusKey="home-movies" className="nav" icon="movie" onPress={() => navigate({ name: 'vod', kind: 'movie' })}>
            {t('vod.movies')}
          </Button>
        )}
        {series.length > 0 && (
          <Button focusKey="home-series" className="nav" icon="series" onPress={() => navigate({ name: 'vod', kind: 'series' })}>
            {t('vod.series')}
          </Button>
        )}
        <Button focusKey="home-settings" className="nav" icon="settings" onPress={() => navigate({ name: 'settings' })}>
          {t('settings.title')}
        </Button>
        <VirtualList
          focusKey="home-groups"
          className="group-list"
          items={groups}
          itemKey={(g) => g.id}
          rowHeight={GROUP_ROW}
          height={GROUP_LIST_HEIGHT - NAV_BUTTON * ((movies.length > 0 ? 1 : 0) + (series.length > 0 ? 1 : 0))}
          index={groupIndex}
          onIndexChange={setGroupIndex}
          onSelect={(g) => {
            showGroup(g.id)
            if (g.locked && !unlocked) setAskPin(true)
            else setContentFocus((n) => n + 1)
          }}
          renderRow={(g, _, focused) => (
            <GroupRow group={g} focused={focused} selected={g.id === groupId} unlocked={unlocked} count={groupCounts.get(g.id)} />
          )}
        />
      </Region>
      <Region focusKey="home-content" className="content" focusable={locked || hasContent} onFocusWithin={() => setRail(true)}>
        <div className="content-header">
          <h2>{group?.name ?? ''}</h2>
          {!isOverview && !locked && list.length > 0 && <span className="dim">{t('sources.channels', { count: formatCount(list.length) })}</span>}
        </div>
        {isOverview ? (
          overviewEmpty ? (
            <p className="dim empty">{t('home.overviewEmpty')}</p>
          ) : (
            <HomeOverview overview={overview} memo={memo} played={played} width={OVERVIEW_WIDTH} height={CHANNEL_LIST_HEIGHT} />
          )
        ) : locked ? (
          <div className="empty">
            <p className="dim">{t('home.locked')}</p>
            <Button focusKey="home-unlock" className="inline" onPress={() => setAskPin(true)}>
              {t('home.unlock')}
            </Button>
          </div>
        ) : (
          <VirtualList
            focusKey="home-channels"
            items={list}
            itemKey={(c) => c.id}
            rowHeight={CHANNEL_ROW}
            height={CHANNEL_LIST_HEIGHT}
            index={index}
            onIndexChange={setChannelIndex}
            onSelect={play}
            onLongPress={(channel) => !moving && setMenu(channel)}
            onVertical={(direction) => {
              if (!moving) return false
              setChannelIndex(moveFavorite(moving, direction))
              return true
            }}
            onKey={(key, channel) => {
              if (!channel) return false
              if (key === 'red' && !moving) toggleFavorite(channel.id)
              else if (key === 'yellow' && groupId === FAVORITES) setMoving(moving ? undefined : channel.id)
              else return false
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
                moving={channel.id === moving}
                onMove={(delta) => setChannelIndex(moveFavorite(channel.id, delta))}
              />
            )}
            empty={empty}
          />
        )}
        {isOverview && !overviewEmpty && (
          <div className="hints">
            <Hint keys={<Key>{t('key.ok')}</Key>} label={t('hint.watch')} />
          </div>
        )}
        {!isOverview && !locked && list.length > 0 && (
          <div className="hints">
            {moving ? (
              <>
                <Hint
                  keys={
                    <>
                      <Key>
                        <Icon name="up" />
                      </Key>
                      <Key>
                        <Icon name="down" />
                      </Key>
                    </>
                  }
                  label={t('hint.move')}
                />
                <Hint keys={<Key>{t('key.ok')}</Key>} label={t('hint.done')} />
              </>
            ) : (
              <>
                <Hint keys={<Key>{t('key.ok')}</Key>} label={t('hint.watch')} />
                <Hint
                  keys={
                    <>
                      <Key>
                        <Icon name="right" />
                      </Key>
                      <Key color="red" />
                    </>
                  }
                  label={t('hint.favorite')}
                />
                <Hint keys={<Key>{t('key.holdOk')}</Key>} label={t('hint.more')} />
                {groupId === FAVORITES && <Hint keys={<Key color="yellow" />} label={t('hint.move')} />}
              </>
            )}
          </div>
        )}
      </Region>
      {menu && (
        <Dialog
          title={menu.name}
          buttons={[
            {
              label: t(prefs.favorites.includes(menu.id) ? 'menu.removeFavorite' : 'menu.addFavorite'),
              onPress: () => {
                toggleFavorite(menu.id)
                setMenu(undefined)
              },
            },
            ...(groupId === FAVORITES
              ? [
                  {
                    label: t('menu.move'),
                    onPress: () => {
                      setMoving(menu.id)
                      setMenu(undefined)
                    },
                  },
                ]
              : []),
            { label: t('common.cancel'), onPress: () => setMenu(undefined) },
          ]}
          onCancel={() => setMenu(undefined)}
        />
      )}
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
