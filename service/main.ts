// The app's JS service (webOS 5 and newer: Node.js 8 or later). The TV's player can't decode Opus
// audio, so movies with it stream through a local server here that turns the audio into PCM
// (remux.ts). Built by scripts/build-service.mjs; the app calls it from src/player/engines.ts.
import { startServer, stopPlayback } from './server'

/** `<app ID>.service`, set by the build. */
declare const SERVICE_ID: string
// Provided by the webOS service runtime.
const Service = require('webos-service')

interface Message {
  isSubscription: boolean
  uniqueToken: string
  respond(response: Record<string, unknown>): void
}

/** How long the service stays up after the app stops playing through it: a resume or replay soon after finds it running, the movie's header and cues still read. */
const LINGER_MS = 60000

const service = new Service(SERVICE_ID)
const subscribers: { [token: string]: true } = {}
let keepAlive: unknown
let linger: ReturnType<typeof setTimeout> | undefined

// The app subscribes to `start` while it plays a movie through the service. webOS stops services
// that look idle; the open subscription and a keep-alive activity hold it up until the app cancels,
// and LINGER_MS longer.
const start = service.register('start')
start.on('request', (message: Message) => {
  if (message.isSubscription) {
    subscribers[message.uniqueToken] = true
    clearTimeout(linger)
    if (!keepAlive) service.activityManager.create('keepAlive', (activity: unknown) => (keepAlive = activity))
  }
  startServer().then(
    (port) => message.respond({ returnValue: true, port }),
    (error: Error) => message.respond({ returnValue: false, errorText: error.message }),
  )
})
start.on('cancel', (message: Message) => {
  delete subscribers[message.uniqueToken]
  if (Object.keys(subscribers).length) return
  stopPlayback() // the connection to the IPTV server closes now
  clearTimeout(linger)
  linger = setTimeout(() => {
    if (keepAlive) service.activityManager.complete(keepAlive, () => undefined)
    keepAlive = undefined
  }, LINGER_MS)
})
