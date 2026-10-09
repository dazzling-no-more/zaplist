import { useMemo, useState } from 'react'
import { guide } from '../data/guide'
import { library, newSourceId, useLibrary } from '../data/library'
import type { Source } from '../data/models'
import { normalizeHost } from '../data/xtream'
import { t, type StringKey } from '../i18n'
import { Button } from '../ui/Button'
import { describeError, describeProgress, formatCount } from '../ui/format'
import { backStack, useScreenFocus, type ScreenProps } from '../ui/navigation'
import { Region } from '../ui/Region'
import { TextField } from '../ui/TextField'

type Kind = Source['kind']

function hostname(url: string): string {
  const match = /^[a-z]+:\/\/([^/:?#]+)/i.exec(url.trim())
  return match ? match[1] : url.trim()
}

/** Add or edit a source. Saving downloads the playlist first, so only working sources are stored. */
export function SourceEditScreen({ entry }: ScreenProps<'sourceEdit'>) {
  const { sources, progress } = useLibrary()
  const existing = sources.find((s) => s.id === entry.sourceId)
  const id = useMemo(() => existing?.id ?? newSourceId(), [])
  const [kind, setKind] = useState<Kind>(existing?.kind ?? 'm3u')
  const [name, setName] = useState(existing?.name ?? '')
  const [url, setUrl] = useState(existing?.kind === 'm3u' ? existing.url : '')
  const [host, setHost] = useState(existing?.kind === 'xtream' ? existing.host : '')
  const [username, setUsername] = useState(existing?.kind === 'xtream' ? existing.username : '')
  const [password, setPassword] = useState(existing?.kind === 'xtream' ? existing.password : '')
  const [epgUrl, setEpgUrl] = useState(existing?.epgUrl ?? '')
  const [message, setMessage] = useState<{ text: string; error: boolean }>()
  const saving = progress[id]
  useScreenFocus(entry, existing ? 'source-name' : 'source-m3u')

  const missing = (): StringKey | undefined => {
    if (kind === 'm3u') return url.trim() ? undefined : 'source.url'
    if (!host.trim()) return 'source.host'
    if (!username.trim()) return 'source.username'
    return password ? undefined : 'source.password'
  }

  const save = async () => {
    if (saving) return
    const field = missing()
    if (field) return setMessage({ text: t('source.required', { field: t(field) }), error: true })
    const base = {
      id,
      name: name.trim() || hostname(kind === 'm3u' ? url : normalizeHost(host)),
      epgUrl: epgUrl.trim() || undefined,
      addedAt: existing?.addedAt ?? Date.now(),
    }
    const source: Source =
      kind === 'm3u'
        ? { ...base, kind, url: url.trim() }
        : { ...base, kind, host: normalizeHost(host), username: username.trim(), password }
    setMessage(undefined)
    try {
      await library.save(source)
      void guide.refresh()
      backStack.pop()
    } catch (error) {
      setMessage({ text: describeError(error), error: true })
    }
  }

  const status = saving ? { text: describeProgress(saving), error: false } : message
  const count = useMemo(() => library.getState().channels.filter((c) => c.sourceId === id).length, [sources])

  return (
    <div className="screen">
      <div className="sidebar">
        <h1>{t(existing ? 'source.editTitle' : 'source.addTitle')}</h1>
        {existing && <p className="dim">{t('sources.channels', { count: formatCount(count) })}</p>}
      </div>
      <Region focusKey="source-form" className="content form">
        <div className="segmented">
          <Button focusKey="source-m3u" selected={kind === 'm3u'} onPress={() => setKind('m3u')}>
            {t('sources.m3u')}
          </Button>
          <Button focusKey="source-xtream" selected={kind === 'xtream'} onPress={() => setKind('xtream')}>
            {t('sources.xtream')}
          </Button>
        </div>
        <TextField focusKey="source-name" label={t('source.name')} value={name} onChange={setName} placeholder={t('source.namePlaceholder')} />
        {kind === 'm3u' ? (
          <TextField focusKey="source-url" label={t('source.url')} value={url} onChange={setUrl} type="url" placeholder="http://" />
        ) : (
          <>
            <TextField focusKey="source-host" label={t('source.host')} value={host} onChange={setHost} type="url" placeholder="http://host:port" />
            <TextField focusKey="source-username" label={t('source.username')} value={username} onChange={setUsername} />
            <TextField focusKey="source-password" label={t('source.password')} value={password} onChange={setPassword} type="password" />
          </>
        )}
        <TextField focusKey="source-epg" label={t('source.epgUrl')} value={epgUrl} onChange={setEpgUrl} type="url" placeholder="http://" />
        <Button focusKey="source-save" className="inline primary" onPress={save}>
          {t('source.save')}
        </Button>
        {status && <p className={status.error ? 'error' : 'dim'}>{status.text}</p>}
      </Region>
    </div>
  )
}
