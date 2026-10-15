# Zaplist: IPTV player for LG webOS TV

A free, open-source IPTV player for LG TVs with webOS 4.0 or newer (2018 models onward). It plays
the playlists you give it, either M3U/M3U8 URLs or Xtream Codes logins. It ships no channels,
streams or credentials, and has no ads, accounts or telemetry. Credentials stay on the TV, encrypted.

## Features

- **Sources**: several M3U URLs and Xtream Codes logins, each checked by downloading it before it is
  saved. Xtream accounts show their expiry date and connection limit. Refresh, edit or delete
  sources at any time.
- **Add from your phone**: the start screen and the source form show a QR code. It opens a page on
  the phone where the playlist or login can be typed; it arrives in the TV's form, end-to-end
  encrypted (the key is only in the QR code), through a small relay (`relay/`, a Cloudflare Worker)
  that can't read it.
- **Browse**: sidebar with Search, TV guide, Settings, Home, Favorites, Recent, All channels and the
  playlist categories, folded to a rail of icons while you browse the channels; a virtualized channel
  list (50,000+ channels) with logos, numbers and the programme on now. Home shows rows of the movies
  and series to continue and the favorite and recent channels.
- **Search** across channel names (ignores case, accents and punctuation), updating as you type.
- **Favorites** (the star on each channel: Right then OK, or click it; also the red button or hold OK) in
  your own order, and the last 20 channels watched.
- **Player**: native playback first, then hls.js (HLS) or mpegts.js (MPEG-TS) when the TV's player
  can't play a stream. Zapping, number entry, a mini channel list, now/next, play/pause, audio and subtitle tracks,
  picture shape (fit, zoom, fill, 16:9, 4:3), automatic retries and a readable error otherwise. Playback
  stops when the app is hidden or the network drops and resumes on its own. The last channel reopens
  when the app starts.
- **Movies and series**: from Xtream Codes servers (VOD and series lists, episodes and details on
  request) and from M3U playlists (`/movie/` and `/series/` links, video files, `S01E02` names grouped
  into series). Poster grids by category, details, seasons and episodes; the player seeks, resumes where
  you stopped and goes on to the next episode; Continue watching lists what you started. Movie and
  series categories can be locked with the parental PIN like channel categories.
- **TV guide**: XMLTV (plain or gzipped) from the playlist, the Xtream server or a URL you enter; the
  Xtream short EPG as a fallback. Grid guide, time offset, automatic refresh every 6/12/24 hours.
- **Parental control**: a 4-digit PIN locks the categories you choose until it is entered.
- **About**: app version, TV model and webOS version, playback engine, last error; clear the cache.

## Remote control

| Where      | Key                          | Does                                                    |
| ---------- | ---------------------------- | ------------------------------------------------------- |
| Everywhere | Arrows, OK                   | Move and select (the Magic Remote pointer works too)    |
|            | Back                         | Close the open overlay, go back; on Home, leave the app |
| Lists      | Channel +/−                  | Page up/down                                            |
|            | Right, then OK               | Toggle favorite (the star at the end of the row)        |
|            | Red / hold OK                | Toggle favorite / channel menu                          |
|            | Yellow (in Favorites)        | Move the channel (Up/Down, then OK)                     |
| Player     | Up/Down, Channel +/−         | Next / previous channel                                 |
|            | 0–9                          | Go to channel number (after 1.5 s)                      |
|            | OK                           | Channel list                                            |
|            | Left/Right, Info             | Info bar with now/next, audio, subtitles, picture shape |
|            | Red / Yellow                 | Favorite / picture shape                                |
|            | Play, Pause, Stop            | Resume, pause, leave the player                         |
| Guide      | Arrows, OK                   | Move through programmes; OK watches what's on now       |
| Movie/episode player | Left/Right         | 10 s back / ahead (on the progress bar too)             |
|            | Rewind / Fast forward        | 30 s back / ahead                                       |
|            | OK, Play/Pause               | Pause or resume                                         |
|            | Up/Down, Info                | Controls: audio, subtitles, picture, next episode       |

Every action also works with arrows and OK alone (the Magic Remote has no color keys). In a desktop
browser, Escape and Backspace act as Back, and double-clicking the picture toggles full screen.

On Home, Back goes to the system (`webOS.platformBack()`), which shows the TV's exit prompt or Home
screen depending on the webOS version, as LG's app checklist requires.

## Development

Requires Node.js 20.19+ (or 22.12+). The webOS CLI is a dev dependency, so nothing is installed globally.

```sh
npm install
npm run dev          # http://localhost:5173, use a 1920×1080 window and the keyboard
npm test             # Vitest: parsers, time math, navigation, playback logic
npm run build        # type-check, build to dist/, check the bundle for Chromium 53
npm run package      # dist/ → out/<id>_<version>_all.ipk
```

In the dev server, requests to other origins go through a local proxy (`/__proxy/...`, see
`vite.config.ts`), because desktop browsers enforce CORS and the TV does not. Production builds call
the URLs directly.

Test data (all legal and public):

