// Relay for Zaplist's "Add from your phone" (Cloudflare Worker with a Durable Object; deploy with
// wrangler.toml next to this file). The TV shows a QR code linking to the page below; the link's
// #fragment holds a session id and an AES key. The page encrypts what the user enters with that key
// and posts it to /s/<id>; the TV fetches it from there and decrypts it. Browsers never send the
// #fragment, so the key doesn't reach this server: it only holds data it can't read, and drops it
// once the TV has it or after 15 minutes.

const TTL_MS = 15 * 60 * 1000
const MAX_BYTES = 8192
/** Messages a session takes before it expires: a person sends one, or a few after a typo. */
const MAX_POSTS = 20
const SESSION_PATH = /^\/s\/([A-Za-z0-9_-]{22})(\/status)?$/

const tooLarge = () => new Response('Too large', { status: 413 })

/** The request's body as text, read no further than `max` bytes; undefined if it is longer. */
async function readText(request, max) {
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks = []
  let length = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.length
    if (length > max) {
      await reader.cancel()
      return undefined
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(length)
  let at = 0
  for (const chunk of chunks) {
    bytes.set(chunk, at)
    at += chunk.length
  }
  return new TextDecoder().decode(bytes)
}

/** One session: the latest message from the phone, until the TV fetches it. */
export class Session {
  constructor(state) {
    this.storage = state.storage
  }

  async fetch(request) {
    const status = new URL(request.url).pathname.endsWith('/status')
    if (request.method === 'POST' && !status) {
      const posts = ((await this.storage.get('posts')) || 0) + 1
      if (posts > MAX_POSTS) return new Response('Too many messages', { status: 429 })
      const body = await readText(request, MAX_BYTES)
      if (body === undefined) return tooLarge()
      await this.storage.put({ message: body, delivered: false, posts })
      await this.storage.setAlarm(Date.now() + TTL_MS)
      return new Response(null, { status: 204 })
    }
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 })
    // The phone page asks whether the TV has picked the message up.
    if (status) return Response.json({ delivered: (await this.storage.get('delivered')) === true })
    const message = await this.storage.get('message')
    if (message === undefined) return new Response(null, { status: 204 })
    await this.storage.delete('message')
    await this.storage.put('delivered', true)
    return new Response(message, { headers: { 'content-type': 'application/json' } })
  }

  async alarm() {
    await this.storage.deleteAll()
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const session = SESSION_PATH.exec(url.pathname)
    if (session) {
      if (Number(request.headers.get('content-length')) > MAX_BYTES) return tooLarge()
      // Per client address, when the binding is configured (wrangler.toml): a TV polls every 3 s.
      if (env.LIMITER && !(await env.LIMITER.limit({ key: request.headers.get('cf-connecting-ip') || '' })).success) {
        return new Response('Too many requests', { status: 429, headers: { 'access-control-allow-origin': '*' } })
      }
      const response = await env.SESSIONS.get(env.SESSIONS.idFromName(session[1])).fetch(request)
      const headers = new Headers(response.headers)
      headers.set('access-control-allow-origin', '*') // the TV app's own origin is file://
      headers.set('cache-control', 'no-store')
      return new Response(response.body, { status: response.status, headers })
    }
    if (url.pathname === '/' && request.method === 'GET') return new Response(PAGE, { headers: PAGE_HEADERS })
    return new Response('Not found', { status: 404 })
  },
}

const PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'content-security-policy':
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'cache-control': 'no-cache',
}

