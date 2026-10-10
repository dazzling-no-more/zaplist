import type { MouseEvent } from 'react'
import type { Channel } from '../data/models'
import { Icon } from './Icon'
import { Logo } from './Logo'
import { NowPlaying } from './NowPlaying'

interface Props {
  channel: Channel
  focused: boolean
  favorite: boolean
  /** The favorite button has focus (list row action). */
  actionFocused?: boolean
  /** Shows the favorite button; without it the star only marks favorites. */
  onToggleFavorite?: () => void
  /** Being reordered in Favorites. */
  moving?: boolean
  /** While moving: up and down buttons for the pointer, which has no arrow keys. */
  onMove?: (delta: -1 | 1) => void
  /** The channel playing now (player mini list). */
  current?: boolean
}

export function ChannelRow({ channel, focused, favorite, actionFocused, onToggleFavorite, moving, onMove, current }: Props) {
  const toggle = (event: MouseEvent) => {
    event.stopPropagation() // a click on the star must not also play the channel
    onToggleFavorite?.()
  }
  const move = (delta: -1 | 1) => (event: MouseEvent) => {
    event.stopPropagation() // a click on the row ends moving
    onMove?.(delta)
  }
  const showStar = favorite || (focused && !!onToggleFavorite)
  const rowFocus = focused ? (actionFocused ? ' action-row' : ' focused') : ''
  return (
    <div className={`channel-row${rowFocus}${moving ? ' moving' : ''}${current ? ' current' : ''}`}>
      <span className="channel-number">{channel.number}</span>
      <Logo url={channel.logo} name={channel.name} />
      <div className="channel-text">
        <div className="channel-name">{channel.name}</div>
        <NowPlaying channel={channel} />
      </div>
      {moving && onMove && (
        <>
          <span className="row-action" onClick={move(-1)}>
            <Icon name="up" />
          </span>
          <span className="row-action" onClick={move(1)}>
            <Icon name="down" />
          </span>
        </>
      )}
      {/* Rows that can take a star keep its space, so the now-playing bars line up. */}
      {(showStar || onToggleFavorite) && (
        <span className={`row-action${favorite ? ' on' : ''}${actionFocused ? ' focused' : ''}`} onClick={onToggleFavorite ? toggle : undefined}>
          {showStar && <Icon name={favorite ? 'star' : 'starOutline'} />}
        </span>
      )}
    </div>
  )
}
