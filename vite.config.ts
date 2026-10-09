import { readFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import { createRequire } from 'node:module'
import react from '@vitejs/plugin-react'
import compat from 'core-js-compat'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

// Oldest engine we ship to: webOS TV 4.x runs Chromium 53.
const TARGET = 'chrome53'

/**
 * Built-ins newer than ES2022 that aren't polyfilled. The app's TypeScript lib is ES2022, so its code
 * can't call them, and hls.js / mpegts.js ship prebuilt for older browsers. Saves ~55 KB per bundle.
 */
const POLYFILLS_NOT_NEEDED = [
  /^es\.(async-)?iterator\./,
  /^es\.(async-)?disposable-stack\./,
  /^es\.suppressed-error\./,
  /^es\.symbol\.(async-)?dispose$/,
  /^es\.uint8-array\./,
  /^es\.set\.(union|intersection|difference|symmetric-difference|is-subset-of|is-superset-of|is-disjoint-from)/,
  /^es\.(map|object)\.group-by$/,
  /^es\.(weak-)?map\.get-or-insert/,
  /^es\.array\.from-async$/,
  /^es\.promise\.(try|with-resolvers)$/,
  /^es\.math\.(f16round|sum-precise)$/,
  /^es\.regexp\.escape$/,
  /^es\.json\.(raw-json|is-raw-json)$/,
  /^es\.array-buffer\.(transfer|transfer-to-fixed-length|detached)$/,
  /^es\.error\.is-error$/,
  /^es\.string\.(is|to)-well-formed$/,
  /^es\.(array|typed-array)\.(find-last|find-last-index|to-reversed|to-sorted|to-spliced|with)$/,
  /^es\.data-view\.(get|set)-float16$/,
  /^web\.structured-clone$/,
  /^web\.url\.(can-parse|parse)$/,
]

/**
 * `virtual:core-js` imports the core-js modules Chromium 53 lacks (what Babel's
 * `useBuiltIns: "entry"` would emit), minus POLYFILLS_NOT_NEEDED. The dev server runs in a modern
 * desktop browser, so it gets none.
 */
function coreJsPolyfills(build: boolean): Plugin {
  const id = 'virtual:core-js'
  return {
    name: 'core-js-polyfills',
    resolveId: (source) => (source === id ? '\0' + id : undefined),
    load(resolved) {
      if (resolved !== '\0' + id) return
      if (!build) return ''
      const version = createRequire(import.meta.url)('core-js/package.json').version as string
      const { list } = compat({ targets: { chrome: '53' }, modules: ['core-js/stable'], exclude: POLYFILLS_NOT_NEEDED, version })
      return list.map((name) => `import 'core-js/modules/${name}.js';`).join('\n')
    },
  }
}

/**
 * Ships hls.js and mpegts.js as separate scripts with their licenses; src/player/vendor.ts loads them
 * only when native playback fails. Their prebuilt dist files already run on Chromium 53.
 */
function vendorScripts(): Plugin {
  const files: Record<string, string> = {
    'vendor/hls.js': 'node_modules/hls.js/dist/hls.min.js',
    'vendor/hls.js.LICENSE.txt': 'node_modules/hls.js/LICENSE',
    'vendor/mpegts.js': 'node_modules/mpegts.js/dist/mpegts.js',
    'vendor/mpegts.js.LICENSE.txt': 'node_modules/mpegts.js/LICENSE',
  }
  return {
    name: 'vendor-scripts',
    apply: 'build',
    generateBundle() {
      for (const [fileName, path] of Object.entries(files)) this.emitFile({ type: 'asset', fileName, source: readFileSync(path) })
    },
  }
}

/**
 * Packaged webOS apps load from file://, where module scripts and `crossorigin` requests fail.
 * The bundle is a single IIFE, so the entry tag can become a plain deferred script.
 */
function classicScripts(): Plugin {
  return {
    name: 'classic-scripts',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html) => html.replace(/<script type="module"/g, '<script defer').replace(/ crossorigin(?=[\s>])/g, ''),
    },
  }
}

/**
 * `/__proxy/<scheme>/<host>/<path>` on the dev server fetches `<scheme>://<host>/<path>`. The TV lets
 * packaged apps fetch any origin, but desktop browsers enforce CORS; src/data/http.ts routes requests
 * through here in dev builds.
 */
function devProxy(): Plugin {
  const forwarded = ['content-type', 'content-range', 'accept-ranges', 'last-modified']
  return {
    name: 'dev-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__proxy', async (req, res) => {
        const match = /^\/(https?)\/(.+)$/.exec(req.url ?? '')
        if (!match) {
          res.statusCode = 400
          res.end('Expected /__proxy/http(s)/host/path')
          return
        }
        const target = `${match[1]}://${match[2]}`
        const controller = new AbortController()
        req.on('close', () => controller.abort())
        try {
          const range = req.headers.range
          const upstream = await fetch(target, { signal: controller.signal, headers: range ? { range } : {} })
          res.statusCode = upstream.status
          for (const name of forwarded) {
            const value = upstream.headers.get(name)
            if (value) res.setHeader(name, value)
          }
          res.setHeader('access-control-allow-origin', '*')
          if (!upstream.body) return void res.end()
          Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream).pipe(res)
        } catch (error) {
          if (controller.signal.aborted) return
          res.statusCode = 502
          res.end(String(error))
        }
      })
    },
  }
}

/** Copies appinfo.json into dist/ so ares-package can package dist/ as-is. */
function webosAppInfo(): Plugin {
  return {
    name: 'webos-appinfo',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'appinfo.json', source: readFileSync('appinfo.json', 'utf8') })
    },
  }
}

export default defineConfig(({ command }) => ({
  base: './',
  plugins: [react(), coreJsPolyfills(command === 'build'), classicScripts(), webosAppInfo(), vendorScripts(), devProxy()],
  build: {
    target: TARGET,
    cssTarget: TARGET,
    modulePreload: false,
    // For IIFE output Vite would otherwise inject the CSS from JS at runtime; emit one stylesheet instead.
    cssCodeSplit: false,
    rollupOptions: {
      output: { format: 'iife', inlineDynamicImports: true },
    },
  },
  worker: {
    format: 'iife',
    plugins: () => [coreJsPolyfills(command === 'build')],
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
}))
