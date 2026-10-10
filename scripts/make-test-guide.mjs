// Writes store/test-guide.xml.gz: TV guide data for the channels in store/test-playlist.m3u, so LG's
// testers can try the guide. It covers [today - 1 day, today + days]; run it again before each
// submission. Usage: node scripts/make-test-guide.mjs [days=183]
import { writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

const DAYS = Number(process.argv[2] ?? 183)
const HOUR = 3_600_000
const out = new URL('../store/test-guide.xml.gz', import.meta.url)

// tvg-id → programme titles, cycled. The ids match store/test-playlist.m3u.
const CHANNELS = {
  'bbb.zaplist': ['Big Buck Bunny', 'Animation Hour', 'Sketchbook', 'Studio Stories'],
  'tos.zaplist': ['Tears of Steel', 'Film Club', 'Behind the Scenes', 'Short Film Night'],
  'angel.zaplist': ['Angel One', 'Language Corner', 'World Stories', 'Evening Drama'],
  'bipbop.zaplist': ['Test Pattern', 'Audio and Subtitle Test', 'Colour Bars', 'Tone Check'],
  'ts.zaplist': ['MPEG-TS Test', 'Signal Check', 'Loop Test', 'Night Test'],
}

const pad = (n) => String(n).padStart(2, '0')
const xmltvTime = (ms) => {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00 +0000`
}
const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;')

const start = Math.floor(Date.now() / (24 * HOUR)) * 24 * HOUR - 24 * HOUR
const end = start + (DAYS + 1) * 24 * HOUR
let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="Zaplist test guide">\n'
for (const id of Object.keys(CHANNELS)) xml += `<channel id="${id}"><display-name>${id}</display-name></channel>\n`
let programmes = 0
Object.entries(CHANNELS).forEach(([id, titles], n) => {
  // 30, 60 or 90 minutes in a fixed pattern, offset per channel so the grid isn't uniform.
  for (let t = start, i = n; t < end; i++) {
    const length = (1 + ((i * 7 + n) % 3)) * HOUR / 2
    const title = titles[i % titles.length]
    xml += `<programme start="${xmltvTime(t)}" stop="${xmltvTime(t + length)}" channel="${id}"><title>${escape(title)}</title><desc>Test programme.</desc></programme>\n`
    t += length
    programmes++
  }
})
xml += '</tv>\n'

const data = gzipSync(xml, { level: 9 })
writeFileSync(out, data)
console.log(`wrote ${out.pathname}: ${programmes} programmes, ${new Date(start).toISOString().slice(0, 10)} to ${new Date(end).toISOString().slice(0, 10)}, ${Math.round(data.length / 1024)} KB gzipped (${Math.round(xml.length / 1024)} KB XML)`)
