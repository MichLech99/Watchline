import type { Episode, MediaItem, MediaStatus } from './types'

const image = (id: string, width = 900) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${width}&q=82`
const dateFromNow = (days: number) => {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

export const STATUS_META: Record<MediaStatus, { label: string; short: string }> = {
  watching: { label: 'In corso', short: 'In corso' },
  'caught-up': { label: 'In pari', short: 'In pari' },
  waiting: { label: 'In attesa di novità', short: 'In attesa' },
  completed: { label: 'Visto', short: 'Visti' },
  watchlist: { label: 'Da vedere', short: 'Da vedere' },
}

export const seedLibrary: MediaItem[] = [
  {
    id: 'demo-echoes', type: 'tv', title: 'Echoes Beyond',
    poster: image('photo-1446776811953-b23d57bd21aa', 600), backdrop: image('photo-1446776811953-b23d57bd21aa', 1400),
    overview: 'Un segnale proveniente dallo spazio profondo cambia la vita sulla Terra e porta due ricercatori oltre ogni certezza.',
    year: '2026', genres: ['Fantascienza', 'Mistero'], rating: 8.7, status: 'watching', watchedEpisodes: 5, totalEpisodes: 8, runtime: 48, season: 1, nextEpisode: 6, nextAirDate: dateFromNow(1),
  },
  {
    id: 'demo-pinecrest', type: 'tv', title: 'Pinecrest',
    poster: image('photo-1448375240586-882707db888b', 600), backdrop: image('photo-1448375240586-882707db888b', 1400),
    overview: 'Una cittadina ai margini della foresta protegge un segreto che nessuno vuole ricordare.',
    year: '2025', genres: ['Thriller', 'Drama'], rating: 8.1, status: 'caught-up', watchedEpisodes: 12, totalEpisodes: 12, runtime: 44, season: 2, nextEpisode: 1, nextAirDate: dateFromNow(4),
  },
  {
    id: 'demo-glasshouse', type: 'tv', title: 'The Glasshouse',
    poster: image('photo-1488426862026-3ee34a7d66df', 600), backdrop: image('photo-1488426862026-3ee34a7d66df', 1400),
    overview: 'Vecchi segreti tornano a galla quando una famiglia si riunisce nella casa d’infanzia.',
    year: '2024', genres: ['Drama', 'Mistero'], rating: 7.9, status: 'waiting', watchedEpisodes: 16, totalEpisodes: 16, runtime: 51, season: 2,
  },
  {
    id: 'demo-duskfall', type: 'tv', title: 'Duskfall',
    poster: image('photo-1500530855697-b586d89ba3ee', 600), backdrop: image('photo-1500530855697-b586d89ba3ee', 1400),
    overview: 'Alleanze impossibili si formano mentre l’ultima città si prepara alla battaglia finale.',
    year: '2023', genres: ['Fantasy', 'Avventura'], rating: 8.4, status: 'completed', watchedEpisodes: 32, totalEpisodes: 32, runtime: 54, season: 4,
  },
  {
    id: 'demo-orbital', type: 'movie', title: 'The Orbital',
    poster: image('photo-1451187580459-43490279c0fa', 600), backdrop: image('photo-1451187580459-43490279c0fa', 1400),
    overview: 'Una missione solitaria scopre qualcosa di impossibile oltre l’orbita terrestre.',
    year: '2026', genres: ['Fantascienza'], rating: 7.8, status: 'watchlist', watchedEpisodes: 0, totalEpisodes: 1, runtime: 126, nextAirDate: dateFromNow(12),
  },
]

export const demoDiscovery: MediaItem[] = [
  ...seedLibrary,
  {
    id: 'demo-neon', type: 'movie', title: 'Neon Requiem',
    poster: image('photo-1519608487953-e999c86e7455', 600), backdrop: image('photo-1519608487953-e999c86e7455', 1400),
    overview: 'Un investigatore attraversa una metropoli notturna seguendo una memoria che non gli appartiene.',
    year: '2026', genres: ['Crime', 'Fantascienza'], rating: 8.3, status: 'watchlist', watchedEpisodes: 0, totalEpisodes: 1, runtime: 118,
  },
  {
    id: 'demo-horizon', type: 'movie', title: 'Lucid Horizon',
    poster: image('photo-1464802686167-b939a6910659', 600), backdrop: image('photo-1464802686167-b939a6910659', 1400),
    overview: 'Una cartografa dei sogni trova il passaggio verso una realtà parallela.',
    year: '2025', genres: ['Fantasy', 'Avventura'], rating: 8.6, status: 'watchlist', watchedEpisodes: 0, totalEpisodes: 1, runtime: 132,
  },
]

export const demoEpisodes = (item: MediaItem): Episode[] => {
  if (item.type === 'movie') return []
  const titles = ['Il segnale', 'Conseguenze', 'Frammenti', 'Vecchi sentieri', 'La svolta', 'Oltre il velo', 'Ritorno', 'Risonanza']
  return titles.slice(0, Math.min(item.totalEpisodes, 8)).map((title, index) => ({
    id: `${item.id}-e${index + 1}`,
    season: item.season || 1,
    number: index + 1,
    title,
    airDate: dateFromNow(index - 5),
    runtime: item.runtime,
    watched: index < item.watchedEpisodes,
    still: [
      image('photo-1446776811953-b23d57bd21aa', 500), image('photo-1448375240586-882707db888b', 500),
      image('photo-1488426862026-3ee34a7d66df', 500), image('photo-1500530855697-b586d89ba3ee', 500),
    ][index % 4],
    overview: `Un nuovo capitolo di ${item.title}: gli eventi della stagione prendono una direzione inattesa.`,
    rating: Math.round((7.4 + (index % 4) * .3) * 10) / 10,
  }))
}
