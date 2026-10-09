/** Every user-facing string. Other languages get a dictionary with the same keys. */
const en = {
  appName: 'IPTV Player',
  'common.loading': 'Loading…',
  'common.cancel': 'Cancel',
  'common.retry': 'Try again',

  'home.favorites': 'Favorites',
  'home.recent': 'Recent',
  'home.all': 'All channels',
  'home.welcome': 'Add a playlist to start watching.',
  'home.welcomeDetail': 'Use an M3U playlist URL or an Xtream Codes login from your TV provider.',
  'home.addSource': 'Add a playlist',
  'home.search': 'Search',
  'home.noFavorites': 'No favorites yet. Hold OK on a channel, or press the red button, to add one.',
  'home.noRecents': 'Channels you watch appear here.',
  'home.noChannels': 'No channels in this category.',
  'home.locked': 'This category is locked.',
  'home.unlock': 'Unlock',

  'hint.watch': 'OK: watch',
  'hint.more': 'Hold OK: more',
  'hint.favorite': 'Favorite',
  'hint.move': 'Move',
  'hint.moving': 'Up/Down: move · OK: done',

  'menu.addFavorite': 'Add to favorites',
  'menu.removeFavorite': 'Remove from favorites',
  'menu.move': 'Move',

  'search.title': 'Search',
  'search.hint': 'Type part of a channel name. Results update as you type.',
  'search.label': 'Channel name',
  'search.results': '{count} channels',
  'search.none': 'No channels match “{query}”.',

  'pin.enter': 'Enter the PIN',
  'pin.wrong': 'Wrong PIN. Try again.',
  'pin.new': 'Choose a 4-digit PIN',
  'pin.confirm': 'Enter the new PIN again',
  'pin.mismatch': 'The PINs didn’t match. Choose a PIN again.',
  'pin.clear': 'Clear',
  'pin.delete': 'Delete',

  'parental.off': 'Parental control is off. Set a PIN to lock categories.',
  'parental.setPin': 'Set a PIN',
  'parental.unlockToEdit': 'Enter the PIN to change these settings.',
  'parental.changePin': 'Change PIN',
  'parental.turnOff': 'Turn off',
  'parental.categories': 'Locked categories (OK to lock or unlock)',
  'parental.locked': 'Locked',
  'parental.unlocked': 'Not locked',
  'parental.noCategories': 'No categories yet.',

  'settings.title': 'Settings',
  'settings.sources': 'Sources',
  'settings.guide': 'TV guide',
  'settings.parental': 'Parental control',
  'settings.about': 'About',
  'settings.notAvailable': 'Not available yet.',

  'sources.none': 'No sources yet.',
  'sources.add': 'Add a source',
  'sources.refresh': 'Refresh',
  'sources.edit': 'Edit',
  'sources.delete': 'Delete',
  'sources.deleteTitle': 'Delete “{name}”?',
  'sources.deleteMessage': 'Its channels are removed from this TV.',
  'sources.m3u': 'M3U playlist',
  'sources.xtream': 'Xtream Codes',
  'sources.channels': '{count} channels',
  'sources.updated': 'updated {date}',
  'sources.expires': 'Account expires {date}',
  'sources.noExpiry': 'Account does not expire',
  'sources.connections': '{count} connections allowed',

  'source.addTitle': 'Add a source',
  'source.editTitle': 'Edit source',
  'source.name': 'Name',
  'source.namePlaceholder': 'Shown in the source list',
  'source.url': 'Playlist URL',
  'source.host': 'Server address',
  'source.username': 'Username',
  'source.password': 'Password',
  'source.epgUrl': 'Guide (XMLTV) URL, optional',
  'source.save': 'Check and save',
  'source.required': 'Fill in “{field}”.',
  'source.saved': 'Saved: {count} channels.',

  'progress.connecting': 'Connecting…',
  'progress.download': 'Downloading… {size}',
  'progress.parse': 'Reading the channel list…',
  'progress.save': 'Saving {count} channels…',

  'error.network': 'Couldn’t reach the server. Check the address and the TV’s internet connection.',
  'error.http': 'The server answered with an error ({detail}).',
  'error.timeout': 'The server took too long to answer.',
  'error.auth': 'The server rejected the username or password.',
  'error.empty': 'The playlist has no channels.',
  'error.format': 'This doesn’t look like a playlist the app can read.',

  'exit.title': 'Exit IPTV Player?',
  'exit.confirm': 'Exit',
  'exit.cancel': 'Cancel',
} as const

export type StringKey = keyof typeof en

/** Looks up a string and fills `{name}` placeholders from `vars`. */
export function t(key: StringKey, vars?: Record<string, string | number>): string {
  const text: string = en[key]
  return vars ? text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match)) : text
}