// The phone page. Its fields match the TV's "Add a source" form.
const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Zaplist: add a playlist</title>
<style>
:root { color-scheme: light dark; --bg: #f3f5f9; --card: #fff; --text: #151922; --dim: #5a6271; --line: #d3d8e1; --accent: #2f6fde; --error: #c62828; --ok: #1b7f3b }
@media (prefers-color-scheme: dark) {
  :root { --bg: #0e1116; --card: #181c24; --text: #eef1f6; --dim: #9ba4b3; --line: #2d3441; --accent: #5b9bff; --error: #ff7070; --ok: #5fd38b }
}
* { box-sizing: border-box }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif }
main { max-width: 480px; margin: 0 auto; padding: 24px 16px 40px }
h1 { margin: 0 0 6px; font-size: 22px }
p { margin: 0 0 16px; color: var(--dim) }
form { padding: 16px; border: 1px solid var(--line); border-radius: 14px; background: var(--card) }
.tabs { display: flex; margin-bottom: 16px; padding: 3px; border-radius: 10px; background: var(--bg) }
.tabs button { flex: 1; margin: 0; padding: 9px 4px; border: 0; border-radius: 8px; background: transparent; color: var(--dim); font: inherit; font-weight: 600 }
.tabs button[aria-pressed="true"] { background: var(--card); color: var(--text); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2) }
label { display: block; margin-bottom: 14px; font-size: 14px; font-weight: 600 }
input { display: block; width: 100%; margin-top: 6px; padding: 12px; border: 1px solid var(--line); border-radius: 10px; background: transparent; color: inherit; font: inherit; font-weight: 400 }
input:focus { border-color: var(--accent); outline: none }
.send { width: 100%; margin-top: 4px; padding: 13px; border: 0; border-radius: 10px; background: var(--accent); color: #fff; font: inherit; font-weight: 600 }
.send:disabled { opacity: 0.6 }
.status { min-height: 1.45em; margin: 12px 0 0 }
.status.error { color: var(--error) }
.status.ok { color: var(--ok) }
.note { margin-top: 16px; font-size: 13px }
[hidden] { display: none !important }
</style>
</head>
<body>
<main>
  <h1>Add a playlist to Zaplist</h1>
  <p id="intro">Enter your playlist here. It appears on your TV, ready to save.</p>
  <form id="form" hidden novalidate>
    <div class="tabs">
      <button type="button" id="tab-m3u" aria-pressed="true">M3U playlist</button>
      <button type="button" id="tab-xtream" aria-pressed="false">Xtream Codes</button>
    </div>
    <label>Name, optional<input id="name" autocomplete="off" placeholder="Shown in the source list"></label>
    <div id="m3u">
      <label>Playlist URL<input id="url" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="http://"></label>
    </div>
    <div id="xtream" hidden>
      <label>Server address<input id="host" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="http://host:port"></label>
      <label>Username<input id="username" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <label>Password<input id="password" type="password" autocomplete="off"></label>
    </div>
    <label>Guide (XMLTV) URL, optional<input id="epg" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="http://"></label>
    <button class="send" id="send">Send to TV</button>
    <p class="status" id="status" role="status"></p>
  </form>
  <p class="note">Encrypted on this phone with a key from the code on your TV. The relay passes it on without being able to read it and deletes it within 15 minutes.</p>
</main>
<script>
(function () {
  var $ = function (id) { return document.getElementById(id) }
  var status = function (text, kind) { $('status').textContent = text; $('status').className = 'status' + (kind ? ' ' + kind : '') }
  var parts = location.hash.slice(1).split('.')
  var valid = parts.length === 2 && /^[A-Za-z0-9_-]{22}$/.test(parts[0]) && /^[A-Za-z0-9_-]{22}$/.test(parts[1])
  if (!valid || !window.crypto || !crypto.subtle) {
    $('intro').textContent = valid
      ? 'This browser can\\'t encrypt the playlist. Open the link in another browser.'
      : 'Open this page by scanning the code on the "Add a source" screen of Zaplist on your TV.'
    return
  }
  var id = parts[0]
  var decode = function (text) { var s = atob(text.replace(/-/g, '+').replace(/_/g, '/')); var b = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b }
  var encode = function (bytes) { var s = ''; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '') }
  var keyPromise = crypto.subtle.importKey('raw', decode(parts[1]), 'AES-GCM', false, ['encrypt'])
  var kind = 'm3u'
  var setKind = function (next) {
    kind = next
    $('tab-m3u').setAttribute('aria-pressed', String(kind === 'm3u'))
    $('tab-xtream').setAttribute('aria-pressed', String(kind === 'xtream'))
    $('m3u').hidden = kind !== 'm3u'
    $('xtream').hidden = kind !== 'xtream'
  }
  $('tab-m3u').onclick = function () { setKind('m3u') }
  $('tab-xtream').onclick = function () { setKind('xtream') }
  $('form').hidden = false
  var value = function (field) { return $(field).value.trim() }
  var waiting = 0
  $('form').onsubmit = function (event) {
    event.preventDefault()
    var entry = { v: 1, kind: kind, name: value('name'), epgUrl: value('epg') }
    if (kind === 'm3u') entry.url = value('url')
    else { entry.host = value('host'); entry.username = value('username'); entry.password = $('password').value }
    var missing = kind === 'm3u' ? (!entry.url && 'the playlist URL') : (!entry.host && 'the server address') || (!entry.username && 'the username') || (!entry.password && 'the password')
    if (missing) return status('Enter ' + missing + '.', 'error')
    $('send').disabled = true
    status('Sending\\u2026')
    var iv = crypto.getRandomValues(new Uint8Array(12))
    keyPromise
      .then(function (key) { return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(JSON.stringify(entry))) })
      .then(function (data) { return fetch('/s/' + id, { method: 'POST', body: JSON.stringify({ iv: encode(iv), data: encode(new Uint8Array(data)) }) }) })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status)
        status('Sent. Waiting for your TV\\u2026')
        var round = ++waiting
        var started = Date.now()
        var check = function () {
          if (round !== waiting) return
          fetch('/s/' + id + '/status').then(function (r) { return r.json() }).then(function (s) {
            if (s.delivered) return status('Your TV has it. Check it there and press \\u201cCheck and save\\u201d.', 'ok')
            if (Date.now() - started > 120000) return status('Your TV hasn\\'t picked it up yet. Keep its \\u201cAdd a source\\u201d screen open: it appears there within 15 minutes.')
            setTimeout(check, 2000)
          }, function () { setTimeout(check, 4000) })
        }
        setTimeout(check, 1500)
      })
      .catch(function () { status('Couldn\\'t send it. Check the phone\\'s internet connection and try again.', 'error') })
      .then(function () { $('send').disabled = false })
  }
})()
</script>
</body>
</html>
`
