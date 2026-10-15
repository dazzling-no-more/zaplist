import { useEffect, useState } from 'react'
import { t } from '../i18n'
import { cycleSleep, setSleep, useSleep } from '../player/sleep'
import { closeApp } from '../platform/webos'
import { Button } from './Button'
import { useNow } from './clock'
import { Dialog } from './Dialog'
import { backStack } from './navigation'

/**
 * The sleep timer's last minute, counted down in a dialog that can stop it. When it runs out:
 * back to the first screen (which stops any player), then the app closes on the TV. Shown on every
 * screen, as the timer runs on whatever is open.
 */
export function SleepTimer() {
  const { endsAt, warning } = useSleep()
  const [secondsLeft, setSecondsLeft] = useState(0)

  useEffect(() => {
    if (!warning) return
    const tick = () => {
      const left = endsAt - Date.now()
      if (left > 0) return setSecondsLeft(Math.ceil(left / 1000))
      setSleep(0)
      while (backStack.pop()) {
        // down to the first screen
      }
      closeApp()
    }
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [warning, endsAt])

  if (!warning || !secondsLeft) return null
  return (
    <Dialog
      title={t('sleep.title')}
      message={t('sleep.message', { count: secondsLeft })}
      buttons={[{ label: t('sleep.keepWatching'), onPress: () => setSleep(0) }]}
      onCancel={() => setSleep(0)}
    />
  )
}

/** The players' button for the sleep timer: each press takes the next choice (Off, 30 min, ..., 2 h). */
export function SleepButton() {
  const { endsAt } = useSleep()
  useNow() // the minutes left, every 30 s
  const minutes = endsAt ? Math.max(1, Math.ceil((endsAt - Date.now()) / 60_000)) : 0
  return (
    <Button focusKey="osd-sleep" icon="sleep" onPress={() => cycleSleep()}>
      {minutes ? t('player.sleepIn', { count: minutes }) : t('player.sleepOff')}
    </Button>
  )
}
