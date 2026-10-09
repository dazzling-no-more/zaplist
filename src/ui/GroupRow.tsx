import { FAVORITES, RECENT, type ChannelGroup, type GroupLabels } from '../data/lists'
import { t } from '../i18n'

export const groupLabels = (): GroupLabels => ({ favorites: t('home.favorites'), recent: t('home.recent'), all: t('home.all') })

/** What a group's channel list says when it has nothing to show. */
export function emptyListText(groupId: string, locked: boolean): string {
  if (locked) return t('home.locked')
  return t(groupId === FAVORITES ? 'home.noFavorites' : groupId === RECENT ? 'home.noRecents' : 'home.noChannels')
}

interface Props {
  group: ChannelGroup
  focused: boolean
  /** The group whose channels are shown next to the list. */
  selected: boolean
  unlocked: boolean
}

/** A row in a category list (Home sidebar, player channel list). */
export function GroupRow({ group, focused, selected, unlocked }: Props) {
  return (
    <div className={`group-row${focused ? ' focused' : ''}${selected ? ' selected' : ''}`}>
      <span className="group-name">
        {group.locked && <span className={`lock-icon${unlocked ? ' open' : ''}`} />}
        {group.name}
      </span>
      {group.detail && <span className="group-detail">{group.detail}</span>}
    </div>
  )
}
