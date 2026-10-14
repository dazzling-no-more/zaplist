import { useMemo, useRef, useState, type WheelEvent } from 'react'
import { guide } from '../../data/guide'
import { library, useLibrary } from '../../data/library'
import type { Source } from '../../data/models'
import { t } from '../../i18n'
import { Button } from '../../ui/Button'
import { Dialog } from '../../ui/Dialog'
import { describeError, describeProgress, formatCount, formatDate } from '../../ui/format'
import { navigate } from '../../ui/navigation'
import { Region } from '../../ui/Region'
import { revealChild } from '../../ui/scroll'

export function SourcesSection() {
  const { sources, channels, movies, series, progress } = useLibrary()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [deleting, setDeleting] = useState<Source>()
  const counts = useMemo(() => {
    const result: Record<string, { channels: number; movies: number; series: number }> = {}
    const count = (sourceId: string) => (result[sourceId] ??= { channels: 0, movies: 0, series: 0 })
    for (const channel of channels) count(channel.sourceId).channels++
    for (const movie of movies) count(movie.sourceId).movies++
    for (const show of series) count(show.sourceId).series++
    return result
  }, [channels, movies, series])

  // The list scrolls inside a fixed height so "Add a source" stays on screen however many there are.
  const list = useRef<HTMLDivElement>(null)
  const reveal = (sourceId: string) => {
    const row = list.current?.querySelector<HTMLElement>(`[data-source="${sourceId}"]`)
    if (list.current && row) revealChild(list.current, row)
  }
  const scroll = (event: WheelEvent) => {
    if (list.current) list.current.scrollTop += event.deltaY > 0 ? 124 : -124
  }

  const refresh = (source: Source) => {
    setErrors(({ [source.id]: _, ...rest }) => rest)
    library
      .refresh(source.id)
      .then(() => guide.refresh())
      .catch((error) => setErrors((e) => ({ ...e, [source.id]: describeError(error) })))
  }

  return (
    <Region focusKey="settings-content" className="content">
      <h2>{t('settings.sources')}</h2>
      {!sources.length && <p className="dim">{t('sources.none')}</p>}
      <div ref={list} className="rows source-list" onWheel={scroll}>
        {sources.map((source) => {
          const busy = progress[source.id]
          const details = [
            t(source.kind === 'm3u' ? 'sources.m3u' : 'sources.xtream'),
            t('sources.channels', { count: formatCount(counts[source.id]?.channels ?? 0) }),
            counts[source.id]?.movies ? t('sources.movies', { count: formatCount(counts[source.id].movies) }) : '',
            counts[source.id]?.series ? t('sources.series', { count: formatCount(counts[source.id].series) }) : '',
            source.refreshedAt ? t('sources.updated', { date: formatDate(source.refreshedAt) }) : '',
          ]
          const account = source.kind === 'xtream' ? source.account : undefined
          return (
            <div key={source.id} data-source={source.id}>
              <Region focusKey={`source-row-${source.id}`} className="row">
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
                  <Button onFocus={() => reveal(source.id)} onPress={() => refresh(source)}>
                    {t('sources.refresh')}
                  </Button>
                  <Button onFocus={() => reveal(source.id)} onPress={() => navigate({ name: 'sourceEdit', sourceId: source.id })}>
                    {t('sources.edit')}
                  </Button>
                  <Button onFocus={() => reveal(source.id)} onPress={() => setDeleting(source)}>
                    {t('sources.delete')}
                  </Button>
                </div>
              </Region>
            </div>
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
                library.remove(deleting.id).catch(() => setErrors((e) => ({ ...e, [deleting.id]: t('sources.deleteFailed') })))
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
