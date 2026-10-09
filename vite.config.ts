import { readFileSync } from 'node:fs'
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
function coreJsPolyfills(): Plugin {
  const id = 'virtual:core-js'
  let build = false
  return {
    name: 'core-js-polyfills',
    configResolved(config) {
      build = config.command === 'build'
    },
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

export default defineConfig({
  base: './',
  plugins: [react(), coreJsPolyfills(), classicScripts(), webosAppInfo()],
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
  worker: { format: 'iife' },
  test: {
    include: ['tests/**/*.test.ts'],
  },
})
