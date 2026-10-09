import { useMemo, useState } from 'react'
import { library, useLibrary } from '../data/library'
import type { Source } from '../data/models'
import { t } from '../i18n'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { describeError, describeProgress, formatCount, formatDate } from '../ui/format'
import { navigate, useScreenFocus, type ScreenProps } from '../ui/navigation'
import { Region } from '../ui/Region'

const SECTIONS = ['sources', 'guide', 'parental', 'about'] as const
type Section = (typeof SECTIONS)[number]

export function SettingsScreen({ entry }: ScreenProps<'settings'>) {
  const [section, setSection] = useState<Section>((entry.memo.section as Section) ?? 'sources')
  useScreenFocus(entry, `settings-${section}`)

  const select = (s: Section) => {
    entry.memo.section = s
    setSection(s)
  }

  return (
    <div className="screen">
      <Region focusKey="settings-menu" className="sidebar">
        <h1>{t('settings.title')}</h1>
        {SECTIONS.map((s) => (
          <Button key={s} focusKey={`settings-${s}`} selected={s === section} onPress={() => select(s)} onFocus={() => select(s)}>
            {t(`settings.${s}`)}
          </Button>
        ))}
      </Region>
      {section === 'sources' ? (
        <SourcesSection />
      ) : (
        <div className="content">
          <h2>{t(`settings.${section}`)}</h2>
          <p className="dim">{t('settings.notAvailable')}</p>
        </div>
      )}
    </div>
  )
}

function SourcesSection() {
  const { sources, channels, progress } = useLibrary()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [deleting, setDeleting] = useState<Source>()
  const counts = useMemo(() => {
    const result: Record<string, number> = {}
    for (const channel of channels) result[channel.sourceId] = (result[channel.sourceId] ?? 0) + 1
    return result
  }, [channels])

  const refresh = (source: Source) => {
    setErrors(({ [source.id]: _, ...rest }) => rest)
    library.refresh(source.id).catch((error) => setErrors((e) => ({ ...e, [source.id]: describeError(error) })))
  }

  return (
    <Region focusKey="settings-content" className="content">
      <h2>{t('settings.sources')}</h2>
      {!sources.length && <p className="dim">{t('sources.none')}</p>}
      <div className="rows">
        {sources.map((source) => {
          const busy = progress[source.id]
          const details = [
            t(source.kind === 'm3u' ? 'sources.m3u' : 'sources.xtream'),
            t('sources.channels', { count: formatCount(counts[source.id] ?? 0) }),
            source.refreshedAt ? t('sources.updated', { date: formatDate(source.refreshedAt) }) : '',
          ]
          const account = source.kind === 'xtream' ? source.account : undefined
          return (
            <Region key={source.id} focusKey={`source-row-${source.id}`} className="row">
              <div className="row-text">
                <div className="row-title">{source.name}</div>
                <div className="dim small">{details.filter(Boolean).join(' · ')}</div>
                {account && (
                  <div className="dim small">
                    {account.expiresAt ? t('sources.expires', { date: formatDate(account.expiresAt) }) : t('sources.noExpiry')}
                    {account.maxConnections ? ' · ' + t('sources.connections', { count: account.maxConnections }) : ''}
                  </div>
                )}
                {busy && <div className="small">{describeProgress(busy)}</div>}
                {errors[source.id] && <div className="error small">{errors[source.id]}</div>}
              </div>
              <div className="row-actions">
                <Button onPress={() => refresh(source)}>{t('sources.refresh')}</Button>
                <Button onPress={() => navigate({ name: 'sourceEdit', sourceId: source.id })}>{t('sources.edit')}</Button>
                <Button onPress={() => setDeleting(source)}>{t('sources.delete')}</Button>
              </div>
            </Region>
          )
        })}
      </div>
      <Button focusKey="sources-add" className="inline" onPress={() => navigate({ name: 'sourceEdit' })}>
        {t('sources.add')}
      </Button>
      {deleting && (
        <Dialog
          title={t('sources.deleteTitle', { name: deleting.name })}
          message={t('sources.deleteMessage')}
          buttons={[
            {
              label: t('sources.delete'),
              onPress: () => {
                setDeleting(undefined)
                library.remove(deleting.id)
              },
            },
            { label: t('common.cancel'), onPress: () => setDeleting(undefined) },
          ]}
          initialFocus={1}
          onCancel={() => setDeleting(undefined)}
        />
      )}
    </Region>
  )
}
