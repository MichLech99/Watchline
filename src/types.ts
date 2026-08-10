export type TabId = 'home' | 'search' | 'calendar' | 'library' | 'profile' | 'analytics'
export type MediaType = 'tv' | 'movie'
export type MediaStatus = 'watching' | 'caught-up' | 'waiting' | 'completed' | 'watchlist'
export type SeasonStatus = 'watchlist' | 'watching' | 'completed'
export type WatchProvider = { name: string; logo: string; availability: 'Streaming' | 'Gratis' | 'Con pubblicità' | 'Noleggio' | 'Acquisto' }

export type MediaItem = {
  id: string
  tmdbId?: number
  type: MediaType
  title: string
  poster: string
  backdrop: string
  overview: string
  year: string
  releaseDate?: string
  personalRating?: number
  genres: string[]
  /** TMDB genre identifiers. Kept alongside labels so recommendations can match source data exactly. */
  genreIds?: number[]
  rating: number
  status: MediaStatus
  statusIsManual?: boolean
  watchedEpisodes: number
  watchedEpisodeIds?: string[]
  seasonProgress?: Record<string, { status: SeasonStatus }>
  lastWatchedSeason?: number
  lastWatchedEpisode?: number
  totalEpisodes: number
  runtime: number
  season?: number
  seasonCount?: number
  nextEpisode?: number
  nextAirDate?: string
  watchProviders?: WatchProvider[]
  watchLink?: string
}

export type Episode = {
  id: string
  season: number
  number: number
  title: string
  airDate: string
  runtime: number
  watched: boolean
  still: string
  overview: string
  rating: number
}

export type TmdbResult = {
  id: number
  media_type?: 'tv' | 'movie' | 'person'
  name?: string
  title?: string
  overview?: string
  poster_path?: string | null
  backdrop_path?: string | null
  first_air_date?: string
  release_date?: string
  vote_average?: number
  vote_count?: number
  popularity?: number
  genre_ids?: number[]
}

export type TmdbEpisode = {
  id: number
  season_number: number
  episode_number: number
  name?: string
  air_date?: string
  runtime?: number | null
  still_path?: string | null
  overview?: string
  vote_average?: number
}
