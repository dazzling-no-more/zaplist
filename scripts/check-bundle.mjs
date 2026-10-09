// Fails the build when dist/ contains something Chromium 53 (webOS TV 4.x) can't run from file://:
// syntax newer than ES2016, regular expressions using ES2018+ features, module scripts,
// `crossorigin` attributes, or root-absolute asset paths.
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parse } from 'acorn'
import { simple } from 'acorn-walk'

const DIST = 'dist'
const ECMA = 2016 // Chromium 53 has full ES2016 syntax and nothing from ES2017 (async, trailing commas in calls).

const problems = []
const files = readdirSync(DIST, { recursive: true }).map((f) => join(DIST, String(f)))

for (const file of files.filter((f) => f.endsWith('.js'))) {
  const code = readFileSync(file, 'utf8')
  let ast
  try {
    ast = parse(code, { ecmaVersion: ECMA, sourceType: 'script' })
  } catch (e) {
    problems.push(`${file}: ${e.message} near ${JSON.stringify(code.slice(e.pos - 40, e.pos + 40))}`)
    continue
  }
  // esbuild turns regex literals it can't lower into `new RegExp("...")`, which only fails at runtime.
  const checkRegExp = (node) => {
    const [pattern, flags] = node.arguments
    if (node.callee.type !== 'Identifier' || node.callee.name !== 'RegExp') return
    if (pattern?.type !== 'Literal' || typeof pattern.value !== 'string') return
    const flagText = flags?.type === 'Literal' && typeof flags.value === 'string' ? flags.value : ''
    try {
      const source = pattern.value.replace(/(\\.)|\//g, (_, escape) => escape ?? '\\/') // escape bare slashes
      parse(`/${source}/${flagText}`, { ecmaVersion: ECMA })
    } catch (e) {
      problems.push(`${file}: RegExp ${JSON.stringify(pattern.value)} needs a newer engine (${e.message})`)
    }
  }
  simple(ast, { NewExpression: checkRegExp, CallExpression: checkRegExp })
}

for (const file of files.filter((f) => f.endsWith('.html'))) {
  const html = readFileSync(file, 'utf8')
  if (/type="module"/.test(html)) problems.push(`${file}: contains a module script`)
  if (/\scrossorigin[\s>=]/.test(html)) problems.push(`${file}: contains a crossorigin attribute`)
  for (const [, url] of html.matchAll(/\s(?:src|href)="([^"]*)"/g)) {
    if (/^(\/|[a-z]+:)/i.test(url)) problems.push(`${file}: non-relative URL ${url}`)
  }
}

if (problems.length) {
  console.error(`check-bundle: ${problems.length} problem(s) in ${DIST}/`)
  for (const p of problems) console.error('  ' + p)
  process.exit(1)
}
const scripts = files.filter((f) => f.endsWith('.js')).map((f) => relative(DIST, f))
console.log(`check-bundle: OK (ES${ECMA} syntax, classic scripts, relative URLs) - ${scripts.join(', ')}`)
