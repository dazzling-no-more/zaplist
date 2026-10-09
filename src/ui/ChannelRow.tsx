import type { Channel } from '../data/models'
import { Logo } from './Logo'
import { NowPlaying } from './NowPlaying'

interface Props {
  channel: Channel
  focused: boolean
  favorite: boolean
  /** Being reordered in Favorites. */
  moving?: boolean
  /** The channel playing now (player mini list). */
  current?: boolean
}

export function ChannelRow({ channel, focused, favorite, moving, current }: Props) {
  return (
    <div className={`channel-row${focused ? ' focused' : ''}${moving ? ' moving' : ''}${current ? ' current' : ''}`}>
      <span className="channel-number">{channel.number}</span>
      <Logo url={channel.logo} name={channel.name} />
      <div className="channel-text">
        <div className="channel-name">
          {favorite && <span className="fav-dot" />}
          {channel.name}
        </div>
        <NowPlaying channel={channel} />
      </div>
    </div>
  )
}
