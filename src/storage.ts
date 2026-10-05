import { getGenreIdsForNames } from './api'
import type { MediaItem } from './types'
const KEY = 'watchline-library-v1'
const UPDATED_AT_KEY = 'watchline-library-updated-at'

export function loadLibrary(): MediaItem[] {
  try {
    const value = localStorage.getItem(KEY)
    const items: MediaItem[] = value ? JSON.parse(value) : []
    const todayIso = new Date().toISOString().slice(0, 10)
    return items
      .filter((item) => !item.id.startsWith('demo-'))
      .map((item) => {
        const legacyTvStatus = item.watchedEpisodes >= item.totalEpisodes && item.totalEpisodes > 0
          ? 'completed'
          : item.watchedEpisodes > 0 ? 'watching' : 'watchlist'
        const savedTvStatus = ['watchlist', 'watching', 'caught-up', 'waiting', 'completed'].includes(item.status)
          ? item.status
          : legacyTvStatus
        return {
          ...item,
          genreIds: item.genreIds?.length ? item.genreIds : getGenreIdsForNames(item.genres),
          status: item.type === 'movie'
            ? (!['watchlist', 'completed'].includes(item.status) ? 'watchlist' : item.status)
            : savedTvStatus,
          statusIsManual: item.type === 'movie'
            ? (!['watchlist', 'completed'].includes(item.status) || item.statusIsManual)
            : Boolean(item.statusIsManual),
          nextAirDate: item.nextAirDate && item.nextAirDate >= todayIso ? item.nextAirDate : undefined,
          backdrop: item.backdrop.replace(/\/w(?:500|780|1280)\//, '/original/'),
        }
      })
  } catch {
    return []
  }
}

export function saveLibrary(items: MediaItem[]) {
  localStorage.setItem(KEY, JSON.stringify(items))
}

export function loadLibraryUpdatedAt() {
  const value = Number(localStorage.getItem(UPDATED_AT_KEY) || 0)
  return Number.isFinite(value) ? value : 0
}

export function saveLibraryUpdatedAt(value: number) {
  localStorage.setItem(UPDATED_AT_KEY, value.toString())
}
