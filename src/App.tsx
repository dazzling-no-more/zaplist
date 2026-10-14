import type { ComponentType } from 'react'
import { GuideScreen } from './screens/Guide'
import { HomeScreen } from './screens/Home'
import { MovieScreen } from './screens/MovieDetails'
import { PlayerScreen } from './screens/Player'
import { SearchScreen } from './screens/Search'
import { SeriesScreen } from './screens/SeriesDetails'
import { SettingsScreen } from './screens/Settings'
import { SourceEditScreen } from './screens/SourceEdit'
import { VodScreen } from './screens/Vod'
import { VodPlayerScreen } from './screens/VodPlayer'
import { useBackStack, type ScreenName, type ScreenProps } from './ui/navigation'

const SCREENS: { [N in ScreenName]: ComponentType<ScreenProps<N>> } = {
  home: HomeScreen,
  guide: GuideScreen,
  player: PlayerScreen,
  search: SearchScreen,
  settings: SettingsScreen,
  sourceEdit: SourceEditScreen,
  vod: VodScreen,
  movie: MovieScreen,
  series: SeriesScreen,
  vodPlayer: VodPlayerScreen,
}

export function App() {
  const { screens } = useBackStack()
  const top = screens[screens.length - 1]
  const Screen = SCREENS[top.name] as ComponentType<ScreenProps>

  return <Screen key={top.id} entry={top} />
}
