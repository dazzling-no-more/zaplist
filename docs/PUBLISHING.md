# Publishing Zaplist on the LG Content Store

Step-by-step for submitting Zaplist to LG's app store (LG Content Store, also called LG Apps) through
LG Seller Lounge. The app and LG's paperwork are ready; what's left needs you: your contact details,
two files online, a test on a real TV, a seller account and the submission form.

## What's ready

| File | Used for |
| ---- | -------- |
| `out/zaplist.player_1.0.0_all.ipk` | The app package (built in step 3) |
| `store/lg-qa/Zaplist_UX_Scenario_1.0.0.pptx` | LG's UX scenario document, filled in (built in step 2) |
| `store/lg-qa/Zaplist_Self_Checklist_1.0.0.xlsx` | LG's Self Checklist: comments and N/A items filled in; the results that need a TV test stay empty until step 4 |
| `store/listing.md` | App name, descriptions, category, image list for the form |
| `store/icon-400.png` | Store icon, 400×400 |
| `store/screenshots/*.png` | Primary + 5 secondary screenshots, 1280×720 |
| `public/splash.png` | Launcher/splash background, 1920×1080 (also inside the IPK) |
| `store/test-playlist.m3u` | Playlist for LG's testers (public test streams only) |
| `store/privacy-policy.md` | Privacy policy, in case the form asks for a URL |
| `store/lg-qa/*.ps1`, `*.py` | Scripts that rebuild the two LG documents from LG's templates |
| `store/art/*.svg` | Sources of the icon and splash |

The app ID is `zaplist.player` (`appinfo.json`). LG fixes the ID at the first submission; change it
before then if you want another one (for example the reverse domain of a website you own).

## 1. Put two files online

- **Test playlist**: publish `store/test-playlist.m3u` at a public URL: a public GitHub repository or
  gist, GitHub Pages, or any web host. LG's testers type it with a remote, so keep it short (a URL
  shortener is fine). Open it on the TV's browser to check it's reachable.
- **Privacy policy**: put your support e-mail into `store/privacy-policy.md` (and the date, if you
  change the text) and publish it the same way.

## 2. Put your details into the UX scenario

