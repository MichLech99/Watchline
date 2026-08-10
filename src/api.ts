import type { Episode, MediaItem, TmdbEpisode, TmdbResult, WatchProvider } from './types'

export type ExploreFeed = 'popular' | 'trending' | 'upcoming' | 'top-rated' | 'cinema'

export const CATALOG_GENRES = [
  'Azione', 'Avventura', 'Animazione', 'Commedia', 'Crime', 'Documentario', 'Drama', 'Famiglia', 'Fantasy', 'Horror', 'Mistero', 'Musica', 'Romance', 'Fantascienza', 'Thriller', 'Storia', 'Guerra', 'Western', 'Film TV', 'Reality', 'Kids', 'Notiziari', 'Sci-Fi & Fantasy', 'Soap', 'Talk', 'Azione e avventura', 'Guerra e politica',
] as const
export type CatalogGenre = typeof CATALOG_GENRES[number]

const CATALOG_GENRE_IDS: Record<CatalogGenre, Partial<Record<'movie' | 'tv', number>>> = {
  'Azione': { movie: 28 }, 'Avventura': { movie: 12 }, 'Animazione': { movie: 16, tv: 16 }, 'Commedia': { movie: 35, tv: 35 }, 'Crime': { movie: 80, tv: 80 }, 'Documentario': { movie: 99, tv: 99 }, 'Drama': { movie: 18, tv: 18 }, 'Famiglia': { movie: 10751, tv: 10751 }, 'Fantasy': { movie: 14 }, 'Horror': { movie: 27 }, 'Mistero': { movie: 9648, tv: 9648 }, 'Musica': { movie: 10402 }, 'Romance': { movie: 10749 }, 'Fantascienza': { movie: 878 }, 'Thriller': { movie: 53 }, 'Storia': { movie: 36 }, 'Guerra': { movie: 10752 }, 'Western': { movie: 37, tv: 37 }, 'Film TV': { movie: 10770 }, 'Reality': { tv: 10764 }, 'Kids': { tv: 10762 }, 'Notiziari': { tv: 10763 }, 'Sci-Fi & Fantasy': { tv: 10765 }, 'Soap': { tv: 10766 }, 'Talk': { tv: 10767 }, 'Azione e avventura': { tv: 10759 }, 'Guerra e politica': { tv: 10768 },
}

const GENRES: Record<number, string> = {
  12: 'Avventura', 14: 'Fantasy', 16: 'Animazione', 18: 'Drama', 27: 'Horror', 28: 'Azione',
  35: 'Commedia', 36: 'Storia', 53: 'Thriller', 80: 'Crime', 878: 'Fantascienza', 9648: 'Mistero',
  99: 'Documentario', 10402: 'Musica', 10749: 'Romance', 10751: 'Famiglia', 10752: 'Guerra', 10759: 'Azione e avventura', 10762: 'Kids', 10763: 'Notiziari', 10764: 'Reality', 10765: 'Sci-Fi & Fantasy', 10766: 'Soap', 10767: 'Talk', 10768: 'Guerra e politica', 10770: 'Film TV', 37: 'Western',
}

const GENRE_IDS_BY_NAME = Object.fromEntries(Object.entries(GENRES).map(([id, name]) => [name, Number(id)])) as Record<string, number>

export const getCatalogGenresForType = (type: 'all' | 'tv' | 'movie') =>
  CATALOG_GENRES.filter((genre) => type === 'all' || Boolean(CATALOG_GENRE_IDS[genre][type]))

export const getGenreIdsForNames = (genres: readonly string[]) =>
  [...new Set(genres.map((genre) => GENRE_IDS_BY_NAME[genre]).filter((id): id is number => Number.isInteger(id)))]

export const getCatalogGenreIds = (genres: readonly string[]) =>
  [...new Set(genres.flatMap((genre) => Object.values(CATALOG_GENRE_IDS[genre as CatalogGenre] || {})).filter((id): id is number => Number.isInteger(id)))]

