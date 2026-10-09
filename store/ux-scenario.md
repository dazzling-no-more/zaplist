# UX scenario: IPTV Player 1.0.0

Content for LG's UX scenario template (download it from Seller Lounge). One section per slide is a
good fit; add screenshots from `store/screenshots/` where noted. Replace `<test playlist URL>` with
the public URL of `store/test-playlist.m3u`.

## 1. About the app

IPTV Player plays the user's own IPTV playlists: M3U/M3U8 URLs or Xtream Codes logins. It includes no
channels. Main screens: Home (categories and channels), Player, Channel list overlay, TV guide,
Search, Settings.

Supported: webOS TV 4.0 and later, 1920×1080, standard remote and Magic Remote (pointer).

## 2. Test setup

The app starts empty, so the tester adds the test playlist first:

1. Launch the app. The welcome screen opens with **Add a source** focused. Press **OK**.
2. **M3U playlist** is selected. Move down to **Name**, press OK, type `Test`, press Back to close
   the keyboard.
3. Move down to **Playlist URL**, press OK, type `<test playlist URL>`, close the keyboard.
4. Move to **Check and save** and press OK. The app downloads the playlist and opens Home with
   5 channels in 2 categories (Open movies, Test streams).

The test playlist uses public test streams (Blender open movies and Apple/Google test streams) and has
no TV guide data. Xtream Codes logins need an account from an IPTV provider; the app checks the login
when it is saved and shows the account's expiry date in Settings → Sources.

## 3. Home (screenshot 1)

| Step | Expected result |
| ---- | --------------- |
| Up/Down in the left column | Moves through Search, TV guide, Settings, Favorites, Recent, All channels and the playlist categories. The channel list on the right follows the focused category. |
| Right from a category | Focus moves into the channel list. |
| Up/Down, Channel +/− in the channel list | Moves one channel / one page. |
| Right on a channel | The star at the end of the row gets focus. OK adds or removes the channel from Favorites; the star turns yellow, and Favorites' count changes. Left returns to the row. |
| Hold OK on a channel | Menu: Add to / Remove from favorites, Cancel. In Favorites also Move (Up/Down to reorder, OK to finish). |
| OK on a channel | Opens the player on that channel. |
| Back on Home | Leaves the app through the system: the webOS exit popup or the Home screen, depending on the TV's webOS version. |

## 4. Player (screenshot 2)

| Step | Expected result |
| ---- | --------------- |
| Open a channel | Video starts within a few seconds. The info bar shows channel number, name, clock and (with guide data) now/next, then hides after 5 seconds. |
| Up/Down or Channel +/− | Next / previous channel in the current list. |
| Number keys | Jumps to that channel number after 1.5 seconds. |
| Left/Right or Info | Shows the info bar with buttons: Channel list, Add to favorites, Audio, Subtitles, Picture. |
| Audio / Subtitles on "Angel One" or "Apple test stream" | Lists the stream's tracks; choosing one switches it. |
| Picture | Cycles Fit → Zoom → Fill → 16:9 → 4:3 and shows the mode briefly. |
| Red / Yellow keys | Favorite / picture mode (shortcuts; everything also works with arrows and OK). |
| Back | Closes the info bar or overlay; otherwise returns to Home on the channel just watched. |
| Unplug the network while playing | A message says the connection is lost; playback resumes when it returns. |

## 5. Channel list overlay (screenshot 3)

| Step | Expected result |
| ---- | --------------- |
| OK in the player | Opens categories (left) and channels (right) over the video, on the current channel. |
| Up/Down, Left/Right | Moves through categories and channels; the right side follows the focused category. |
| OK on a channel | Switches to it and closes the overlay. |
| Search / TV guide buttons (top left) | Open Search or the TV guide. |
| Back | Closes the overlay. |

## 6. TV guide (screenshot 4)

Opens from Home or the channel list. With guide data (XMLTV from the playlist or Settings → TV guide)
it shows a grid of channels and programmes with a red line at the current time. Arrows move through
programmes, Channel +/− pages, OK on a programme on air plays the channel. The test playlist has no
guide data, so each channel's row reads "No programme information".

## 7. Search (screenshot 5)

Type part of a channel name; results update as you type and ignore case and accents. Down moves into
the results, OK plays, Right then OK toggles the favorite star.

## 8. Settings

- **Sources** (screenshot 6 shows the form): add, edit, refresh or delete playlists.
- **TV guide**: extra XMLTV URL, time offset, refresh interval.
- **Parental control**: set a 4-digit PIN, then choose categories to lock. Locked categories show a lock
  and ask for the PIN.
- **About**: app version, TV model and webOS version, playback diagnostics, clear cache.

## 9. Magic Remote

The pointer works everywhere: hovering focuses, clicking selects, the wheel scrolls lists, and
clicking a star toggles the favorite without starting playback.
