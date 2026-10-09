# IPTV Player for LG webOS TV

An IPTV player for webOS TV 4.0+ (2018 models and newer). It plays playlists the user supplies
(M3U URLs or Xtream Codes logins) and ships no channels, streams or credentials.

## Scripts

| Command              | What it does                                                                 |
| -------------------- | ---------------------------------------------------------------------------- |
| `npm run dev`        | Vite dev server for desktop Chrome. Lay the window out at 1920×1080.          |
| `npm test`           | Vitest unit tests (`tests/`).                                                |
| `npm run build`      | Type-check, build to `dist/`, then `scripts/check-bundle.mjs` (see below).   |
| `npm run package`    | `ares-package dist -o out` → `out/<id>_<version>_all.ipk`.                   |
| `npm run install:tv` | Install the `.ipk` on the device named `tv`.                                 |
| `npm run launch:tv`  | Launch the app on `tv`.                                                      |
| `npm run inspect:tv` | Open Web Inspector for the app on `tv`.                                      |

The webOS CLI (`@webos-tools/cli`) is a dev dependency, so no global install is needed; run its
other commands with `npx`, e.g. `npx ares-setup-device` to register your TV under the name `tv`
(enable Developer Mode on the TV first).

On desktop, Escape and Backspace act as the remote's Back key.

## Building for Chromium 53

webOS TV 4.x runs Chromium 53 and loads the app from `file://`. The build therefore:

- emits one classic IIFE script (no `type="module"`, no `crossorigin`) with relative paths;
- lowers syntax with esbuild (`build.target: 'chrome53'`);
- adds runtime polyfills in `src/polyfills.ts`: the core-js modules Chromium 53 lacks (computed by
  `core-js-compat`), plus `AbortController` and `ResizeObserver`;
- fails if `dist/` contains syntax newer than ES2016, regular expressions using ES2018+ features,
  module scripts, `crossorigin`, or absolute URLs (`scripts/check-bundle.mjs`).

CSS must also work on Chromium 53: no CSS grid, no flexbox `gap`, no `inset`. Animate only
`transform` and `opacity`.

## App identity

`appinfo.json` holds the app ID (`org.iptvplayer.app`), vendor and title.
`public/webOSTVjs-1.2.13/` is LG's webOSTV.js library (Apache-2.0, license alongside), copied from
the `@webos-tools/cli` app template.

## Layout

```
appinfo.json      webOS app manifest, copied into dist/ by the build
public/           icons, webOSTV.js
scripts/          bundle checker, webOS CLI wrapper
src/platform/     key map, back stack, webOS wrappers, lifecycle
src/ui/           focus manager, navigation hooks, Button, Region, Dialog
src/screens/      Home, Settings
src/i18n.ts       all user-facing strings
tests/            Vitest tests
```

## License

Free and open source under the [MIT License](LICENSE). The app has no ads, accounts, telemetry or
paid features, and every bundled library is under a free license (MIT, ISC or Apache-2.0).
