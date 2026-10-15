import { ALL, FAVORITES, OVERVIEW, RECENT, type ChannelGroup, type GroupLabels } from '../data/lists'
import { t } from '../i18n'
import { formatCount } from './format'
import { Icon, type IconName } from './Icon'

export const groupLabels = (): GroupLabels => ({ favorites: t('home.favorites'), recent: t('home.recent'), all: t('home.all') })

/** What a group's channel list says when it has nothing to show. */
export function emptyListText(groupId: string, locked: boolean): string {
  if (locked) return t('home.locked')
  return t(groupId === FAVORITES ? 'home.noFavorites' : groupId === RECENT ? 'home.noRecents' : 'home.noChannels')
}

const ICONS: Record<string, IconName> = { [OVERVIEW]: 'home', [FAVORITES]: 'star', [RECENT]: 'recent', [ALL]: 'all' }

interface Props {
  group: ChannelGroup
  focused: boolean
  /** The group whose channels are shown next to the list. */
  selected: boolean
  unlocked: boolean
  /** Channels in the group, shown on the right. */
  count?: number
}

/** A row in a category list (Home sidebar, player channel list). */
export function GroupRow({ group, focused, selected, unlocked, count }: Props) {
  const icon = group.locked ? 'lock' : ICONS[group.id]
  return (
    <div className={`group-row${focused ? ' focused' : ''}${selected ? ' selected' : ''}${group.locked && unlocked ? ' unlocked' : ''}`}>
      {icon && <Icon name={icon} />}
      <span className="group-name">{group.name}</span>
      {group.detail && <span className="group-detail">{group.detail}</span>}
      {count !== undefined && !(group.locked && !unlocked) && <span className="group-count">{formatCount(count)}</span>}
    </div>
  )
}