export const getCatalogGenresForIds = (genreIds: readonly number[]) => {
  const ids = new Set(genreIds)
  return CATALOG_GENRES.filter((genre) => Object.values(CATALOG_GENRE_IDS[genre]).some((id) => ids.has(id)))
}

export const getItemGenreIds = (item: Pick<MediaItem, 'genres' | 'genreIds'>) =>
  item.genreIds?.length ? item.genreIds : getGenreIdsForNames(item.genres)

export const itemMatchesCatalogGenres = (item: MediaItem, selectedGenres: CatalogGenre[]) =>
  !selectedGenres.length || selectedGenres.some((genre) => {
    const genreId = CATALOG_GENRE_IDS[genre][item.type]
    return Boolean(genreId && getItemGenreIds(item).includes(genreId))
  })
const exploreCache = new Map<string, MediaItem[]>()
const watchmodeCache = new Map<number, Partial<MediaItem> | null>()
let upcomingSeriesCache: MediaItem[] | null = null

const isFutureDate = (value?: string) => Boolean(value && value >= new Date().toISOString().slice(0, 10))

const endpoint = (path: string, params: Record<string, string> = {}) => {
  const search = new URLSearchParams({ path, language: 'it-IT', ...params })
  return `/.netlify/functions/tmdb?${search.toString()}`
}

const mapResult = (item: TmdbResult): MediaItem | null => {
  const type = item.media_type === 'movie' || (!item.name && item.title) ? 'movie' : 'tv'
  const title = item.name || item.title
  if (!title || !item.poster_path) return null
  const date = item.first_air_date || item.release_date || ''
  return {
    id: `tmdb-${type}-${item.id}`,
    tmdbId: item.id,
    type,
    title,
    poster: `https://image.tmdb.org/t/p/w500${item.poster_path}`,
    backdrop: item.backdrop_path ? `https://image.tmdb.org/t/p/original${item.backdrop_path}` : `https://image.tmdb.org/t/p/original${item.poster_path}`,
    overview: item.overview || 'Descrizione non ancora disponibile in italiano.',
    year: date.slice(0, 4) || '—',
    releaseDate: date || undefined,
    genres: (item.genre_ids || []).map((id) => GENRES[id]).filter(Boolean).slice(0, 3),
    genreIds: (item.genre_ids || []).filter((id) => Boolean(GENRES[id])),
    rating: Math.round((item.vote_average || 0) * 10) / 10,
    status: 'watchlist',
    watchedEpisodes: 0,
    totalEpisodes: type === 'movie' ? 1 : 0,
    runtime: type === 'movie' ? 110 : 45,
    nextAirDate: type === 'movie' && isFutureDate(date) ? date : undefined,
  }
}

async function request(path: string, params?: Record<string, string>) {
  const response = await fetch(endpoint(path, params))
  if (!response.ok) throw new Error(response.status === 503 ? 'API non configurata' : 'TMDB non disponibile')
  return response.json()
}

async function watchmodeRequest(path: string, params: Record<string, string> = {}) {
  const search = new URLSearchParams({ path, ...params })
  const response = await fetch(`/.netlify/functions/watchmode?${search.toString()}`)
  if (!response.ok) throw new Error('Watchmode non disponibile')
  return response.json()
}

