// Streaming XMLTV parser: feed text in chunks of any size; it never builds a DOM, so a 100 MB guide
// costs only the programmes kept. Tolerates comments, CDATA, processing instructions and doctypes.

export interface XmltvChannel {
  id: string
  names: string[]
}

export interface XmltvProgramme {
  channel: string
  /** Epoch ms. */
  start: number
  stop: number
  title: string
  description?: string
}

export interface XmltvHandlers {
  channel(channel: XmltvChannel): void
  programme(programme: XmltvProgramme): void
}

/**
 * XMLTV time `YYYYMMDDhhmmss ±hhmm` (seconds and offset optional; no offset means UTC) to epoch ms.
 */
export function parseXmltvTime(value: string): number | undefined {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*(?:([+-])(\d{2}):?(\d{2})|Z|UTC|GMT)?/i.exec(value.trim())
  if (!match) return undefined
  const [, y, mo, d, h, mi, s, sign, oh, om] = match
  const utc = Date.UTC(+y, +mo - 1, +d, +h, +mi, s ? +s : 0)
  const offset = sign ? (sign === '-' ? -1 : 1) * (+oh * 60 + +om) * 60_000 : 0
  return utc - offset
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

export function decodeEntities(text: string): string {
  if (text.indexOf('&') < 0) return text
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, entity: string) => {
    if (entity[0] !== '#') return ENTITIES[entity.toLowerCase()] ?? match
    const code = entity[1] === 'x' || entity[1] === 'X' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10)
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
  })
}

const ATTRIBUTE = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

function attributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  ATTRIBUTE.lastIndex = 0
  for (let m = ATTRIBUTE.exec(tag); m; m = ATTRIBUTE.exec(tag)) attrs[m[1]] = decodeEntities(m[2] ?? m[3])
  return attrs
}

/** Text elements whose content we keep, and where it goes. */
type Capture = 'display-name' | 'title' | 'desc'

export class XmltvParser {
  private buffer = ''
  private channel: XmltvChannel | undefined
  private programme: { channel: string; start?: number; stop?: number; title?: string; description?: string } | undefined
  private capture: Capture | undefined
  private text = ''

  constructor(private readonly handlers: XmltvHandlers) {}

  feed(chunk: string): void {
    const buffer = this.buffer + chunk
    let pos = 0
    for (;;) {
      const lt = buffer.indexOf('<', pos)
      if (lt < 0) {
        this.addText(buffer.slice(pos))
        pos = buffer.length
        break
      }
      if (lt > pos) this.addText(buffer.slice(pos, lt))
      const end = this.tagEnd(buffer, lt)
      if (end < 0) {
        pos = lt // incomplete tag: wait for more data
        break
      }
      this.tag(buffer, lt, end)
      pos = end + 1
    }
    this.buffer = buffer.slice(pos)
  }

  end(): void {
    this.buffer = ''
  }

  /** Index of the '>' closing the markup that starts at `lt`, or -1 if it isn't complete yet. */
  private tagEnd(buffer: string, lt: number): number {
    if (buffer.startsWith('<!--', lt)) {
      const close = buffer.indexOf('-->', lt + 4)
      return close < 0 ? -1 : close + 2
    }
    if (buffer.startsWith('<![CDATA[', lt)) {
      const close = buffer.indexOf(']]>', lt + 9)
      return close < 0 ? -1 : close + 2
    }
    // A '>' inside a quoted attribute value doesn't end the tag.
    let quote = ''
    for (let i = lt + 1; i < buffer.length; i++) {
      const c = buffer[i]
      if (quote) {
        if (c === quote) quote = ''
      } else if (c === '"' || c === "'") quote = c
      else if (c === '>') return i
    }
    return -1
  }

  private addText(text: string): void {
    if (this.capture) this.text += text
  }

  private tag(buffer: string, lt: number, end: number): void {
    const second = buffer[lt + 1]
    if (second === '!') {
      if (buffer.startsWith('<![CDATA[', lt) && this.capture) this.text += buffer.slice(lt + 9, end - 2)
      return
    }
    if (second === '?') return
    const closing = second === '/'
    const tag = buffer.slice(lt + (closing ? 2 : 1), end)
    const nameEnd = tag.search(/[\s/>]|$/)
    const name = tag.slice(0, nameEnd)
    const selfClosing = tag[tag.length - 1] === '/'
    if (closing) this.close(name)
    else this.open(name, tag, selfClosing)
  }

  private open(name: string, tag: string, selfClosing: boolean): void {
    if (name === 'channel' && !this.programme) {
      this.channel = { id: attributes(tag).id ?? '', names: [] }
      if (selfClosing) this.close('channel')
    } else if (name === 'programme') {
      const attrs = attributes(tag)
      this.programme = { channel: attrs.channel ?? '', start: parseXmltvTime(attrs.start ?? ''), stop: parseXmltvTime(attrs.stop ?? '') }
      if (selfClosing) this.close('programme')
    } else if (!selfClosing && (name === 'display-name' || name === 'title' || name === 'desc')) {
      this.capture = name
      this.text = ''
    }
  }

  private close(name: string): void {
    if (name === this.capture) {
      const text = decodeEntities(this.text.trim())
      if (name === 'display-name' && this.channel && text) this.channel.names.push(text)
      else if (name === 'title' && this.programme && this.programme.title === undefined) this.programme.title = text
      else if (name === 'desc' && this.programme && this.programme.description === undefined) this.programme.description = text
      this.capture = undefined
      this.text = ''
    } else if (name === 'channel' && this.channel) {
      if (this.channel.id) this.handlers.channel(this.channel)
      this.channel = undefined
    } else if (name === 'programme' && this.programme) {
      const p = this.programme
      this.programme = undefined
      if (p.start === undefined) return
      // A missing stop is filled in later from the next programme's start.
      this.handlers.programme({ channel: p.channel, start: p.start, stop: p.stop ?? p.start, title: p.title ?? '', description: p.description || undefined })
    }
  }
}
