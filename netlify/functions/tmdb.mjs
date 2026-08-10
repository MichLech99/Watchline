const ALLOWED = [
  '/3/search/', '/3/trending/', '/3/discover/', '/3/movie/', '/3/tv/',
  '/3/genre/', '/3/watch/providers/', '/3/configuration',
]

export default async (request) => {
  const token = Netlify.env.get('TMDB_READ_TOKEN')
  if (!token) return Response.json({ error: 'TMDB_READ_TOKEN non configurato' }, { status: 503 })

  const incoming = new URL(request.url)
  const path = incoming.searchParams.get('path') || ''
  if (!ALLOWED.some((prefix) => path.startsWith(prefix)) || path.includes('..')) {
    return Response.json({ error: 'Endpoint non consentito' }, { status: 400 })
  }

  incoming.searchParams.delete('path')
  if (!incoming.searchParams.has('language')) incoming.searchParams.set('language', 'it-IT')
  const target = new URL(path, 'https://api.themoviedb.org')
  incoming.searchParams.forEach((value, key) => target.searchParams.set(key, value))
  const response = await fetch(target, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  return new Response(response.body, {
    status: response.status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': path.includes('/search/') ? 'public, max-age=300' : 'public, max-age=1800, stale-while-revalidate=21600',
    },
  })
}
