// Runs the webOS CLI with the app ID and version from appinfo.json.
// Usage: node scripts/ares.mjs <package|install|launch|inspect>
import { copyFileSync, cpSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const { id, version } = JSON.parse(readFileSync(new URL('../appinfo.json', import.meta.url), 'utf8'))
const DEVICE = 'tv' // the name given to `ares-setup-device`
const IPK = `${id}_${version}_all.ipk`
// Seller Lounge recommends a 1920x1080 package for UHD TVs and a 1280x720 one for Full HD TVs. The
// second is the same app (it scales itself to its window), declared at 1280x720 with a splash to match.
const HD = { dir: 'out/dist-1280x720', splash: 'store/art/splash-1280x720.png', ipk: `out/${id}_${version}_all_1280x720.ipk` }

function run(command) {
  console.log(`> ${command}`)
  const { status } = spawnSync(command, { stdio: 'inherit', shell: true })
  if (status !== 0) process.exit(status ?? 1)
}

// Each package carries the app (dist/) and its JS service (dist-service/, see service/main.ts).
function packageBoth() {
  run('ares-package dist dist-service -o out')
  rmSync(HD.dir, { recursive: true, force: true })
  cpSync('dist', HD.dir, { recursive: true })
  const appinfo = JSON.parse(readFileSync(`${HD.dir}/appinfo.json`, 'utf8'))
  writeFileSync(`${HD.dir}/appinfo.json`, JSON.stringify({ ...appinfo, resolution: '1280x720' }, null, 2))
  copyFileSync(HD.splash, `${HD.dir}/splash.png`)
  run(`ares-package ${HD.dir} dist-service -o ${HD.dir}-ipk`)
  renameSync(`${HD.dir}-ipk/${IPK}`, HD.ipk)
  rmSync(HD.dir, { recursive: true })
  rmSync(`${HD.dir}-ipk`, { recursive: true })
  console.log(`Packages: out/${IPK} (1920x1080), ${HD.ipk} (1280x720)`)
}

const commands = {
  package: packageBoth,
  install: () => run(`ares-install -d ${DEVICE} out/${IPK}`),
  launch: () => run(`ares-launch -d ${DEVICE} ${id}`),
  inspect: () => run(`ares-inspect -d ${DEVICE} --open ${id}`),
}

const command = commands[process.argv[2]]
if (!command) {
  console.error(`usage: node scripts/ares.mjs <${Object.keys(commands).join('|')}>`)
  process.exit(2)
}
command()
