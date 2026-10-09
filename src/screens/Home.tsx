import { setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { useEffect, useMemo, useState } from 'react'
import { library, useLibrary } from '../data/library'
import { ALL, buildGroups, channelsByCategory, channelsForGroup, FAVORITES, type ChannelGroup } from '../data/lists'
import type { Channel } from '../data/models'
import { unlock, useUnlocked } from '../data/parental'
import { moveFavorite, toggleFavorite, usePrefs } from '../data/prefs'
import { t } from '../i18n'
import { Button } from '../ui/Button'
import { ChannelRow } from '../ui/ChannelRow'
import { Dialog } from '../ui/Dialog'
import { emptyListText, groupLabels, GroupRow } from '../ui/GroupRow'
import { navigate, useBackHandler, useScreenFocus, type ScreenProps } from '../ui/navigation'
import { PinDialog } from '../ui/PinDialog'
import { playChannel } from '../ui/play'
import { Region } from '../ui/Region'
import { clampIndex } from '../ui/scroll'
import { VirtualList } from '../ui/VirtualList'

const GROUP_ROW = 68
const GROUP_LIST_HEIGHT = 544
const CHANNEL_ROW = 84
const CHANNEL_LIST_HEIGHT = 840
/** Moving through the sidebar shows a category after it stays focused this long. */
const GROUP_SELECT_DELAY_MS = 150

interface HomeMemo {
  groupIndex?: number
  groupId?: string
  channelIndex?: number
  /** The last played channel when Home was last shown; a different one means the player was used since. */
  lastPlayed?: string
}

export function HomeScreen({ entry }: ScreenProps<'home'>) {
  const { ready, sources } = useLibrary()
  if (!ready) return <p className="dim">{t('common.loading')}</p>
  if (!sources.length) return <Welcome entry={entry} />
  return <Browse entry={entry} />
}

function Welcome({ entry }: ScreenProps<'home'>) {
  useScreenFocus(entry, 'home-add-source')
  return (
    <Region focusKey="home-welcome" className="welcome">
      <h1>{t('appName')}</h1>
      <h2>{t('home.welcome')}</h2>
      <p className="dim">{t('home.welcomeDetail')}</p>
      <Button focusKey="home-add-source" className="inline primary" onPress={() => navigate({ name: 'sourceEdit' })}>
        {t('home.addSource')}
      </Button>
    </Region>
  )
}

function Browse({ entry }: ScreenProps<'home'>) {
  const { channels, categories, sources } = useLibrary()
  const prefs = usePrefs()
  const unlocked = useUnlocked()
  const memo = entry.memo as HomeMemo

  const groups = useMemo(
    () => buildGroups(categories, sources, prefs, groupLabels()),
    [categories, sources, prefs.pin, prefs.lockedCategories],
  )
  const byCategory = useMemo(() => channelsByCategory(channels), [channels])
  // Open the group of the last played channel on the first visit and after the player was used (it can
  // switch groups); otherwise keep the group the user left Home on.
  const [groupId, setGroupId] = useState(() => {
    const lastList = groups.some((g) => g.id === prefs.lastListId) ? prefs.lastListId : undefined
    const playedSince = memo.lastPlayed !== prefs.lastChannelId
    if (memo.groupId && !(playedSince && lastList)) return memo.groupId
    return lastList ?? ALL
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
  // Coming back from the player: show the channel watched last (it may have changed by zapping).
  const [channelIndex, setChannelIndex] = useState(() => {
    const played = memo.lastPlayed !== prefs.lastChannelId ? list.findIndex((c) => c.id === prefs.lastChannelId) : -1
    return played >= 0 ? played : (memo.channelIndex ?? 0)
  })
  const group: ChannelGroup | undefined = groups.find((g) => g.id === groupId)
  const index = clampIndex(channelIndex, list.length)
  const locked = !!group?.locked && !unlocked
  Object.assign(memo, { groupIndex, groupId, channelIndex: index, lastPlayed: prefs.lastChannelId })

  useScreenFocus(entry, list.length ? 'home-channels' : 'home-groups')

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
      <Region focusKey="home-sidebar" className="sidebar" preferredChild="home-groups">
        <h1>{t('appName')}</h1>
        <Button focusKey="home-search" onPress={() => navigate({ name: 'search' })}>
          {t('home.search')}
        </Button>
        <Button focusKey="home-guide" onPress={() => navigate({ name: 'guide', listId: groupId })}>
          {t('guide.title')}
        </Button>
        <Button focusKey="home-settings" onPress={() => navigate({ name: 'settings' })}>
          {t('settings.title')}
        </Button>
        <VirtualList
          focusKey="home-groups"
          className="group-list"
          items={groups}
          itemKey={(g) => g.id}
          rowHeight={GROUP_ROW}
          height={GROUP_LIST_HEIGHT}
          index={groupIndex}
          onIndexChange={setGroupIndex}
          onSelect={(g) => {
            showGroup(g.id)
            if (g.locked && !unlocked) setAskPin(true)
            else if (g.id === groupId ? list.length : true) setFocus('home-channels')
          }}
          renderRow={(g, _, focused) => <GroupRow group={g} focused={focused} selected={g.id === groupId} unlocked={unlocked} />}
        />
      </Region>
      <Region focusKey="home-content" className="content" focusable={locked || list.length > 0}>
        <h2>{group?.name ?? ''}</h2>
        {locked ? (
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
            renderRow={(channel, _, focused) => (
              <ChannelRow channel={channel} focused={focused} favorite={prefs.favorites.includes(channel.id)} moving={channel.id === moving} />
            )}
            empty={empty}
          />
        )}
        <div className="hints">
          {moving ? (
            t('hint.moving')
          ) : (
            <>
              {t('hint.watch')} · {t('hint.more')} · <span className="key-red" /> {t('hint.favorite')}
              {groupId === FAVORITES && (
                <>
                  {' · '}
                  <span className="key-yellow" /> {t('hint.move')}
                </>
              )}
            </>
          )}
        </div>
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