export async function getItalianCatalog() {
  const [upcomingMovies, availableMovies, availableSeries] = await Promise.all([
    request('/3/movie/upcoming', { region: 'IT' }),
    request('/3/discover/movie', {
      region: 'IT', watch_region: 'IT',
      with_watch_monetization_types: 'flatrate|free|ads|rent|buy',
      sort_by: 'popularity.desc', include_adult: 'false',
    }),
    request('/3/discover/tv', {
      watch_region: 'IT',
      with_watch_monetization_types: 'flatrate|free|ads|rent|buy',
      sort_by: 'popularity.desc', include_adult: 'false', timezone: 'Europe/Rome',
    }),
  ])
  const upcoming = (upcomingMovies.results as TmdbResult[])
    .filter((item) => (item.popularity || 0) >= 8 || (item.vote_count || 0) >= 20)
    .map((item) => mapResult({ ...item, media_type: 'movie' }))
    .filter(Boolean) as MediaItem[]
  const movies = (availableMovies.results as TmdbResult[])
    .map((item) => mapResult({ ...item, media_type: 'movie' }))
    .filter(Boolean) as MediaItem[]
  const series = (availableSeries.results as TmdbResult[])
    .map((item) => mapResult({ ...item, media_type: 'tv' }))
    .filter(Boolean) as MediaItem[]
  const available = [...movies, ...series]
    .filter((item, index, all) => all.findIndex((entry) => entry.id === item.id) === index)
  const [localizedAvailable, localizedUpcoming] = await Promise.all([
    keepItalianLocalized(available),
    keepItalianLocalized(upcoming),
  ])
  return {
    available: localizedAvailable,
    upcoming: localizedUpcoming
      .filter((item) => item.nextAirDate)
      .sort((a, b) => (a.nextAirDate || '').localeCompare(b.nextAirDate || '')),
  }
}

export async function searchTmdb(query: string, type: 'multi' | 'tv' | 'movie' = 'multi') {
  const data = await request(`/3/search/${type}`, { query, include_adult: 'false', region: 'IT' })
  const items = (data.results as TmdbResult[]).map(mapResult).filter(Boolean).slice(0, 12) as MediaItem[]
  const checked = await Promise.all(items.map(async (item) => ({
    item,
    eligible: await Promise.all([
      isAvailableInItaly(item).catch(() => false),
      hasItalianTranslation(item).catch(() => false),
    ]).then(([available, localized]) => available && localized),
  })))
  return checked.filter(({ eligible }) => eligible).map(({ item }) => item)
}

