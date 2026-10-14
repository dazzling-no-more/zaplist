import { useRef, type WheelEvent } from 'react'
import { t } from '../i18n'
import type { Engine } from '../player/streams'
import { Button } from './Button'
import { Dialog } from './Dialog'
import { revealChild } from './scroll'

/** Audio or subtitle track choice for the stream playing now (live channels, movies, episodes). */
export function TrackDialog({ kind, engine, onClose }: { kind: 'audio' | 'subtitles'; engine?: Engine; onClose: () => void }) {
  const tracks = engine ? (kind === 'audio' ? engine.audioTracks() : engine.subtitleTracks()) : []
  const selected = engine ? (kind === 'audio' ? engine.selectedAudio() : engine.selectedSubtitle()) : -1
  const select = (id: number) => {
    if (kind === 'audio') engine?.setAudioTrack(id)
    else engine?.setSubtitleTrack(id)
    onClose()
  }
  const options = kind === 'subtitles' && tracks.length ? [{ id: -1, label: t('player.subtitlesOff') }, ...tracks] : tracks
  // Long track lists scroll inside the dialog, which stays on screen.
  const list = useRef<HTMLDivElement>(null)
  const reveal = (i: number) => {
    const option = list.current?.children[i]
    if (list.current && option) revealChild(list.current, option as HTMLElement)
  }
  const scroll = (event: WheelEvent) => {
    if (list.current) list.current.scrollTop += event.deltaY > 0 ? 86 : -86
  }
  return (
    <Dialog
      title={t(kind === 'audio' ? 'player.audio' : 'player.subtitles')}
      message={options.length ? undefined : t(kind === 'audio' ? 'player.noAudioTracks' : 'player.noSubtitles')}
      buttons={options.length ? [] : [{ label: t('common.ok'), onPress: onClose }]}
      initialFocus={options.length ? `track-${Math.max(0, options.findIndex((o) => o.id === selected))}` : 0}
      onCancel={onClose}
    >
      {options.length > 0 && (
        <div ref={list} className="dialog-options" onWheel={scroll}>
          {options.map((option, i) => (
            <Button key={option.id} focusKey={`track-${i}`} selected={option.id === selected} onFocus={() => reveal(i)} onPress={() => select(option.id)}>
              {option.label}
            </Button>
          ))}
        </div>
      )}
    </Dialog>
  )
}
