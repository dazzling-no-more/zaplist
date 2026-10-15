import type { Channel, Source } from './models'
import { normalizeHost } from './xtream'

const DAY = 24 * 3_600_000
/** How long programmes stay available when the playlist doesn't say. */
const DEFAULT_DAYS = 1

interface WallClock {
  Y: number
  m: number
  d: number
  H: number
  M: number
  S: number
}

/**
 * The date and time at `ms` on a clock in `zone`: 'utc', 'local' (the TV's), or an IANA time zone
 * (an Xtream server's; UTC if the TV doesn't know it). toLocaleString, not formatToParts, which
 * Chromium 53 (webOS 4) lacks.
 */
function wallClock(ms: number, zone: string): WallClock {
  const date = new Date(ms)
  if (zone === 'local') return { Y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate(), H: date.getHours(), M: date.getMinutes(), S: date.getSeconds() }
  if (zone !== 'utc') {
    try {
      const match = /(\d+)\/(\d+)\/(\d+),? (\d+):(\d+):(\d+) ?([AP]M)?/.exec(date.toLocaleString('en-US', { timeZone: zone }))
      if (match) {
        const hour = Number(match[4]) % 12 + (match[7] === 'PM' ? 12 : match[7] ? 0 : Number(match[4]) >= 12 ? 12 : 0)
        return { Y: Number(match[3]), m: Number(match[1]), d: Number(match[2]), H: hour, M: Number(match[5]), S: Number(match[6]) }
      }
    } catch {
      // unknown time zone: UTC
    }
  }
  return { Y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate(), H: date.getUTCHours(), M: date.getUTCMinutes(), S: date.getUTCSeconds() }
}

const pad = (n: number) => (n < 10 ? '0' : '') + n

/** `format` with its letters Y m d H M S replaced by the parts of `time` (Kodi's {utc:YmdHMS}). */
const formatClock = (time: WallClock, format: string) => format.replace(/[YmdHMS]/g, (part) => (part === 'Y' ? String(time.Y) : pad(time[part as keyof WallClock])))

/**
 * Fills a catch-up address template as Kodi's IPTV Simple does: {utc} / ${start}, {utcend} / ${end},
 * {lutc} / ${now} / ${timestamp} (seconds, or formatted with {utc:YmdHMS}), {duration}, {duration:60},
 * {offset:60}, and {Y} {m} {d} {H} {M} {S}, the start on the TV's clock.
 */
export function fillTemplate(template: string, start: number, stop: number, now: number): string {
  const seconds = (ms: number) => Math.floor(ms / 1000)
  const times: Record<string, number> = { utc: start, start, utcend: stop, end: stop, lutc: now, now, timestamp: now }
  const local = wallClock(start, 'local')
  return template.replace(/\$?\{(\w+)(?::([^}]*))?\}/g, (match, name: string, arg: string | undefined) => {
    if (name in times) return arg ? formatClock(wallClock(times[name], 'utc'), arg) : String(seconds(times[name]))
    if (name === 'duration') return String(Math.floor(seconds(stop - start) / (Number(arg) || 1)))
    if (name === 'offset') return String(Math.floor(seconds(now - start) / (Number(arg) || 1)))
    if (/^[YmdHMS]$/.test(name)) return formatClock(local, name)
    return match
  })
}

/** An Xtream server's timeshift addresses: the start in its time zone, the length in minutes. */
function timeshift(host: string, username: string, password: string, streamId: string, start: number, stop: number, timezone: string): string[] {
  const enc = encodeURIComponent
  const minutes = Math.max(1, Math.ceil((stop - start) / 60_000))
  const at = formatClock(wallClock(start, timezone), 'Y-m-d:H-M')
  return [
    `${host}/timeshift/${enc(username)}/${enc(password)}/${minutes}/${at}/${streamId}.ts`,
    `${host}/streaming/timeshift.php?username=${enc(username)}&password=${enc(password)}&stream=${streamId}&start=${at}&duration=${minutes}`,
  ]
}

/**
 * Stream addresses for what `channel` showed from `start` to `stop` (ms); undefined when its kind of
 * catch-up isn't supported. Xtream servers, and M3U catch-up of the kinds default, append, shift,
 * flussonic and xc.
 */
export function catchupUrls(channel: Channel, source: Source | undefined, start: number, stop: number, now = Date.now()): string[] | undefined {
  const catchup = channel.catchup
  if (!catchup) return undefined
  const url = channel.urls[0]
  const type = catchup.type.toLowerCase()
  if (source?.kind === 'xtream' && channel.streamId !== undefined) {
    return timeshift(normalizeHost(source.host), source.username, source.password, String(channel.streamId), start, stop, source.account?.timezone ?? 'utc')
  }
  if (type === 'xc') {
    // An Xtream server's M3U: http://host/live/user/password/123.ts (or without live/).
    const live = /^(https?:\/\/[^/]+)\/(?:live\/)?([^/]+)\/([^/]+)\/(\d+)(?:\.\w+)?$/.exec(url)
    return live ? timeshift(live[1], decodeURIComponent(live[2]), decodeURIComponent(live[3]), live[4], start, stop, 'utc') : undefined
  }
  if (type === 'default') return catchup.source ? [fillTemplate(catchup.source, start, stop, now)] : undefined
  if (type === 'append') return catchup.source ? [url + fillTemplate(catchup.source, start, stop, now)] : undefined
  if (type === 'shift' || type === 'timeshift') return [url + (url.indexOf('?') >= 0 ? '&' : '?') + fillTemplate('utc={utc}&lutc={lutc}', start, stop, now)]
  if (type === 'flussonic' || type === 'flussonic-hls' || type === 'flussonic-ts' || type === 'fs') {
    const parts = /^(.*\/)([^/?#]*)(\?[^#]*)?$/.exec(url)
    if (!parts) return undefined
    const [, dir, file, query = ''] = parts
    const from = Math.floor(start / 1000)
    if (/\.m3u8$/.test(file)) return [`${dir}${file.replace(/\.m3u8$/, '')}-${from}-${Math.floor((stop - start) / 1000)}.m3u8${query}`]
    if (file === 'mpegts' || type === 'flussonic-ts') return [`${dir}timeshift_abs-${from}.ts${query}`]
  }
  return undefined
}

/** The earliest start time of a programme that `channel` can show again, or undefined if it can't. */
export function replayableFrom(channel: Channel, source: Source | undefined, now: number): number | undefined {
  if (!channel.catchup || !catchupUrls(channel, source, now - 3_600_000, now, now)) return undefined
  return now - (channel.catchup.days || DEFAULT_DAYS) * DAY
}
