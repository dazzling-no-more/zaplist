import { describe, expect, it } from 'vitest'
import { startServer, TOKEN } from '../service/server'

describe('service server', () => {
  it('answers the app and the TV’s player, not web pages open in the TV’s browser', async () => {
    const root = `http://127.0.0.1:${await startServer()}`
    const status = async (headers: Record<string, string>, base = `${root}/${TOKEN}`) => (await fetch(`${base}/subs`, { headers })).status
    expect(await status({})).toBe(200) // the TV's player
    expect(await status({ Origin: 'null' })).toBe(200) // the app, a file:// page
    expect(await status({}, root)).toBe(403) // a page that doesn't know the token
    expect(await status({ Origin: 'https://site.example' })).toBe(403)
    expect(await status({ Referer: 'https://site.example/page' })).toBe(403)
  })
})
