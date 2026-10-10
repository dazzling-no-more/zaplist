"""Fills in LG's Self Checklist (self_evaluation_checklist_*.xlsx in "documents for app QA") for Zaplist.

    python store/lg-qa/self-checklist.py [--tv-verified] [--template path/to/self_evaluation_checklist_5.0.xlsx]

Writes store/lg-qa/Zaplist_Self_Checklist_<version>.xlsx. Only LG's input columns are written: the
test result and the developer comment. LG wants results of a test on a TV: without --tv-verified,
the items that need one are left empty (N/A items, which follow from what the app is, are filled),
and so is the check that no other app in the LG Content Store is called Zaplist. Run the TV test in
docs/PUBLISHING.md (it includes that store search), fix or mark Fail anything that doesn't pass,
then build the file again with --tv-verified. The image facts the file declares are checked on
every run. Needs openpyxl and Pillow.
"""

import argparse
import io
import json
import pathlib
import urllib.request
import zipfile

import openpyxl
from PIL import Image

QA_DOCUMENTS = 'https://webostv.developer.lge.com/assets/checklist/documents_for_app_qa.zip'

# Self-Checklist_Input Required: item number -> (result, developer comment)
ITEMS = {
    1: ('Pass', 'Opens at the welcome screen on first launch, otherwise at Home. If a channel was playing when the app closed, it opens again.'),
    2: ('Pass', 'Splash image while loading, then Home. All buttons, text and logos stay inside the overscan safe area (96 px left/right, 54 px top/bottom at 1920x1080).'),
    3: ('Pass', 'Playlists, favorites and settings are stored on the TV; after relaunching or turning the TV off and on, the app opens with the same data and reopens the last channel.'),
    4: ('NA', 'No advertisements.'),
    5: ('Pass', 'Designed for 1920x1080 (appinfo.json resolution), 16:9.'),
    6: ('Pass', 'Long channel, category and programme names end with an ellipsis; long lists scroll.'),
    7: ('Pass', 'The focused item is shown inverted (white); the selected category has a blue mark; hovering with the pointer moves the focus.'),
    8: ('Pass', ''),
    9: ('Pass', 'Video fills the screen in Fit mode; Zoom, Fill, 16:9 and 4:3 are on the Picture button and the yellow key.'),
    10: ('Pass', 'All buttons work as described in the UX scenario.'),
    11: ('NA', 'No on-screen Back button; the remote\'s Back key is used (optional on webOS).'),
    12: ('NA', 'No on-screen Exit button.'),
    13: ('Pass', ''),
    14: ('Pass', 'If the network drops, a message shows and playback resumes when the connection returns.'),
    15: ('Pass', 'Playlist name and URL, Xtream login, guide URL and search are standard input fields using the LG virtual keyboard. Playlists can also be typed on a phone through the QR code on the form.'),
    16: ('Pass', ''),
    17: ('Pass', 'Standard input fields: the keyboard\'s own buttons, including voice input, enter text normally.'),
    18: ('NA', 'No terms of service.'),
    19: ('NA', 'No sign-up: the app has no user accounts.'),
    20: ('NA', 'No sign-in: the app has no user accounts. Xtream Codes logins belong to the user\'s IPTV provider and are saved as playlist settings (UX scenario, 4).'),
    21: ('NA', 'No sign-out: the app has no user accounts.'),
    22: ('Pass', 'Searches channel names while typing, ignoring case and accents; shows a message when nothing matches.'),
    23: ('NA', 'The app has no content of its own. Users can lock any category of their playlists with a 4-digit PIN (Settings > Parental control); see UX scenario 6-8 to 6-10.'),
    24: ('NA', 'Free; no in-app purchases.'),
    25: ('NA', 'Free; no payments.'),
    26: ('Pass', 'Arrow keys, OK, Back, CH +/-, 0-9, red, yellow, Info, Play/Pause/Stop; see UX scenario, 3.'),
    27: ('Pass', 'Every screen works with the Magic Remote.'),
    28: ('Pass', ''),
    29: ('Pass', ''),
    30: ('Pass', 'The wheel scrolls every list and the TV guide.'),
    31: ('Pass', ''),
    32: ('Pass', 'Red: favorite. Yellow: picture mode in the player, move a channel in Favorites. Both also have on-screen buttons.'),
    33: ('Pass', ''),
    34: ('NA', 'The app supports the standard remote as well as the Magic Remote.'),
    35: ('NA', 'The app supports the standard remote as well as the Magic Remote.'),
    36: ('Pass', 'Handled by the TV; playback stops while the app is hidden and resumes when it is shown again.'),
    37: ('Pass', 'Closes the open overlay or goes back one screen; on the first screen it calls webOS.platformBack() (system exit popup or Home screen).'),
    38: ('Pass', 'Handled by the TV.'),
    39: ('NA', 'Applies to NetCast 4.5 / webOS 1.0 remotes; the app requires webOS TV 4.0 or later.'),
    40: ('Pass', 'Keys the app does not use are ignored.'),
    41: ('NA', 'English only; no language setting.'),
    42: ('NA', 'No background music or sound effects; the only sound is the audio of the streams.'),
    43: ('Pass', 'HLS streams adapt their bit rate to the connection (TV player or hls.js); MPEG-TS plays through mpegts.js. Use the test playlist from the UX scenario.'),
    44: ('Pass', 'Picture button or yellow key: Fit, Zoom, Fill, 16:9, 4:3.'),
    45: ('Pass', 'Live TV: Play/Pause button in the info bar and the Play, Pause and Stop keys; channel up/down instead of previous/next. No seek, fast forward or rewind: the streams are live.'),
    46: ('NA', 'Live channels only; no series or video on demand.'),
    47: ('Pass', ''),
    48: ('Pass', 'The Subtitles button lists the stream\'s subtitle tracks ("Angel One" in the test playlist has four, "Apple test stream" one).'),
    49: ('NA', 'No video on demand; on launch the app reopens the last channel.'),
    50: ('Pass', 'Plays the resolutions the user\'s streams provide; the test playlist has SD to Full HD streams.'),
    51: ('Pass', 'Plays the codecs the TV supports (e.g. H.264, AAC) through the TV\'s player or Media Source Extensions.'),
    52: ('NA', 'No paid or DRM-protected content.'),
    53: ('Pass', 'Nothing device-specific is stored; after a reset and reinstall the app starts at the welcome screen.'),
}

