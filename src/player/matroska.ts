import { child, children, ID, readId, readVint, trackLanguage, uint, UNKNOWN } from './ebml'

export interface MovieTrack {
  number: number
  /** ebml.ts TRACK_VIDEO, TRACK_AUDIO, TRACK_SUBTITLE */
  type: number
  codec: string
  /** May be empty. */
  name: string
  /** ebml.ts trackLanguage */
  language: string
  default: boolean
}

/** A track's label in the audio and subtitle menus: its language and name, else its place in the list. */
export function trackLabel(track: { name: string; language: string; codec: string }, index: number): string {
  const label = [track.language === 'und' ? '' : track.language, track.name].filter(Boolean).join(' · ') || `${index + 1}`
  return track.codec === 'S_HDMV/PGS' && !/pgs/i.test(label) ? `${label} (PGS)` : label
}

const text = (data: Uint8Array | undefined) => (data ? new TextDecoder().decode(data).replace(/\0+$/, '') : '')

/** The track list at the start of a Matroska file; undefined if `head` doesn't hold all of it. */
export function readTracks(head: Uint8Array): MovieTrack[] | undefined {
  for (let pos = 0; ; ) {
    const id = readId(head, pos)
    const size = id && readVint(head, pos + id[1])
    if (!id || !size) return undefined
    const start = pos + id[1] + size[1]
    if (id[0] === ID.Segment) {
      pos = start // the tracks are inside
      continue
    }
    if (id[0] === ID.Cluster || size[0] === UNKNOWN) return undefined
    if (id[0] === ID.Tracks) {
      if (start + size[0] > head.length) return undefined
      return children(head.subarray(start, start + size[0]))
        .filter((e) => e.id === ID.TrackEntry)
        .map(({ data }) => ({
          number: uint(child(data, ID.TrackNumber)),
          type: uint(child(data, ID.TrackType)),
          codec: text(child(data, ID.CodecID)),
          name: text(child(data, ID.Name)),
          language: trackLanguage(data, text),
          default: uint(child(data, ID.FlagDefault), 1) === 1,
        }))
    }
    pos = start + size[0]
  }
}
