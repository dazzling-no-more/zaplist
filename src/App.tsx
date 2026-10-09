import type { ComponentType } from 'react'
import { t } from './i18n'
import { platformBack } from './platform/webos'
import { HomeScreen } from './screens/Home'
import { SettingsScreen } from './screens/Settings'
import { Dialog } from './ui/Dialog'
import { backStack, useBackStack, type ScreenName, type ScreenProps } from './ui/navigation'

const SCREENS: Record<ScreenName, ComponentType<ScreenProps>> = {
  home: HomeScreen,
  settings: SettingsScreen,
}

const cancelExit = () => backStack.closeExitPrompt()

function exitApp() {
  backStack.closeExitPrompt()
  platformBack()
}

export function App() {
  const { screens, exitPrompt } = useBackStack()
  const top = screens[screens.length - 1]
  const Screen = SCREENS[top.name]

  return (
    <>
      <Screen key={top.id} entry={top} />
      {exitPrompt && (
        <Dialog
          title={t('exit.title')}
          buttons={[
            { label: t('exit.confirm'), onPress: exitApp },
            { label: t('exit.cancel'), onPress: cancelExit },
          ]}
          initialFocus={1}
          onCancel={cancelExit}
        />
      )}
    </>
  )
}
