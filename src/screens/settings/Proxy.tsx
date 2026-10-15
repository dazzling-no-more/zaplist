import { setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { useState } from 'react'
import { updatePrefs, usePrefs } from '../../data/prefs'
import { t } from '../../i18n'
import { remuxSupport } from '../../player/engines'
import { Button } from '../../ui/Button'
import { Region } from '../../ui/Region'
import { TextField } from '../../ui/TextField'

/**
 * A SOCKS5 proxy for streams the TV's own connection can't reach (a network that blocks the IPTV
 * provider's stream servers): a stream that fails directly is tried again through it.
 */
export function ProxySection() {
  const { proxy } = usePrefs()
  const [host, setHost] = useState(proxy?.host ?? '')
  const [port, setPort] = useState(proxy ? String(proxy.port) : '')
  const [user, setUser] = useState(proxy?.user ?? '')
  const [password, setPassword] = useState(proxy?.password ?? '')
  const [message, setMessage] = useState<{ text: string; error: boolean }>()

  const save = () => {
    const number = Number(port.trim())
    if (!host.trim() || !(number > 0 && number < 65536 && number === Math.floor(number))) return setMessage({ text: t('proxy.invalid'), error: true })
    updatePrefs({ proxy: { host: host.trim(), port: number, user: user.trim() || undefined, password: user.trim() ? password : undefined } })
    setMessage({ text: t('proxy.saved'), error: false })
  }
  const remove = () => {
    updatePrefs({ proxy: undefined })
    setHost('')
    setPort('')
    setUser('')
    setPassword('')
    setMessage({ text: t('proxy.removed'), error: false })
    setFocus('proxy-host') // the Remove button goes away
  }

  return (
    <Region focusKey="settings-content" className="content form">
      <h2>{t('settings.proxy')}</h2>
      <p className="dim small">{t('proxy.intro')}</p>
      {!remuxSupport() && <p className="error small">{t('proxy.unsupported')}</p>}
      <TextField focusKey="proxy-host" label={t('proxy.host')} value={host} onChange={setHost} placeholder="203.0.113.10" />
      <TextField focusKey="proxy-port" label={t('proxy.port')} value={port} onChange={setPort} placeholder="1080" />
      <TextField focusKey="proxy-user" label={t('proxy.user')} value={user} onChange={setUser} />
      <TextField focusKey="proxy-password" label={t('proxy.password')} value={password} onChange={setPassword} type="password" />
      <div className="button-row">
        <Button focusKey="proxy-save" className="inline primary" onPress={save}>
          {t('proxy.save')}
        </Button>
        {proxy && (
          <Button focusKey="proxy-remove" className="inline" onPress={remove}>
            {t('proxy.remove')}
          </Button>
        )}
      </div>
      {message && <p className={message.error ? 'error' : 'dim'}>{message.text}</p>}
    </Region>
  )
}
