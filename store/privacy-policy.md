# Zaplist privacy policy

_Last updated: October 14, 2026_

Zaplist is a free, open-source app for LG webOS TVs that plays playlists you add yourself.

**What the app stores.** The playlist URLs, Xtream Codes logins and guide URLs you enter, the channel
lists, movies, series and TV guide it downloads from them, your settings (favorites, recent channels,
parental control PIN, picture mode) and how far you watched movies and episodes. All of it is stored
only on your TV. Playlist URLs, logins, the channel, movie and series lists downloaded with them, the
guide addresses and the PIN are encrypted. Deleting a source in Settings removes it and everything
downloaded from it; uninstalling the app removes everything.

**What the app sends.** The app connects to the addresses you enter (your playlist, your Xtream
Codes server, your guide URLs), to the stream and logo addresses those return and, while its "Add a
source" screen is open, to the relay described below. It has no accounts, no ads, no analytics and
no tracking. Nothing readable is sent to the app's developers.

**Adding a playlist from your phone.** The "Add a source" screen shows a QR code. If you scan it, the
playlist or login you enter on your phone reaches the TV through a relay the developers run on
Cloudflare (add.zaplist.workers.dev). It is encrypted on your phone with a key that only the QR code
on your TV carries; the relay can't read it, passes it to the TV once and deletes it at the latest
15 minutes after you send it. Like any web service, the relay's host, Cloudflare, sees the IP
addresses of your phone and TV.

**Your provider.** The services you connect to have their own privacy policies. The app's developers
don't control them.

**Children.** The app has no content of its own. A parental control PIN can lock categories.

**Contact.** nomoredazzling@gmail.com
