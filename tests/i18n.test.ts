import { describe, expect, it } from 'vitest'
import { t } from '../src/i18n'

describe('t', () => {
  it('fills placeholders and picks the singular or plural form by count', () => {
    expect(t('sources.channels', { count: 1 })).toBe('1 channel')
    expect(t('sources.channels', { count: '1' })).toBe('1 channel')
    expect(t('sources.channels', { count: '1,204' })).toBe('1,204 channels')
    expect(t('sources.channels', { count: 0 })).toBe('0 channels')
    expect(t('search.none', { query: 'x' })).toBe('Nothing matches “x”.')
  })
})
