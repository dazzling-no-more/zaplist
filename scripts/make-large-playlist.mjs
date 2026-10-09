// Writes tests/fixtures/large.m3u: a synthetic playlist for scale testing in the dev server.
// Usage: node scripts/make-large-playlist.mjs [count=50000]
// Then add http://localhost:5173/tests/fixtures/large.m3u as a source (the dev server serves it).
import { writeFileSync } from 'node:fs'

const count = Number(process.argv[2] ?? 50_000)
const lines = ['#EXTM3U']
for (let i = 1; i <= count; i++) {
  const group = `Group ${String((i % 250) + 1).padStart(3, '0')}`
  lines.push(`#EXTINF:-1 tvg-id="ch${i}.test" tvg-name="Channel ${i}" tvg-chno="${i}" group-title="${group}",Channel ${i}`)
  lines.push(`http://example.com/live/${i}.m3u8`)
}
writeFileSync(new URL('../tests/fixtures/large.m3u', import.meta.url), lines.join('\n') + '\n')
console.log(`wrote ${count} entries to tests/fixtures/large.m3u`)
