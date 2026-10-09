import type { Channel } from '../data/models'
import { Logo } from './Logo'

interface Props {
  channel: Channel
  focused: boolean
  favorite: boolean
  /** Being reordered in Favorites. */
  moving?: boolean
}

export function ChannelRow({ channel, focused, favorite, moving }: Props) {
  return (
    <div className={`channel-row${focused ? ' focused' : ''}${moving ? ' moving' : ''}`}>
      <span className="channel-number">{channel.number}</span>
      <Logo url={channel.logo} name={channel.name} />
      <div className="channel-text">
        <div className="channel-name">
          {favorite && <span className="fav-dot" />}
          {channel.name}
        </div>
      </div>
    </div>
  )
}