export async function getExploreCatalog(feed: ExploreFeed, type: 'all' | 'tv' | 'movie' = 'all', genres: CatalogGenre[] = [], page = 1): Promise<MediaItem[]> {
  const selectedGenres = [...new Set(genres)]
  const cacheKey = `${feed}-${type}-${selectedGenres.join('|')}-${page}`
  const cached = exploreCache.get(cacheKey)
  if (cached) return cached
  if (feed === 'upcoming' && type === 'tv') {
    const series = await getWatchmodeUpcomingSeries()
    exploreCache.set(cacheKey, series)
    return series
  }
  if (feed === 'upcoming' && type === 'all') {
    const [movies, series] = await Promise.all([
      getExploreCatalog('upcoming', 'movie'),
      getWatchmodeUpcomingSeries(),
    ])
    const combined = [...movies, ...series]
      .sort((a, b) => (a.nextAirDate || '').localeCompare(b.nextAirDate || ''))
      .slice(0, 16)
    exploreCache.set(cacheKey, combined)
    return combined
  }
  const requestedTypes: Array<'tv' | 'movie'> = type === 'all' ? ['movie', 'tv'] : [type]
  const genreIdsFor = (mediaType: 'tv' | 'movie') => selectedGenres
    .map((genre) => CATALOG_GENRE_IDS[genre][mediaType])
    .filter((id): id is number => Boolean(id))
  const mediaTypes = requestedTypes.filter((mediaType) => !selectedGenres.length || genreIdsFor(mediaType).length > 0)
  const today = new Date().toISOString().slice(0, 10)
  const inFourMonths = new Date(Date.now() + 120 * 86400000).toISOString().slice(0, 10)

  const load = async (mediaType: 'tv' | 'movie') => {
    const genreIds = genreIdsFor(mediaType)
    if (feed === 'trending') return request(`/3/trending/${mediaType}/day`)
    if (feed === 'cinema') return mediaType === 'movie' ? request('/3/movie/now_playing', { region: 'IT' }) : { results: [] }
    if (feed === 'upcoming') {
      return mediaType === 'movie'
        ? request('/3/movie/upcoming', { region: 'IT' })
        : request('/3/discover/tv', { watch_region: 'IT', 'air_date.gte': today, 'air_date.lte': inFourMonths, sort_by: 'popularity.desc' })
    }
    return request(`/3/discover/${mediaType}`, {
      region: 'IT', watch_region: 'IT',
      with_watch_monetization_types: 'flatrate|free|ads|rent|buy',
      sort_by: feed === 'top-rated' ? 'vote_average.desc' : 'popularity.desc',
      ...(feed === 'popular' ? (mediaType === 'movie' ? { 'release_date.lte': today } : { 'first_air_date.lte': today }) : {}),
      ...(genreIds.length ? { with_genres: genreIds.join('|') } : {}),
      ...(feed === 'popular' ? { page: String(page) } : {}),
      ...(feed === 'top-rated' ? { 'vote_count.gte': '250' } : {}),
      include_adult: 'false',
    })
  }

  const responses = await Promise.all(mediaTypes.map(load))
  const items = responses.flatMap((data, index) => (data.results as TmdbResult[]).map((item) => mapResult({ ...item, media_type: mediaTypes[index] })))
    .filter(Boolean) as MediaItem[]
  const unique = items.filter((item, index, all) => all.findIndex((entry) => entry.id === item.id) === index).slice(0, 16)
  const checked = await Promise.all(unique.map(async (item) => {
    const [available, localized] = await Promise.all([isAvailableInItaly(item), hasItalianTranslation(item)]).catch(() => [false, false] as const)
    return { item, eligible: available && localized, localized }
  }))
  let eligible = checked.filter((entry) => entry.eligible).map(({ item }) => item)
  if (feed === 'upcoming') {
    const enriched = await Promise.all(eligible.map(async (item) => {
      const live = await getWatchmodeAvailability(item).catch(() => null)
      return live ? { ...item, ...live } : item
    }))
    eligible = enriched.filter((item) => item.nextAirDate && item.nextAirDate >= today)
  }
  exploreCache.set(cacheKey, eligible)
  return eligible
}

async function getWatchmodeUpcomingSeries(): Promise<MediaItem[]> {
  if (upcomingSeriesCache) return upcomingSeriesCache
  const [sources, releases] = await Promise.all([
    watchmodeRequest('/v1/sources/', { regions: 'IT' }),
    watchmodeRequest('/v1/releases/', { limit: '250' }),
  ])
  const italianSourceIds = new Set((sources as Array<{ id: number }>).map((source) => source.id))
  const today = new Date().toISOString().slice(0, 10)
  const candidates = (releases.releases as Array<{ type?: string; tmdb_id?: number; source_id?: number; title?: string; poster_url?: string; source_release_date?: string; source_name?: string; season_number?: number }>)
    .filter((release) => release.type === 'tv_series' && Boolean(release.tmdb_id && release.poster_url && release.source_release_date && release.source_release_date >= today) && italianSourceIds.has(release.source_id || 0))
    .sort((a, b) => (a.source_release_date || '').localeCompare(b.source_release_date || ''))
    .filter((release, index, all) => all.findIndex((entry) => entry.tmdb_id === release.tmdb_id) === index)
    .slice(0, 16)
  const items = candidates.map((release) => ({
    id: `tmdb-tv-${release.tmdb_id}`,
    tmdbId: release.tmdb_id,
    type: 'tv' as const,
    title: release.title || 'Serie TV',
    poster: release.poster_url || '',
    backdrop: release.poster_url || '',
    overview: `In arrivo su ${release.source_name || 'un servizio italiano'}.`,
    year: (release.source_release_date || '').slice(0, 4),
    genres: [],
    rating: 0,
    status: 'watchlist' as const,
    watchedEpisodes: 0,
    totalEpisodes: 0,
    runtime: 45,
    season: release.season_number || 1,
    nextAirDate: release.source_release_date,
    watchProviders: [{ name: release.source_name || 'Servizio italiano', logo: '', availability: 'Streaming' as const }],
  }))
  const localized = await Promise.all(items.map(async (item) => (await hasItalianTranslation(item).catch(() => false)) ? item : null))
  upcomingSeriesCache = localized.filter(Boolean) as MediaItem[]
  return upcomingSeriesCache
}

