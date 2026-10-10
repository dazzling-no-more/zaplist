# Publishing Zaplist on the LG Content Store

Step-by-step for submitting Zaplist to LG's app store (LG Content Store, also called LG Apps) through
LG Seller Lounge. The app and LG's paperwork are ready; what's left needs you: your contact details,
two files online, a test on a real TV, a seller account and the submission form.

## What's ready

| File | Used for |
| ---- | -------- |
| `out/zaplist.player_1.0.0_all.ipk` | The app package (built in step 4) |
| `store/lg-qa/Zaplist_UX_Scenario_1.0.0.pptx` | LG's UX scenario document, filled in (checked in step 3) |
| `store/lg-qa/Zaplist_Self_Checklist_1.0.0.xlsx` | LG's Self Checklist: comments and N/A items filled in; the results that need a TV test stay empty until step 5 |
| `store/listing.md` | App name, descriptions, category, image list for the form |
| `store/icon-400.png` | Store icon, 400×400 |
| `store/screenshots/*.png` | Primary + 5 secondary screenshots, 1280×720 |
| `public/splash.png` | Launcher/splash background, 1920×1080 (also inside the IPK) |
| `store/test-playlist.m3u`, `store/test-guide.xml.gz` | Playlist and TV guide for LG's testers (public test streams only) |
| `store/xtream-test-server.js` | Xtream Codes test server for LG's testers (running, see step 2) |
| `store/privacy-policy.md` | Privacy policy, in case the form asks for a URL |
| `store/lg-qa/*.ps1`, `*.py` | Scripts that rebuild the two LG documents from LG's templates |
| `store/art/*.svg` | Sources of the icon and splash |

The app ID is `zaplist.player` (`appinfo.json`). LG fixes the ID at the first submission; change it
before then if you want another one (for example the reverse domain of a website you own).

## 1. The two files online

The public repository [dazzling-no-more/zaplist](https://github.com/dazzling-no-more/zaplist) hosts
both, from the `main` branch:

- **Test playlist**: https://raw.githubusercontent.com/dazzling-no-more/zaplist/main/store/test-playlist.m3u
- **Privacy policy**: https://github.com/dazzling-no-more/zaplist/blob/main/store/privacy-policy.md

Both addresses are already in the UX scenario (page 6) and `store/listing.md`. The test playlist
names a guide, `store/test-guide.xml.gz`, with programmes until 2027-04-11: before submitting later
than that, run `node scripts/make-test-guide.mjs` and push the new file. The playlist address
is long to type with a remote: if you shorten it (tinyurl.com, is.gd; the app follows redirects),
rebuild the UX scenario with the short one (Windows with PowerPoint; it downloads LG's template
itself):

```powershell
pwsh store/lg-qa/ux-scenario.ps1 -PlaylistUrl https://tinyurl.com/your-link
```

## 2. The Xtream Codes test server

LG's testers can only try an Xtream Codes login against a server that answers like a provider.
`store/xtream-test-server.js` is one: it accepts the login `zaplist` / `review` and serves the same
test channels and guide as the test playlist. It runs on Cloudflare Workers (free plan) at
**<https://zaplist-test.zaplist.workers.dev>**, which the UX scenario names on page 6 and in the
appendix. Keep it running until LG approves the app, and during the review of every update.

To deploy it again (another account or address):

1. In the [Cloudflare dashboard](https://dash.cloudflare.com), *Workers & Pages* → *Create
   application* → *Start with Hello World!*; name it `zaplist-test`; leave Cloudflare Access off;
   *Deploy*.
2. *Edit code*, replace the sample with the contents of `store/xtream-test-server.js`, *Deploy*.
3. The address is `https://zaplist-test.<subdomain>.workers.dev`. The subdomain belongs to the
   account (*Workers & Pages* → *Your subdomain* → *Change*) and appears in LG's documents, so keep it
   neutral. A new subdomain needs a few minutes before HTTPS works.
4. Open the address: it should say "Zaplist test server for LG app review".
5. Set the new address as the `-XtreamServer` default in `store/lg-qa/ux-scenario.ps1` (or pass it)
   and rebuild the UX scenario. With `-XtreamServer ''` it tells LG that Xtream Codes needs a
   provider account instead.

## 3. Check the UX scenario

Open `store/lg-qa/Zaplist_UX_Scenario_1.0.0.pptx` and page through it once. It names the support
e-mail (nomoredazzling@gmail.com), the test playlist address and the Xtream test server with its login.

## 4. Build the package

```sh
npm ci
npm test
npm run build      # also checks the bundle for webOS 4 (Chromium 53)
npm run package    # → out/zaplist.player_1.0.0_all.ipk
```

## 5. Test on your TV

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
- [ ] With the pointer: holding OK on a channel opens its menu; in Favorites, *Move* shows arrows
      that reorder the channel.
- [ ] The Xtream Codes test server from page 6 logs in and its channels play.
- [ ] The LG Content Store on the TV has no other app called "Zaplist": LG rejects a title another
      app already uses. Web searches found no app or trademark with this name, but they can't see
      the store.

LG tests on every webOS version you select in step 7. The app is built for webOS TV 4.0 (2018
models) and later, but a newer TV can't show how it runs on an older one. If you can, run the list
on an older TV too (webOS 4.x or 5.x, 2018–2020); if not, select only the webOS versions you tested
and add older ones in an update after testing them.

If something fails, fix it and rebuild (step 4); LG rejects any app with a failed item. When
everything passes, fill in the checklist's results (this also marks the store search as done):

```sh
python store/lg-qa/self-checklist.py --tv-verified
```

## 6. Register as a seller

1. Open [LG Seller Lounge](https://seller.lgappstv.com) and sign in with an LG account (create one
   from the sign-in page if needed).
2. Register as an **individual seller** (a company can register as a corporate seller instead). You
   must be 18 or older. The seller name you enter is shown in the store next to the app.
3. Download the Seller Lounge guide: *APP MANAGEMENT* → *LG Seller Lounge Guide Download*. It
   describes every field of the form; where it differs from step 7, follow it.

## 7. Submit

In Seller Lounge, *APP MANAGEMENT* → *App Submission*. The field names below come from LG's pages
and third-party guides and may differ slightly.

1. **App ID**: `zaplist.player`.
2. **File upload**: service platform *webOS*; upload `out/zaplist.player_1.0.0_all.ipk`; display
   resolution 1920×1080 (FHD); the webOS TV versions you tested (step 5; the app supports 4.0 and
   later); file title "Zaplist", version `1.0.0`. A
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
   scenario", followed by the playlist URL, and "Xtream Codes test server:
   `https://zaplist-test.zaplist.workers.dev`, username zaplist, password review".
6. Save each tab, then submit.

## 8. Review

LG tests in three stages: a pretest of the submitted information, a function test and a content
test. A rejection comes back with a list of issues; fix them, rebuild and resubmit (raise the
version, e.g. 1.0.1, and add a row to the UX scenario's document history). LG publishes no review
time; plan for weeks. Questions go to the *1:1 Q&A* in Seller Lounge.

## Updates

Every change after approval goes through the same review. For each release: regenerate the test
guide (`node scripts/make-test-guide.mjs`), raise `version` in
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
