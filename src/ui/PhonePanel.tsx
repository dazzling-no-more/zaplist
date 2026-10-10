import { useEffect, useRef, useState } from 'react'
import { canPair, newPairing, receive, type Pairing, type PhoneEntry } from '../data/relay'
import { t } from '../i18n'
import { Button } from './Button'
import { QrCode } from './QrCode'

const POLL_MS = 3000
/** Then the code makes way for a "New code" button, so an idle screen doesn't poll for ever. */
const ACTIVE_MS = 15 * 60_000

/** A QR code that opens the relay's page on a phone; what the user enters there arrives in `onReceive`. */
export function PhonePanel({ onReceive }: { onReceive: (entry: PhoneEntry) => void }) {
  const [pairing, setPairing] = useState<Pairing>()
  const [expired, setExpired] = useState(false)
  const latest = useRef(onReceive)
  latest.current = onReceive

  useEffect(() => {
    if (expired || !canPair()) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    void newPairing().then(
      (next) => {
        if (stopped) return
        setPairing(next)
        const until = Date.now() + ACTIVE_MS
        const poll = () => {
          if (stopped) return
          if (Date.now() > until) return setExpired(true)
          receive(next)
            .then((entry) => {
              if (entry && !stopped) latest.current(entry)
            })
            .catch(() => undefined) // offline for a moment: try again
            .then(() => {
              if (!stopped) timer = setTimeout(poll, POLL_MS)
            })
        }
        timer = setTimeout(poll, POLL_MS)
      },
      () => undefined,
    )
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [expired])

  if (!canPair()) return null
  return (
    <div className="phone-panel">
      <h2>{t('phone.title')}</h2>
      {expired ? (
        <>
          <p className="dim">{t('phone.expired')}</p>
          <Button className="inline" onPress={() => setExpired(false)}>
            {t('phone.newCode')}
          </Button>
        </>
      ) : (
        pairing && (
          <>
            <QrCode text={pairing.link} size={300} />
            <p className="dim">{t('phone.scan')}</p>
          </>
        )
      )}
    </div>
  )
}