async function getWatchmodeAvailability(item: MediaItem): Promise<Partial<MediaItem> | null> {
  if (!item.tmdbId || item.type !== 'tv') return null
  if (watchmodeCache.has(item.tmdbId)) return watchmodeCache.get(item.tmdbId) || null
  const search = await watchmodeRequest('/v1/search/', { search_field: 'tmdb_tv_id', search_value: String(item.tmdbId) })
  const match = search.title_results?.[0]
  if (!match?.id) { watchmodeCache.set(item.tmdbId, null); return null }
  const details = await watchmodeRequest(`/v1/title/${match.id}/details/`, { append_to_response: 'sources,seasons' })
  const sources = (details.sources || []).filter((source: { region?: string }) => source.region === 'IT')
  const providers = sources.map((source: { name?: string; source_name?: string; type?: string; web_url?: string }) => ({
    name: source.name || source.source_name || 'Servizio streaming',
    logo: '',
    availability: source.type === 'free' ? 'Gratis' : 'Streaming',
    link: source.web_url,
  })).filter((provider: { name: string }, index: number, all: Array<{ name: string }>) => all.findIndex((entry) => entry.name === provider.name) === index)
  const today = new Date().toISOString().slice(0, 10)
  const nextSeason = (details.seasons || [])
    .filter((season: { air_date?: string }) => season.air_date && season.air_date >= today)
    .sort((a: { air_date?: string }, b: { air_date?: string }) => (a.air_date || '').localeCompare(b.air_date || ''))[0]
  const releaseDate = nextSeason?.air_date || details.release_date
  const futureReleaseDate = releaseDate && releaseDate >= today ? releaseDate : undefined
  const result = {
    watchProviders: providers,
    watchLink: providers.find((provider: { link?: string }) => provider.link)?.link,
    season: nextSeason?.number,
    nextAirDate: futureReleaseDate,
  }
  watchmodeCache.set(item.tmdbId, result)
  return result
}

async function keepItalianLocalized(items: MediaItem[]) {
  const checked = await Promise.all(items.map(async (item) => ({
    item,
    localized: await hasItalianTranslation(item).catch(() => false),
  })))
  return checked.filter(({ localized }) => localized).map(({ item }) => item)
}

async function hasItalianTranslation(item: MediaItem) {
  if (!item.tmdbId) return false
  const data = await request(`/3/${item.type}/${item.tmdbId}/translations`)
  return Boolean(data.translations?.some((translation: { iso_639_1?: string; iso_3166_1?: string }) =>
    translation.iso_639_1 === 'it' || translation.iso_3166_1 === 'IT'))
}

async function isAvailableInItaly(item: MediaItem) {
  if (!item.tmdbId) return false
  const [providers, releaseDates] = await Promise.all([
    request(`/3/${item.type}/${item.tmdbId}/watch/providers`),
    item.type === 'movie' ? request(`/3/movie/${item.tmdbId}/release_dates`) : Promise.resolve(null),
  ])
  const italy = providers.results?.IT
  const hasProvider = ['flatrate', 'free', 'ads', 'rent', 'buy'].some((key) => italy?.[key]?.length)
  if (hasProvider || item.type === 'tv') return Boolean(hasProvider)
  const today = new Date().toISOString().slice(0, 10)
  return Boolean(releaseDates?.results
    ?.find((entry: { iso_3166_1: string }) => entry.iso_3166_1 === 'IT')
    ?.release_dates?.some((release: { release_date?: string }) => (release.release_date || '').slice(0, 10) >= today))
}

