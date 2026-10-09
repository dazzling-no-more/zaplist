/** Every user-facing string. Other languages get a dictionary with the same keys. */
const en = {
  appName: 'IPTV Player',
  'home.favorites': 'Favorites',
  'home.recent': 'Recent',
  'home.all': 'All channels',
  'home.empty': 'No channels yet. Add a playlist in Settings.',
  'home.openSettings': 'Open Settings',
  'settings.title': 'Settings',
  'settings.sources': 'Sources',
  'settings.guide': 'TV guide',
  'settings.parental': 'Parental control',
  'settings.about': 'About',
  'settings.notAvailable': 'Not available yet.',
  'exit.title': 'Exit IPTV Player?',
  'exit.confirm': 'Exit',
  'exit.cancel': 'Cancel',
} as const

export type StringKey = keyof typeof en

export const t = (key: StringKey): string => en[key]