The UX scenario names your support e-mail and the test playlist URL. Rebuild it with yours (needs
Windows with PowerPoint; it downloads LG's template itself):

```powershell
pwsh store/lg-qa/ux-scenario.ps1 -Email support@example.com -PlaylistUrl https://example.com/zaplist.m3u
```

Open the result and page through it once. Without PowerPoint, edit the placeholders by hand instead:
the e-mail on the cover and in the appendix (last page), and the URL in the table on page 6.

## 3. Build the package

```sh
npm ci
npm test
npm run build      # also checks the bundle for webOS 4 (Chromium 53)
npm run package    # → out/zaplist.player_1.0.0_all.ipk
```

## 4. Test on your TV

Zaplist has been tested in desktop Chrome only. LG tests on real TVs, and the Self Checklist states
results for a TV, so run it on one first; a rejection costs a review round.

1. Create an account on the [LG webOS TV developer site](https://webostv.developer.lge.com).
2. On the TV, install **Developer Mode** from the LG Content Store, sign in with that account and turn
   on Dev Mode Status (the TV restarts). The session expires after a while; extend it in the app.
3. On the PC: `npx ares-setup-device` → add a device named `tv` with the IP shown in the Developer Mode
   app, then `npx ares-novacom --device tv --getkey` with the passphrase it shows.
4. `npm run install:tv && npm run launch:tv`. `npm run inspect:tv` opens Web Inspector.

Then go through the UX scenario on the TV, page by page, with the test playlist, and every Self
Checklist item whose result is still empty. In particular:

- [ ] Every stream in the test playlist plays; audio tracks switch on "Angel One", subtitles on
      "Apple test stream".
- [ ] Back on the first screen leaves the app the system way (exit popup or Home screen).
- [ ] Pointer, wheel, number keys, color keys and Play/Pause/Stop behave as the scenario says.
- [ ] Picture → Zoom fills the screen.
- [ ] The splash image shows while the app loads; the launcher tile looks right.
- [ ] Unplugging the network shows a message; playback resumes when it's back.
- [ ] Turning the TV off and on reopens the app with its playlists.
- [ ] Home, then back into the app (from the launcher and from Recent): it comes back where it was;
      playback stops while the app is hidden.
- [ ] Typing with the LG keyboard in the playlist, login and search fields: upper and lower case, the
      < > cursor buttons, voice input.

If something fails, fix it and rebuild (step 3); LG rejects any app with a failed item. When
everything passes, fill in the checklist's results:

```sh
python store/lg-qa/self-checklist.py --tv-verified
```

Also search the LG Content Store on the TV for "Zaplist": LG rejects a title that another app in the
store already uses. Web searches found no app or trademark with this name, but they can't see the store.

## 5. Register as a seller

1. Open [LG Seller Lounge](https://seller.lgappstv.com) and sign in with an LG account (create one
   from the sign-in page if needed).
2. Register as an **individual seller** (a company can register as a corporate seller instead). You
   must be 18 or older. The seller name you enter is shown in the store next to the app.
3. Download the Seller Lounge guide: *APP MANAGEMENT* → *LG Seller Lounge Guide Download*. It
   describes every field of the form; where it differs from step 6, follow it.

## 6. Submit

In Seller Lounge, *APP MANAGEMENT* → *App Submission*. The field names below come from LG's pages
and third-party guides and may differ slightly.

1. **App ID**: `zaplist.player`.
2. **File upload**: service platform *webOS*; upload `out/zaplist.player_1.0.0_all.ipk`; display
   resolution 1920×1080 (FHD); webOS TV 4.0 and later; file title "Zaplist", version `1.0.0`. A
   *deep link URL* field is for apps hosted on a website: leave it at its default.
3. **Images**: the table in `store/listing.md` (400×400 icon, primary + 5 secondary screenshots,
   1920×1080 launcher and splash background, tile color `#3b82ea`).
4. **Service info**: name, short and full description (English), category *Entertainment*, price
   *Free*, the countries you want, support e-mail and privacy policy URL, all from
   `store/listing.md`. Set **Geo-IP block to No** and include English as the service language: LG
   rejects global apps that are geo-blocked or not in English. For the age rating, answer for the
   app itself: no built-in content, users load their own playlists, parental control PIN.
5. **Test info**: upload `Zaplist_Self_Checklist_1.0.0.xlsx` and `Zaplist_UX_Scenario_1.0.0.pptx`.
   As test account information: "No account needed: add the test playlist from page 6 of the UX
   scenario", followed by the playlist URL.
6. Save each tab, then submit.

## 7. Review

LG tests in three stages: a pretest of the submitted information, a function test and a content
test. A rejection comes back with a list of issues; fix them, rebuild and resubmit (raise the
version, e.g. 1.0.1, and add a row to the UX scenario's document history). LG publishes no review
time; plan for weeks. Questions go to the *1:1 Q&A* in Seller Lounge.

## Updates

Every change after approval goes through the same review. For each release: raise `version` in
`appinfo.json` and `package.json`, build, package, test on the TV, rebuild both LG documents
(`ux-scenario.ps1`, and `self-checklist.py --tv-verified` after the TV test), update "What's new" in
`store/listing.md`, and submit the new IPK as an update. When screens change, retake the screenshots
in `store/screenshots/` and `store/lg-qa/images/` (1280×720) and check the callout positions in
`ux-scenario.ps1`.

## What the code already does

| LG requirement | How Zaplist meets it |
| -------------- | -------------------- |
| Back on the first page goes to the system (webOS 23–25: Home screen) | Back on Home calls `webOS.platformBack()` (`src/ui/navigation.ts`); `disableBackHistoryAPI` is set |
| All navigation keys and the pointer work; visible focus | Spatial navigation plus pointer hover, click and wheel on every screen |
| Playback controls reachable without media keys (Magic Remote) | Play/Pause, channel list, favorite, audio, subtitles and picture buttons in the info bar |
| Everything inside the overscan area | 96 px / 54 px margins at 1920×1080, overlays included |
| No hard-coded credentials; sensitive data encrypted | Sources, cached channel lists (every stream, logo and guide URL, whatever token they carry), the PIN and the extra guide URL are sealed with AES-GCM under a non-extractable key generated on the TV (`src/data/vault.ts`, `src/data/db.ts`, `src/data/prefs.ts`) |
| Visual cue while loading; no hang | Splash image, loading text, spinners; if storage can't be read at startup, an error screen offers Try again and Reset app data |
| Long text ellipsized, lists scroll | Ellipsis on names; virtual lists |
| Square, opaque icon without rounded corners | `store/icon-400.png`, `public/icon.png`, `public/largeIcon.png` |
| Adult content protection (when present) | Parental PIN locks categories; locked channels hidden everywhere |
| Title not too generic | "Zaplist" |

LG's scanner flags the words "password", "credential" and "token". In this package they come from the
Xtream Codes API parameters, the login form field, the core-js URL polyfill (`URL.password`) and the
`withCredentials` options of hls.js and mpegts.js; nothing is hard-coded. The UX scenario's appendix
says so for the reviewers.

## Sources

- [App Approval Process](https://webostv.developer.lge.com/distribute/app-approval-process) (LG)
- [App Ecosystem](https://webostv.developer.lge.com/distribute/app-ecosystem) (LG)
- [App Self Checklist](https://webostv.developer.lge.com/distribute/app-self-checklist) (LG; the QA documents zip)
- [Back button guide](https://webostv.developer.lge.com/develop/guides/back-button) (LG)
- [appinfo.json reference](https://webostv.developer.lge.com/develop/references/appinfo-json) (LG)
- [Submitting Apps to the LG (webOS) Store](https://beacon-help.support.brightcove.com/publishing-apps/lg/submitting-to-lg.html) (Brightcove; form details and image sizes)