function getItalianProviders(data: Record<string, any>): Pick<MediaItem, 'watchProviders' | 'watchLink'> {
  const italy = data['watch/providers']?.results?.IT
  const groups: Array<[string, WatchProvider['availability']]> = [['flatrate', 'Streaming'], ['free', 'Gratis'], ['ads', 'Con pubblicità'], ['rent', 'Noleggio'], ['buy', 'Acquisto']]
  const providers = groups.flatMap(([key, availability]) => (italy?.[key] || []).map((provider: { provider_name: string; logo_path?: string }) => ({ name: provider.provider_name, logo: provider.logo_path ? `https://image.tmdb.org/t/p/w92${provider.logo_path}` : '', availability })))
  return { watchProviders: providers.filter((provider, index, all) => all.findIndex((entry) => entry.name === provider.name) === index), watchLink: italy?.link }
}

export async function getLiveDetails(item: MediaItem): Promise<Partial<MediaItem>> {
  if (!item.tmdbId) return {}
  const data = await request(`/3/${item.type}/${item.tmdbId}`, { append_to_response: item.type === 'movie' ? 'release_dates,watch/providers' : 'watch/providers' })
  const providers = getItalianProviders(data)
  if (item.type === 'movie') {
    const italian = data.release_dates?.results?.find((entry: { iso_3166_1: string }) => entry.iso_3166_1 === 'IT')
    const preferred = italian?.release_dates?.find((release: { type: number }) => [3, 4, 2].includes(release.type))
    const italianReleaseDate = preferred?.release_date?.slice(0, 10) || data.release_date || item.releaseDate
    return { ...providers, runtime: data.runtime || item.runtime, releaseDate: italianReleaseDate, nextAirDate: isFutureDate(italianReleaseDate) ? italianReleaseDate : undefined }
  }
  const nextEpisodeAirDate = data.next_episode_to_air?.air_date
  return {
    ...providers,
    releaseDate: data.first_air_date || item.releaseDate,
    totalEpisodes: data.number_of_episodes || item.totalEpisodes,
    seasonCount: data.number_of_seasons || item.seasonCount,
    runtime: data.episode_run_time?.[0] || data.last_episode_to_air?.runtime || item.runtime,
    season: data.last_episode_to_air?.season_number || item.season,
    nextEpisode: data.next_episode_to_air?.episode_number,
    nextAirDate: isFutureDate(nextEpisodeAirDate) ? nextEpisodeAirDate : undefined,
  }
}

export async function getSimilarTitles(item: MediaItem): Promise<MediaItem[]> {
  if (!item.tmdbId) return []
  const data = await request(`/3/${item.type}/${item.tmdbId}/similar`)
  return (data.results as TmdbResult[])
    .map((entry) => mapResult({ ...entry, media_type: item.type }))
    .filter(Boolean)
    .slice(0, 10) as MediaItem[]
}

export async function getSeasonEpisodes(item: MediaItem, season: number): Promise<Episode[]> {
  if (!item.tmdbId || item.type !== 'tv') return []
  const data = await request(`/3/tv/${item.tmdbId}/season/${season}`)
  return (data.episodes as TmdbEpisode[]).map((episode) => ({
    id: `tmdb-episode-${episode.id}`,
    season: episode.season_number,
    number: episode.episode_number,
    title: episode.name || `Episodio ${episode.episode_number}`,
    airDate: episode.air_date || '',
    runtime: episode.runtime || item.runtime,
    watched: false,
    still: episode.still_path ? `https://image.tmdb.org/t/p/original${episode.still_path}` : item.backdrop,
    overview: episode.overview || 'La trama di questo episodio non è ancora disponibile in italiano.',
    rating: Math.round((episode.vote_average || 0) * 10) / 10,
  }))
}
