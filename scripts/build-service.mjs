// Bundles the app's JS service (service/) into dist-service/, which scripts/ares.mjs packages next to
// dist/. webOS TV 5 and 6 run services on Node.js 8: the bundle is lowered to it and kept free of
// what it lacks. opus-decoder stays at 0.7.1, the last release whose WebAssembly Node 8 can compile.
import { copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { build } from 'esbuild'

const OUT = 'dist-service'
const { id } = JSON.parse(readFileSync('appinfo.json', 'utf8'))
const name = `${id}.service` // webOS requires the app ID as prefix
const description = 'Plays movies whose audio the TV cannot decode'

rmSync(OUT, { recursive: true, force: true })
await build({
  entryPoints: ['service/main.ts'],
  outfile: `${OUT}/service.js`,
  bundle: true,
  platform: 'node',
  target: 'node8',
  format: 'cjs',
  external: ['webos-service'],
  define: { SERVICE_ID: JSON.stringify(name) },
  alias: { '@eshaz/web-worker': './service/no-worker.ts' },
  banner: { js: "if (typeof globalThis === 'undefined') global.globalThis = global;" },
  logLevel: 'warning',
})
writeFileSync(`${OUT}/package.json`, JSON.stringify({ name, main: 'service.js' }, null, 2) + '\n')
writeFileSync(`${OUT}/services.json`, JSON.stringify({ id: name, description, services: [{ name, description }] }, null, 2) + '\n')
copyFileSync('service/THIRD-PARTY-LICENSES.txt', `${OUT}/THIRD-PARTY-LICENSES.txt`)
