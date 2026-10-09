import { useState } from 'react'
import { useLibrary } from '../../data/library'
import { markUnlocked, unlock, useUnlocked } from '../../data/parental'
import { updatePrefs, usePrefs } from '../../data/prefs'
import { t } from '../../i18n'
import { Button } from '../../ui/Button'
import { Icon } from '../../ui/Icon'
import { PinDialog } from '../../ui/PinDialog'
import { Region } from '../../ui/Region'
import { VirtualList } from '../../ui/VirtualList'

type Step = 'unlock' | 'new' | 'confirm'

export function ParentalSection() {
  const prefs = usePrefs()
  const unlocked = useUnlocked()
  const { categories, sources } = useLibrary()
  const [step, setStep] = useState<Step>()
  const [newPin, setNewPin] = useState('')
  const [mismatch, setMismatch] = useState(false)
  const [index, setIndex] = useState(0)
  const several = sources.length > 1
  const sourceName = (id: string) => sources.find((s) => s.id === id)?.name

  const toggle = (categoryId: string) => {
    const locked = prefs.lockedCategories
    updatePrefs({ lockedCategories: locked.includes(categoryId) ? locked.filter((id) => id !== categoryId) : [...locked, categoryId] })
  }

  const dialog =
    step === 'unlock' ? (
      <PinDialog
        title={t('pin.enter')}
        onSubmit={(pin) => {
          if (!unlock(pin)) return false
          setStep(undefined)
        }}
        onCancel={() => setStep(undefined)}
      />
    ) : step === 'new' ? (
      <PinDialog
        key="new"
        title={t('pin.new')}
        message={mismatch ? t('pin.mismatch') : undefined}
        onSubmit={(pin) => {
          setNewPin(pin)
          setMismatch(false)
          setStep('confirm')
        }}
        onCancel={() => setStep(undefined)}
      />
    ) : step === 'confirm' ? (
      <PinDialog
        key="confirm"
        title={t('pin.confirm')}
        onSubmit={(pin) => {
          if (pin !== newPin) {
            setMismatch(true)
            setStep('new')
            return
          }
          updatePrefs({ pin })
          markUnlocked()
          setStep(undefined)
        }}
        onCancel={() => setStep(undefined)}
      />
    ) : null

  return (
    <Region focusKey="settings-content" className="content">
      <h2>{t('settings.parental')}</h2>
      {!prefs.pin ? (
        <>
          <p className="dim">{t('parental.off')}</p>
          <Button className="inline" onPress={() => setStep('new')}>
            {t('parental.setPin')}
          </Button>
        </>
      ) : !unlocked ? (
        <>
          <p className="dim">{t('parental.unlockToEdit')}</p>
          <Button className="inline" onPress={() => setStep('unlock')}>
            {t('home.unlock')}
          </Button>
        </>
      ) : (
        <>
          <div className="button-row">
            <Button onPress={() => setStep('new')}>{t('parental.changePin')}</Button>
            <Button onPress={() => updatePrefs({ pin: undefined, lockedCategories: [] })}>{t('parental.turnOff')}</Button>
          </div>
          <h3>{t('parental.categories')}</h3>
          <VirtualList
            focusKey="parental-categories"
            items={categories}
            itemKey={(c) => c.id}
            rowHeight={68}
            height={612}
            index={index}
            onIndexChange={setIndex}
            onSelect={(c) => toggle(c.id)}
            renderRow={(c, _, focused) => (
              <div className={`group-row${focused ? ' focused' : ''}`}>
                <span className="group-name">
                  {prefs.lockedCategories.includes(c.id) && <Icon name="lock" />}
                  {c.name}
                </span>
                <span className="group-detail">
                  {several ? sourceName(c.sourceId) + ' · ' : ''}
                  {t(prefs.lockedCategories.includes(c.id) ? 'parental.locked' : 'parental.unlocked')}
                </span>
              </div>
            )}
            empty={<p className="dim">{t('parental.noCategories')}</p>}
          />
        </>
      )}
      {dialog}
    </Region>
  )
}
