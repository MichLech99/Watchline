const ALLOWED = ['/v1/search', '/v1/title/', '/v1/releases/', '/v1/sources/']

export default async (request) => {
  const apiKey = Netlify.env.get('WATCHMODE_API_KEY')
  if (!apiKey) return Response.json({ error: 'WATCHMODE_API_KEY non configurato' }, { status: 503 })

  const incoming = new URL(request.url)
  const path = incoming.searchParams.get('path') || ''
  if (!ALLOWED.some((prefix) => path.startsWith(prefix)) || path.includes('..')) {
    return Response.json({ error: 'Endpoint Watchmode non consentito' }, { status: 400 })
  }

  incoming.searchParams.delete('path')
  const target = `https://api.watchmode.com${path}?${incoming.searchParams.toString()}`
  const response = await fetch(target, {
    headers: { 'X-API-Key': apiKey, Accept: 'application/json' },
  })
  return new Response(response.body, {
    status: response.status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=1800, stale-while-revalidate=21600',
    },
  })
}
