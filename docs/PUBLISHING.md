# Publishing to the LG Content Store

Step-by-step for submitting IPTV Player to LG's app store (called LG Content Store or LG Apps) through
LG Seller Lounge. The code side is done (see [What the code already does](#what-the-code-already-does));
what's left is testing on a TV, LG's paperwork and the submission form.

Everything the forms ask for is in [`store/`](../store):

| File | Used for |
| ---- | -------- |
| `out/org.iptvplayer.app_1.0.0_all.ipk` | The app package (built in step 2) |
| `store/listing.md` | App name, descriptions, category, image list |
| `store/icon-400.png` | Store icon, 400×400 |
| `store/screenshots/*.png` | Primary + 5 secondary screenshots, 1280×720 |
| `public/splash.png` | Launcher/splash background, 1920×1080 (also inside the IPK) |
| `store/ux-scenario.md` | Content for LG's UX scenario template |
| `store/test-playlist.m3u` | Playlist for LG's testers (public test streams only) |
| `store/privacy-policy.md` | Privacy policy, if the form asks for a URL |
| `store/art/*.svg` | Sources of the icon and splash, if you want to change them |

## 1. Decide these first: they can't change later

- **App ID.** `appinfo.json` → `id` is `org.iptvplayer.app`. LG fixes the ID at the first submission
  and recommends the reverse domain of something you own, for example `com.yourdomain.iptvplayer` or
  `io.github.yourname.iptvplayer`. IDs may use only `a-z`, `0-9`, `-` and `.`, and must not start with
  `com.lge`, `com.webos`, `com.palm` or `com.palmdts`. If you change it, rebuild (step 2).
- **App name.** "IPTV Player" is generic and used by other apps elsewhere. To rename, change
  `appinfo.json` → `title`, `src/i18n.ts` → `appName`, `index.html` → `<title>` and the name in
  `store/listing.md`, `store/ux-scenario.md` and `store/privacy-policy.md`.
- **Support email** shown in the store, and your **seller name** (step 4).

## 2. Build the package

```sh
npm ci
npm test
npm run build      # also checks the bundle for webOS 4 (Chromium 53)
npm run package    # → out/<id>_<version>_all.ipk
```

The version comes from `appinfo.json` → `version` (1.0.0). Keep `package.json` → `version` the same.

## 3. Test on your TV first

The app has only been tested in desktop Chrome so far. LG's testers use real TVs, so check it on one
before submitting; a rejection costs a review round.

1. Create an account on the [LG webOS TV developer site](https://webostv.developer.lge.com).
2. On the TV, install **Developer Mode** from the LG Content Store, sign in with that account and turn
   on Dev Mode Status (the TV restarts). The session expires after a while; extend it in the app.
3. On the PC: `npx ares-setup-device` → add a device named `tv` with the IP shown in the Developer Mode
   app, then `npx ares-novacom --device tv --getkey` with the passphrase it shows.
4. `npm run install:tv && npm run launch:tv`. `npm run inspect:tv` opens Web Inspector.

Check at least:

- [ ] Add the test playlist (`store/test-playlist.m3u`, hosted as in step 5, or any URL the TV can
      reach); every stream plays. Try audio tracks on "Angel One" and subtitles on "Apple test stream".
- [ ] Back on Home leaves the app the system way: an exit popup or the Home screen, depending on
      the webOS version.
- [ ] Arrows, OK, Back, Channel +/−, number keys and the color keys do what `store/ux-scenario.md` says.
- [ ] The Magic Remote pointer: hover focuses, click selects, the wheel scrolls, clicking a star
      toggles the favorite.
- [ ] Picture → Zoom fills the screen (it resizes the video element, which the TV's video plane must follow).
- [ ] The splash image shows while the app loads, and the launcher tile looks right.
- [ ] Unplug the network while playing: a message appears and playback resumes when it's back.

## 4. Register as a seller

1. Open [LG Seller Lounge](https://seller.lgappstv.com) and sign in with an LG account (create one
   from the sign-in page if needed).
2. Register as an **individual seller** (a company can register as a corporate seller instead). You
   must be 18 or older. The seller name you enter is shown in the store next to the app.

## 5. Put two files online

LG's testers need a playlist URL they can type with a remote, so keep it short.

- **Test playlist**: publish `store/test-playlist.m3u` at a public URL (a public GitHub repository or
  gist, GitHub Pages, or any web host), ideally behind a short URL. Check it opens from the TV.
- **Privacy policy**: fill in the placeholders in `store/privacy-policy.md` and publish it the same
  way, in case the form asks for a privacy policy URL.

## 6. Get LG's documents

- **Seller Lounge guide**: in Seller Lounge, *APP MANAGEMENT* → *LG Seller Lounge Guide Download*.
  It describes every field of the submission form; follow it where it differs from step 9.
- **App Self Checklist**: download `documents_for_app_qa.zip` from the
  [App Self Checklist page](https://webostv.developer.lge.com/distribute/app-self-checklist).
- **UX scenario template**: in Seller Lounge (a PowerPoint file).

## 7. Fill in the Self Checklist

Test every item on the TV and mark it *pass* or *N/A* truthfully. A missing or inaccurate checklist
gets the app rejected without testing, and so does marking an item N/A that applies. Notes for the
items that concern this app:

- **Back button on the entry page** (webOS 23–25: must show the Home screen): Back on Home calls
  `webOS.platformBack()` and the system decides (exit popup or Home screen). There is no custom exit
  popup.
- **Navigation keys, screen cursor, selection effect**: everything works with the arrows and OK and
  with the pointer; the focused item is always shown inverted (white).
- **Privacy and credentials**: no credentials are hard-coded. LG's scanner will still find keywords;
  explain them with the note below.

Reviewer note (paste where the checklist or form allows comments):

> No credentials, tokens or keys are hard-coded. The words "password", "credential" and "token" in
> the package come from: the Xtream Codes API, whose requests carry the user's own login as
> `username=`/`password=` URL parameters; the Password field of the "Add a source" form; the core-js
> URL polyfill (the standard `URL.password` property); the standard `withCredentials`/`credentials`
> options of XHR and fetch in hls.js and mpegts.js; and `DOMTokenList`. Logins and playlist URLs the
> user enters are stored only on the TV, encrypted with AES-GCM under a non-extractable key generated
> on the TV, and the login is replaced by placeholders in stored stream and guide URLs.

## 8. Write the UX scenario

Copy the sections of `store/ux-scenario.md` into LG's template, one slide each, with the matching
screenshots from `store/screenshots/`. Replace `<test playlist URL>` with your URL from step 5.

## 9. Submit

In Seller Lounge, *APP MANAGEMENT* → *App Submission*. The form has tabs; the field names below come
from LG's pages and third-party guides, so they may differ slightly. The Seller Lounge guide is
authoritative.

1. **App ID**: the ID from `appinfo.json`. It can't be changed afterwards.
2. **File upload**: service platform *webOS*; upload the IPK from `out/`; choose the 1920×1080 (FHD)
   display resolution, which matches `appinfo.json`; select the webOS versions to support (the app
   targets webOS TV 4.0 and later); enter the file title and version `1.0.0`. A *deep link URL*
   field is for apps hosted on a website; this app is packaged, so leave it at its default.
3. **Images**: see the table in `store/listing.md` (400×400 icon, primary + up to 5 secondary
   screenshots, 1920×1080 background, tile color `#3b82ea`).
4. **Service info**: name, short and full description, category *Entertainment*, price *Free*,
   countries, support email and privacy policy URL, all from `store/listing.md`. For an age rating,
   answer for the app itself: it has no built-in content, users load their own playlists, and it has a
   parental control PIN.
5. **Test info**: upload the Self Checklist and the UX scenario. As test account information give the
   test playlist URL, and say that Xtream Codes needs an account from an IPTV provider, which you
   can't supply.
6. Save each tab, then submit.

## 10. Review

LG tests in three stages: a pretest of the submitted information, a function test and a content
test. A rejection comes back with a list of issues; fix them, rebuild and resubmit (raising the
version, e.g. 1.0.1, keeps the packages apart). LG publishes no review time; plan for weeks.
Questions go to the *1:1 Q&A* in Seller Lounge. Once approved, the app goes live in the store.

## Updates

Every change after approval goes through the same review. For each release: raise `version` in
`appinfo.json` and `package.json`, then build, package, test on the TV, update the listing's
"What's new", and submit the new IPK as an update in Seller Lounge.

## What the code already does

| LG requirement or recommendation | How the app meets it |
| -------------------------------- | -------------------- |
| Back on the entry page shows the Home screen (webOS 23–25) | Back on Home calls `webOS.platformBack()` (`src/ui/navigation.ts`); `disableBackHistoryAPI` is set |
| All navigation keys and the pointer work; visible selection | Spatial navigation plus pointer hover/click/wheel on every screen |
| No hard-coded credentials | None in the source |
| Sensitive data saved on the TV is encrypted | Sources sealed with AES-GCM, key non-extractable in IndexedDB; login masked in stored URLs (`src/data/vault.ts`, `src/data/db.ts`) |
| Visual cue while loading | Splash image (`appinfo.json` → `splashBackground`), loading text and spinners |
| 1920×1080, fonts ≥ 20 px | `"resolution": "1920x1080"`; smallest text is 22 px |
| Icons 80×80 and 130×130 in the package, 400×400 for the store | `public/icon.png`, `public/largeIcon.png`, `store/icon-400.png` |
| Playback controls work with 4-way keys and the pointer | Info bar buttons for list, favorite, audio, subtitles, picture |

## Sources

- [App Approval Process](https://webostv.developer.lge.com/distribute/app-approval-process) (LG)
- [App Ecosystem](https://webostv.developer.lge.com/distribute/app-ecosystem) (LG)
- [App Self Checklist](https://webostv.developer.lge.com/distribute/app-self-checklist) (LG)
- [Back button guide](https://webostv.developer.lge.com/develop/guides/back-button) (LG)
- [appinfo.json reference](https://webostv.developer.lge.com/develop/references/appinfo-json) (LG)
- [Submitting Apps to the LG (webOS) Store](https://beacon-help.support.brightcove.com/publishing-apps/lg/submitting-to-lg.html) (Brightcove; form details and image sizes)
