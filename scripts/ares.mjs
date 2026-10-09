// Runs the webOS CLI with the app ID and version from appinfo.json.
// Usage: node scripts/ares.mjs <package|install|launch|inspect>
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const { id, version } = JSON.parse(readFileSync(new URL('../appinfo.json', import.meta.url), 'utf8'))
const DEVICE = 'tv' // the name given to `ares-setup-device`

const commands = {
  package: `ares-package dist -o out`,
  install: `ares-install -d ${DEVICE} out/${id}_${version}_all.ipk`,
  launch: `ares-launch -d ${DEVICE} ${id}`,
  inspect: `ares-inspect -d ${DEVICE} --open ${id}`,
}

const command = commands[process.argv[2]]
if (!command) {
  console.error(`usage: node scripts/ares.mjs <${Object.keys(commands).join('|')}>`)
  process.exit(2)
}
console.log(`> ${command}`)
const { status } = spawnSync(command, { stdio: 'inherit', shell: true })
process.exit(status ?? 1)
