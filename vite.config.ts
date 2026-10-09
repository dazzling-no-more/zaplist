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
 * `virtual:core-js` imports exactly the core-js modules Chromium 53 lacks (what Babel's
 * `useBuiltIns: "entry"` would emit). The dev server runs in a modern desktop browser, so it gets none.
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
      const { list } = compat({ targets: { chrome: '53' }, modules: ['core-js/stable'], version })
      return list.map((name) => `import 'core-js/modules/${name}.js';`).join('\n')
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
  plugins: [react(), coreJsPolyfills(command === 'build'), classicScripts(), webosAppInfo(), devProxy()],
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
