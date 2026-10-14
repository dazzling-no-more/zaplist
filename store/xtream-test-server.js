// A tiny Xtream Codes server for LG's testers, so they can try Zaplist's Xtream Codes login. It accepts
// one test account and serves the same free public test streams and guide as store/test-playlist.m3u,
// plus a few Blender Foundation open movies (CC BY) as movies and a test series.
//
// Runs as a Cloudflare Worker (free plan): Workers & Pages > Create > Create Worker, name it, Deploy,
// then Edit code, paste this file over the sample and Deploy again. In Zaplist, add an Xtream Codes
// source with the worker's address (https://<name>.<your-subdomain>.workers.dev) and the login below.

const USERNAME = 'zaplist'
const PASSWORD = 'review'
const GUIDE = 'https://raw.githubusercontent.com/dazzling-no-more/zaplist/main/store/test-guide.xml.gz'

const CATEGORIES = [
  { category_id: '1', category_name: 'Open movies', parent_id: 0 },
  { category_id: '2', category_name: 'Test streams', parent_id: 0 },
]

// One URL per stream; its extension decides which of the app's .m3u8 / .ts requests it answers.
const STREAMS = [
  { id: 101, name: 'Big Buck Bunny', category: '1', epg: 'bbb.zaplist', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8' },
  { id: 102, name: 'Tears of Steel', category: '1', epg: 'tos.zaplist', url: 'https://test-streams.mux.dev/tos_ismc/main.m3u8' },
  { id: 103, name: 'Angel One (several audio languages)', category: '1', epg: 'angel.zaplist', url: 'https://storage.googleapis.com/shaka-demo-assets/angel-one-hls/hls.m3u8' },
  {
    id: 104,
    name: 'Apple test stream (audio tracks and subtitles)',
    category: '2',
    epg: 'bipbop.zaplist',
    url: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8',
  },
  { id: 105, name: 'MPEG-TS test (10 seconds)', category: '2', epg: 'ts.zaplist', url: 'https://test-streams.mux.dev/x36xhzz/url_0/url_462/193039199_mp4_h264_aac_hd_7.ts' },
]

const poster = (file) => `https://upload.wikimedia.org/wikipedia/commons/thumb/${file}/330px-${file.split('/').pop()}`

const MOVIE_CATEGORIES = [{ category_id: '31', category_name: 'Open movies', parent_id: 0 }]
const MOVIES = [
  {
    id: 201,
    name: 'Big Buck Bunny',
    ext: 'm3u8',
    url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    icon: poster('c/c5/Big_buck_bunny_poster_big.jpg'),
    year: '2008',
    genre: 'Animation, Comedy',
    plot: 'A giant rabbit takes on three forest bullies. Blender Foundation open movie (CC BY 3.0).',
  },
  {
    id: 202,
    name: 'Tears of Steel',
    ext: 'm3u8',
    url: 'https://test-streams.mux.dev/tos_ismc/main.m3u8',
    icon: poster('7/70/Tos-poster.png'),
    year: '2012',
    genre: 'Science fiction',
    plot: 'Warriors and scientists try to save the world from destructive robots in Amsterdam. Blender Foundation open movie (CC BY 3.0).',
  },
  {
    id: 203,
    name: 'Sintel (trailer)',
    ext: 'mp4',
    url: 'https://download.blender.org/durian/trailer/sintel_trailer-480p.mp4',
    icon: poster('8/8f/Sintel_poster.jpg'),
    year: '2010',
    genre: 'Animation, Fantasy',
    plot: 'A girl searches for her baby dragon. Trailer of the Blender Foundation open movie (CC BY 3.0).',
  },
]

const SERIES_CATEGORIES = [{ category_id: '41', category_name: 'Test series', parent_id: 0 }]
const SERIES = [
  {
    series_id: 301,
    name: 'Zaplist test series',
    cover: poster('0/0c/ElephantsDreamPoster.jpg'),
    plot: 'Test streams for playback features: several audio languages, subtitles and an MP4 file.',
    releaseDate: '2026',
    category_id: '41',
  },
]
const EPISODES = {
  1: [
    { id: 401, episode_num: 1, season: 1, title: 'Audio languages', ext: 'm3u8', url: 'https://storage.googleapis.com/shaka-demo-assets/angel-one-hls/hls.m3u8' },
    {
      id: 402,
      episode_num: 2,
      season: 1,
      title: 'Subtitles',
      ext: 'm3u8',
      url: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8',
    },
  ],
  2: [{ id: 403, episode_num: 1, season: 2, title: 'MP4 file', ext: 'mp4', url: 'https://download.blender.org/durian/trailer/sintel_trailer-480p.mp4' }],
}

const CORS = { 'access-control-allow-origin': '*' }
const json = (body) => new Response(JSON.stringify(body), { headers: { ...CORS, 'content-type': 'application/json' } })
const notFound = () => new Response('Not found', { status: 404, headers: CORS })

export default {
  async fetch(request) {
    const url = new URL(request.url)
    const query = url.searchParams
    const loggedIn = query.get('username') === USERNAME && query.get('password') === PASSWORD

    if (url.pathname === '/player_api.php') {
      if (!loggedIn) return json({ user_info: { auth: 0, message: 'Wrong username or password' } })
      const action = query.get('action')
      if (!action) {
        return json({
          user_info: {
            username: USERNAME,
            auth: 1,
            status: 'Active',
            exp_date: null, // doesn't expire
            is_trial: '0',
            active_cons: '0',
            max_connections: '1',
            allowed_output_formats: ['m3u8', 'ts'],
            message: 'Zaplist test server',
          },
          server_info: { url: url.hostname, server_protocol: url.protocol.replace(':', ''), timestamp_now: Math.floor(Date.now() / 1000) },
        })
      }
      if (action === 'get_live_categories') return json(CATEGORIES)
      if (action === 'get_live_streams') {
        return json(
          STREAMS.map((s, i) => ({
            num: i + 1,
            name: s.name,
            stream_type: 'live',
            stream_id: s.id,
            stream_icon: '',
            epg_channel_id: s.epg,
            category_id: s.category,
            tv_archive: 0,
          })),
        )
      }
      if (action === 'get_short_epg') return json({ epg_listings: [] }) // the full guide comes from xmltv.php
      if (action === 'get_vod_categories') return json(MOVIE_CATEGORIES)
      if (action === 'get_vod_streams') {
        return json(
          MOVIES.map((m, i) => ({
            num: i + 1,
            name: m.name,
            stream_type: 'movie',
            stream_id: m.id,
            stream_icon: m.icon,
            category_id: '31',
            container_extension: m.ext,
          })),
        )
      }
      if (action === 'get_vod_info') {
        const movie = MOVIES.find((m) => m.id === Number(query.get('vod_id')))
        if (!movie) return json({ info: [], movie_data: [] })
        return json({
          info: { plot: movie.plot, releasedate: movie.year, genre: movie.genre, movie_image: movie.icon },
          movie_data: { stream_id: movie.id, name: movie.name, container_extension: movie.ext },
        })
      }
      if (action === 'get_series_categories') return json(SERIES_CATEGORIES)
      if (action === 'get_series') return json(SERIES)
      if (action === 'get_series_info') {
        const series = SERIES.find((s) => s.series_id === Number(query.get('series_id')))
        if (!series) return json({ seasons: [], info: [], episodes: [] })
        const episodes = {}
        for (const season of Object.keys(EPISODES)) {
          episodes[season] = EPISODES[season].map(({ ext, url: _url, ...episode }) => ({ ...episode, container_extension: ext, info: {} }))
        }
        return json({ seasons: [], info: { name: series.name, plot: series.plot, cover: series.cover }, episodes })
      }
      return json([])
    }

    if (url.pathname === '/xmltv.php') {
      if (!loggedIn) return new Response('Unauthorized', { status: 401, headers: CORS })
      const guide = await fetch(GUIDE)
      return new Response(guide.body, { status: guide.status, headers: { ...CORS, 'content-type': 'application/gzip' } })
    }

    // /live/<username>/<password>/<stream_id>.<m3u8|ts>
    const live = /^\/live\/([^/]+)\/([^/]+)\/(\d+)\.(m3u8|ts)$/.exec(url.pathname)
    if (live) {
      if (decodeURIComponent(live[1]) !== USERNAME || decodeURIComponent(live[2]) !== PASSWORD) return new Response('Forbidden', { status: 403, headers: CORS })
      const stream = STREAMS.find((s) => s.id === Number(live[3]))
      if (!stream || !stream.url.endsWith('.' + live[4])) return notFound()
      return new Response(null, { status: 302, headers: { ...CORS, location: stream.url } })
    }

    // /movie/<username>/<password>/<vod_id>.<ext> and /series/<username>/<password>/<episode_id>.<ext>
    const file = /^\/(movie|series)\/([^/]+)\/([^/]+)\/(\d+)\.(\w+)$/.exec(url.pathname)
    if (file) {
      if (decodeURIComponent(file[2]) !== USERNAME || decodeURIComponent(file[3]) !== PASSWORD) return new Response('Forbidden', { status: 403, headers: CORS })
      const items = file[1] === 'movie' ? MOVIES : Object.values(EPISODES).flat()
      const item = items.find((i) => i.id === Number(file[4]))
      if (!item || item.ext !== file[5]) return notFound()
      return new Response(null, { status: 302, headers: { ...CORS, location: item.url } })
    }

    if (url.pathname === '/') return new Response('Zaplist test server for LG app review.\n', { headers: { ...CORS, 'content-type': 'text/plain' } })
    return notFound()
  },
}