# Other Check Points: item number -> comment. "Pass" means none of the listed problems applies.
OTHER = {
    1: 'Title "Zaplist" is a coined name.',
    3: 'Web and trademark searches found no app or trademark named Zaplist.',
    4: 'Seller is not LG and the listing does not suggest it.',
    5: 'The LG Content Store on the TV lists no other app called Zaplist.',
    6: 'Square 400x400 icon, square corners, opaque background.',
    7: 'Square corners.',
    8: 'Opaque background.',
    9: 'Screenshots show the app with demo channel names and Blender Foundation open movies (CC BY).',
    10: 'Six different screenshots.',
    14: 'Launcher and splash background: 1920x1080 image (public/splash.png).',
    15: 'Title, description and app are in English; Geo-IP block is set to No in the submission.',
    16: 'The app has no content of its own: users play their own playlists. Categories can be locked with a PIN.',
}
# Other Check Points known only after searching the LG Content Store on a TV.
NEEDS_TV = {5}


def check_images(root: pathlib.Path) -> None:
    """Stops instead of declaring Other Check Points 6, 8, 10 and 14 for images that don't meet them."""
    for name, size in (('store/icon-400.png', 400), ('public/icon.png', 80), ('public/largeIcon.png', 130)):
        icon = Image.open(root / name)
        assert icon.size == (size, size), f'{name} must be {size}x{size}'
        assert 'A' not in icon.getbands() or icon.getchannel('A').getextrema() == (255, 255), f'{name} must be opaque'
    assert Image.open(root / 'public/splash.png').size == (1920, 1080), 'public/splash.png must be 1920x1080'
    shots = [path.read_bytes() for path in (root / 'store/screenshots').glob('*.png')]
    assert len(set(shots)) == len(shots), 'store/screenshots has duplicate images'


def template_path(arg: str | None) -> io.BytesIO | pathlib.Path:
    if arg:
        return pathlib.Path(arg)
    with urllib.request.urlopen(QA_DOCUMENTS) as response:
        archive = zipfile.ZipFile(io.BytesIO(response.read()))
    name = next(n for n in archive.namelist() if n.startswith('self_evaluation_checklist') and n.endswith('.xlsx'))
    return io.BytesIO(archive.read(name))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--template')
    parser.add_argument('--tv-verified', action='store_true', help='every item marked Pass was checked on a TV, including the store search')
    args = parser.parse_args()

    here = pathlib.Path(__file__).resolve().parent
    check_images(here.parents[1])
    version = json.loads((here.parents[1] / 'appinfo.json').read_text(encoding='utf-8'))['version']
    book = openpyxl.load_workbook(template_path(args.template))

    checklist = book['Self-Checklist_Input Required']
    filled = 0
    for row in range(5, checklist.max_row + 1):
        number = checklist[f'B{row}'].value
        if number is None or not str(number).isdigit() or int(number) not in ITEMS:
            continue
        result, comment = ITEMS[int(number)]
        checklist[f'N{row}'] = result if result == 'NA' or args.tv_verified else None
        checklist[f'O{row}'] = comment or None
        filled += 1
    assert filled == len(ITEMS), f'filled {filled} of {len(ITEMS)} items: the template layout changed'

    other = book['Other Check Points']
    count = 0
    for row in range(4, other.max_row + 1):
        number = other[f'B{row}'].value
        if number is None or not str(number).isdigit():
            continue
        known = int(number) not in NEEDS_TV or args.tv_verified
        other[f'G{row}'] = 'Pass' if known else None
        other[f'H{row}'] = OTHER.get(int(number)) if known else None
        count += 1
    assert count == 51, f'found {count} other check points: the template layout changed'

    out = here / f'Zaplist_Self_Checklist_{version}.xlsx'
    book.save(out)
    pending = 0 if args.tv_verified else sum(1 for result, _ in ITEMS.values() if result != 'NA') + len(NEEDS_TV)
    print(f'Wrote {out} ({filled} test items, {count} other check points)')
    if pending:
        print(f'{pending} results are empty until the TV test: build again with --tv-verified after it passes.')


if __name__ == '__main__':
    main()
