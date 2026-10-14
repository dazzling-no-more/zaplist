import { setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { useEffect, useMemo, useState } from 'react'
import { library, useLibrary } from '../data/library'
import type { ChannelGroup } from '../data/lists'
import { unlock, useUnlocked } from '../data/parental'
import { usePrefs } from '../data/prefs'
import { ALL_ITEMS, CONTINUE, vodByCategory, vodForGroup, vodGroups, type VodItem } from '../data/vod'
import { continueIds, useWatch } from '../data/watch'
import { t } from '../i18n'
import { Button } from '../ui/Button'
import { formatCount } from '../ui/format'
import { GroupRow } from '../ui/GroupRow'
import { Icon } from '../ui/Icon'
import { Poster } from '../ui/Logo'
import { navigate, useScreenFocus, type ScreenProps } from '../ui/navigation'
import { PinDialog } from '../ui/PinDialog'
import { Region } from '../ui/Region'
import { clampIndex } from '../ui/scroll'
import { VirtualGrid } from '../ui/VirtualGrid'
import { VirtualList } from '../ui/VirtualList'

const GROUP_ROW = 60
const GROUP_LIST_HEIGHT = 780
/** 7 posters across the 1224 px content column. */
const COLUMNS = 7
const CELL_WIDTH = 174
const CELL_HEIGHT = 330
const GRID_HEIGHT = 858
const GROUP_SELECT_DELAY_MS = 150

interface VodMemo {
  groupId?: string
  groupIndex?: number
  itemIndex?: number
}

/** Movies or Series: categories on the left, posters on the right. */
export function VodScreen({ entry }: ScreenProps<'vod'>) {
  const { kind } = entry
  const { movies, series, categories, sources } = useLibrary()
  const prefs = usePrefs()
  const unlocked = useUnlocked()
  const watch = useWatch()
  const memo = entry.memo as VodMemo
  const items: readonly VodItem[] = kind === 'movie' ? movies : series
  const recent = useMemo(() => continueIds(watch), [watch])
  const byCategory = useMemo(() => vodByCategory(items), [items])

  const groups = useMemo(
    () => vodGroups(kind, categories, sources, prefs, { continue: t('vod.continue'), all: t(kind === 'movie' ? 'vod.allMovies' : 'vod.allSeries') }),
    [kind, categories, sources, prefs.pin, prefs.lockedCategories],
  )
  const forGroup = (groupId: string): readonly VodItem[] =>
    vodForGroup<VodItem>(
      groupId,
      items,
      byCategory,
      (id) => (kind === 'movie' ? library.movie(id) : library.series(id)),
      kind === 'movie' ? recent.movies : recent.series,
      prefs,
      unlocked,
    )
  // Continue watching when there is something to continue, otherwise everything.
  const [groupId, setGroupId] = useState(() => memo.groupId ?? (forGroup(CONTINUE).length ? CONTINUE : ALL_ITEMS))
  const [groupIndex, setGroupIndex] = useState(() => clampIndex(memo.groupIndex ?? Math.max(0, groups.findIndex((g) => g.id === groupId)), groups.length))
  const [itemIndex, setItemIndex] = useState(memo.itemIndex ?? 0)
  const [askPin, setAskPin] = useState(false)

  const list = useMemo(() => forGroup(groupId), [groupId, byCategory, recent, prefs.pin, prefs.lockedCategories, unlocked])
  const counts = useMemo(() => new Map(groups.map((g) => [g.id, forGroup(g.id).length])), [groups, byCategory, recent, unlocked])
  const group: ChannelGroup | undefined = groups.find((g) => g.id === groupId)
  const locked = !!group?.locked && !unlocked
  const index = clampIndex(itemIndex, list.length)
  Object.assign(memo, { groupId, groupIndex, itemIndex: index })

  useScreenFocus(entry, list.length ? 'vod-grid' : 'vod-groups')

  const showGroup = (id: string) => {
    if (id === groupId) return
    setGroupId(id)
    setItemIndex(0)
  }
  useEffect(() => {
    const next = groups[groupIndex]
    if (!next || next.id === groupId) return
    const timer = setTimeout(() => showGroup(next.id), GROUP_SELECT_DELAY_MS)
    return () => clearTimeout(timer)
  }, [groupIndex])

  const open = (item: VodItem) => navigate(kind === 'movie' ? { name: 'movie', movieId: item.id } : { name: 'series', seriesId: item.id })
  const emptyText = groupId === CONTINUE ? t('vod.noContinue') : t(kind === 'movie' ? 'vod.noMovies' : 'vod.noSeries')

  return (
    <div className="screen">
      <Region focusKey="vod-sidebar" className="sidebar panel" preferredChild="vod-groups">
        <h1 className="brand">
          <Icon name={kind === 'movie' ? 'movie' : 'series'} />
          {t(kind === 'movie' ? 'vod.movies' : 'vod.series')}
        </h1>
        <VirtualList
          focusKey="vod-groups"
          items={groups}
          itemKey={(g) => g.id}
          rowHeight={GROUP_ROW}
          height={GROUP_LIST_HEIGHT}
          index={groupIndex}
          onIndexChange={setGroupIndex}
          onSelect={(g) => {
            showGroup(g.id)
            if (g.locked && !unlocked) setAskPin(true)
            else if (forGroup(g.id).length) setFocus('vod-grid')
          }}
          renderRow={(g, _, focused) => <GroupRow group={g} focused={focused} selected={g.id === groupId} unlocked={unlocked} count={counts.get(g.id)} />}
        />
      </Region>
      <Region focusKey="vod-content" className="content" focusable={locked || list.length > 0}>
        <div className="content-header">
          <h2>{group?.name ?? ''}</h2>
          {!locked && list.length > 0 && <span className="dim">{formatCount(list.length)}</span>}
        </div>
        {locked ? (
          <div className="empty">
            <p className="dim">{t('home.locked')}</p>
            <Button focusKey="vod-unlock" className="inline" onPress={() => setAskPin(true)}>
              {t('home.unlock')}
            </Button>
          </div>
        ) : (
          <VirtualGrid
            focusKey="vod-grid"
            items={list}
            itemKey={(item) => item.id}
            columns={COLUMNS}
            cellWidth={CELL_WIDTH}
            rowHeight={CELL_HEIGHT}
            height={GRID_HEIGHT}
            index={index}
            onIndexChange={setItemIndex}
            onSelect={open}
            renderCell={(item, _, focused) => <PosterCell item={item} focused={focused} progress={kind === 'movie' ? watch[item.id] : undefined} />}
            empty={<p className="dim empty">{emptyText}</p>}
          />
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

function PosterCell({ item, focused, progress }: { item: VodItem; focused: boolean; progress?: { position: number; duration: number } }) {
  const fraction = progress && progress.duration > 0 ? Math.min(1, progress.position / progress.duration) : 0
  return (
    <div className={`poster-cell${focused ? ' focused' : ''}`}>
      <Poster url={item.poster} name={item.name} />
      {fraction > 0 && (
        <div className="poster-progress">
          <div style={{ width: `${fraction * 100}%` }} />
        </div>
      )}
      <div className="poster-title">{item.name}</div>
    </div>
  )
}