- `tests/fixtures/dev-streams.m3u`: public HLS and MPEG-TS test streams, two broken ones for the
  error paths, and a movie and a two-episode series (Blender open movie files). Add it as a source with `http://localhost:5173/tests/fixtures/dev-streams.m3u`.
- `node scripts/make-large-playlist.mjs [count]` writes a 50,000-channel playlist to
  `tests/fixtures/large.m3u` (not committed) for scale testing.
- The [iptv-org](https://github.com/iptv-org/iptv) playlist, `https://iptv-org.github.io/iptv/index.m3u`.
- `tests/fixtures/` also holds messy M3U files, XMLTV (+ `.gz`) and Xtream JSON responses used by the tests.
- `store/test-playlist.m3u` is the playlist for LG's testers: public test streams plus guide data in
  `store/test-guide.xml.gz` (`node scripts/make-test-guide.mjs` regenerates it for the next six months).

## Running on a TV

1. Turn on Developer Mode on the TV (LG's *Developer Mode* app) and note its IP address.
2. Register it under the name `tv`: `npx ares-setup-device` (add device, name `tv`, the TV's IP).
3. `npm run build && npm run package && npm run install:tv && npm run launch:tv`
4. `npm run inspect:tv` opens Web Inspector for the running app.

To publish on the LG Content Store, follow [docs/PUBLISHING.md](docs/PUBLISHING.md).

## Building for webOS (Chromium 53)

webOS TV 4.x runs Chromium 53 and loads the app from `file://`, so the build:

- emits classic scripts with relative paths (no `type="module"`, no `crossorigin`);
- lowers syntax to Chromium 53 (`build.target: 'chrome53'`) and adds the core-js polyfills it lacks
  (computed by `core-js-compat`; built-ins newer than ES2022 are left out), plus `AbortController`
  and `ResizeObserver`;
- ships hls.js and mpegts.js as separate scripts in `dist/vendor/`, loaded only when native playback
  fails (they're about two thirds of the JavaScript);
- runs playlist and guide parsing in a Web Worker loaded from its own file, falling back to the main
  thread where workers can't load (desktop browsers refuse `file://` workers);
- fails if `dist/` contains syntax newer than ES2016, ES2018+ regular expressions, module scripts,
  `crossorigin`, or absolute URLs (`scripts/check-bundle.mjs`).

CSS must work on Chromium 53 too: no CSS grid, no flexbox `gap`, no `inset`. Animate only
`transform` and `opacity`; no `backdrop-filter` or blurred shadows.

## Known limits

- **Not yet tested on a TV or the webOS simulator.** Everything above was checked in desktop
  Chrome (dev server and the `file://` build) with keyboard and simulated remote events. Playback in
  desktop Chrome doesn't prove playback on the TV.
- `#EXTVLCOPT` and `#KODIPROP` options are read and stored but not applied. Web apps can't set
  headers such as `User-Agent` or `Referer`, and DRM (Widevine/PlayReady) is out of scope, so streams
  that need them won't play.
- Some TVs don't pass Channel +/− to apps; Up/Down zap in the player as well.
- With the Magic Remote pointer visible, OK is taken as a click and the Enter key is ignored, so an
  action doesn't run twice. This follows LG's own Enact framework; verify on a real TV.
- Audio track switching for HLS played by the TV's own player may not work on every webOS version
  (reported on LG's forum). Streams played by hls.js switch reliably.
- Catch-up/timeshift, VOD and series (Xtream) are not implemented yet.
- Sources, cached channel lists, guide addresses, the PIN and the extra guide URL are encrypted with a
  key kept on the TV (AES-GCM, non-extractable, in IndexedDB). That protects a copied database, not a
  TV someone fully controls. Favorites, recent channels and guide programmes are stored unencrypted.

## Project layout

```
appinfo.json           webOS manifest (ID, version, icons, splash, 1920×1080, Back handling, permissions)
public/                icons, splash image, LG webOSTV.js (Apache-2.0)
scripts/               bundle checker, webOS CLI wrapper, large-playlist generator
src/platform/          remote keys, back stack, webOS wrappers, lifecycle, network status
src/data/              models, M3U/Xtream/XMLTV parsers, IndexedDB, library, guide, preferences
src/workers/           parse worker and its message protocol
src/player/            engines (native, hls.js, mpegts.js), retries, vendor script loading
src/ui/                focus, navigation, virtual list, dialogs, PIN pad, channel rows, formatting
src/screens/           Home, Search, Player, Guide, Settings (sources, guide, parental, about), source form
src/i18n.ts            every user-facing string
tests/                 Vitest tests and fixtures
store/                 LG Content Store material: icon, screenshots, listing text, test playlist, privacy policy
store/lg-qa/           LG's UX scenario and Self Checklist, filled in, and the scripts that build them
store/xtream-test-server.js  Xtream Codes test server for LG's testers (a Cloudflare Worker)
relay/                 relay and phone page for "Add from your phone" (a Cloudflare Worker)
docs/PUBLISHING.md     how to submit the app to the LG Content Store
```

## License

Free and open source under the [MIT License](LICENSE). Bundled libraries are under free licenses
(MIT, ISC or Apache-2.0); hls.js and mpegts.js are shipped with their license files.
