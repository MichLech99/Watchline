import { useEffect, useMemo, useRef, useState, type SetStateAction } from 'react'
import {
  Activity, BarChart3, Bell, Bookmark, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight,
  Circle, CircleCheck, Clock3, Clapperboard, Eye, Film, Flame, Home, Library, ListFilter, MonitorPlay, Plus, RefreshCw, Search as SearchIcon,
  Cloud, KeyRound, LogOut, Sparkles, Star, Trophy, Tv, UserRound, X,
} from 'lucide-react'
import { demoDiscovery, demoEpisodes, STATUS_META } from './data'
import { CATALOG_GENRES, getCatalogGenreIds, getCatalogGenresForIds, getCatalogGenresForType, getExploreCatalog, getItalianCatalog, getItemGenreIds, getLiveDetails, getSeasonEpisodes, getSimilarTitles, itemMatchesCatalogGenres, searchTmdb } from './api'
import type { ExploreFeed } from './api'
import { loadLibrary } from './storage'
import { LibraryPersistence } from './library-persistence'
import { LibraryController } from './library-controller'
import { LibrarySafetyPanel } from './LibrarySafetyPanel'
import { isCloudConfigured, commitCloudChanges, onCloudAuthChange, signInWithUsername, signOutCloud } from './cloud'
import type { CloudProfile, CloudSession } from './cloud'
import type { Episode, MediaItem, MediaStatus, SeasonStatus, TabId } from './types'

const navItems: { id: TabId; label: string; icon: typeof Home }[] = [
  { id: 'home', label: 'Oggi', icon: Home },
  { id: 'search', label: 'Cerca', icon: SearchIcon },
  { id: 'calendar', label: 'Calendario', icon: CalendarDays },
  { id: 'library', label: 'Libreria', icon: Library },
  { id: 'analytics', label: 'Statistiche', icon: BarChart3 },
]

type UserProfile = CloudProfile
type CloudSyncStatus = 'unavailable' | 'checking' | 'signed-out' | 'syncing' | 'synced' | 'error' | 'storage-error'
const PROFILE_KEY = 'watchline-profile-v1'
const loadProfile = (): UserProfile => {
  try {
    const value = localStorage.getItem(PROFILE_KEY)
    const parsed = value ? JSON.parse(value) as Partial<UserProfile> : {}
    return { favoriteGenres: Array.isArray(parsed.favoriteGenres) ? parsed.favoriteGenres : [] }
  } catch {
    return { favoriteGenres: [] }
  }
}

const statusOrder: MediaStatus[] = ['watchlist', 'watching', 'caught-up', 'waiting', 'completed']

const STATUS_COLORS: Record<MediaStatus, string> = {
  watching: '#7667ff',
  'caught-up': '#5f8cff',
  waiting: '#f3a557',
  completed: '#48cf9b',
  watchlist: '#6f7890',
}

const formatHours = (minutes: number) => {
  const hours = minutes / 60
  return hours > 0 && hours < 1 ? '<1' : Math.round(hours).toString()
}

const toLocalDateKey = (value: Date = new Date()) => {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

const isUpcomingDate = (value?: string) => Boolean(value && value >= toLocalDateKey())
const hasAnnouncedContinuation = (item: MediaItem) =>
  isUpcomingDate(item.nextAirDate) || ['Returning Series', 'In Production', 'Planned'].includes(item.seriesStatus || '')

function deriveStatus(item: MediaItem): MediaStatus {
  if (item.statusIsManual) return item.status
  if (item.type === 'movie') return item.status === 'completed' ? 'completed' : 'watchlist'
  if (item.status === 'watchlist' && item.watchedEpisodes === 0) return 'watchlist'
  if (item.watchedEpisodes < item.totalEpisodes) return 'watching'
  return hasAnnouncedContinuation(item) ? 'waiting' : 'completed'
}

function formatDate(value?: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) {
  if (!value) return 'Da definire'
  return new Intl.DateTimeFormat('it-IT', options).format(new Date(`${value}T12:00:00`))
}

function App() {
  const [activeTab, setActiveTab] = useState<TabId>('home')
  const [library, setLibraryState] = useState<MediaItem[]>(loadLibrary)
  const [profile, setProfileState] = useState<UserProfile>(loadProfile)
  const [discovery, setDiscovery] = useState<MediaItem[]>([])
  const [upcomingCatalog, setUpcomingCatalog] = useState<MediaItem[]>([])
  const [selected, setSelected] = useState<MediaItem | null>(null)
  const [detailEpisodes, setDetailEpisodes] = useState<Episode[]>([])
  const [detailSeason, setDetailSeason] = useState(1)
  const [detailLoading, setDetailLoading] = useState(false)
  const [apiMode, setApiMode] = useState<'loading' | 'live' | 'demo'>('loading')
  const [catalogRevision, setCatalogRevision] = useState(0)
  const [cloudSession, setCloudSession] = useState<CloudSession | null>(null)
  const [cloudSyncStatus, setCloudSyncStatus] = useState<CloudSyncStatus>(isCloudConfigured ? 'checking' : 'unavailable')
  const [toast, setToast] = useState('')
  const searchReturnScroll = useRef<number | null>(null)
  const detailRequestRef = useRef(0)
  const seasonRequestRef = useRef(0)
  const controllerRef = useRef<LibraryController | null>(null)
  const [online, setOnline] = useState(navigator.onLine)

  const setLibrary = (next: SetStateAction<MediaItem[]>) => {
    const controller = controllerRef.current
    if (!controller) { setToast('Salvataggio non disponibile: riprova la sincronizzazione'); return false }
    return controller.update((snapshot) => ({ ...snapshot, library: typeof next === 'function' ? next(snapshot.library) : next }))
  }
  const setProfile = (next: UserProfile) => {
    controllerRef.current?.update((snapshot) => ({ ...snapshot, profile: next }))
  }

  useEffect(() => {
    document.documentElement.removeAttribute('data-theme')
    localStorage.removeItem('watchline-theme')
  }, [])

  useEffect(() => {
    if (!isCloudConfigured) return
    let active = true
    const unsubscribe = onCloudAuthChange((session) => {
      if (!active) return
      if (session && controllerRef.current?.persistence.userId === session.userId) return
      controllerRef.current?.stop()
      controllerRef.current = null
      setSelected(null)
      setCloudSession(session)
      if (!session) { setCloudSyncStatus('signed-out'); return }
      try {
        const controller = new LibraryController(new LibraryPersistence(localStorage, session.userId),
          (draft) => commitCloudChanges(session.userId, draft),
          (draft, status) => {
            if (!active) return
            setLibraryState(draft.snapshot.library)
            setProfileState(draft.snapshot.profile)
            setCloudSyncStatus(status)
          })
        controllerRef.current = controller
        setLibraryState(controller.draft.snapshot.library)
        setProfileState(controller.draft.snapshot.profile)
        void controller.sync()
      } catch {
        setCloudSyncStatus('storage-error')
        setToast('Non riesco a leggere i dati locali. Conserva i dati del browser: non sono stati sovrascritti.')
      }
    })
    const retry = () => {
      setOnline(navigator.onLine)
      if (navigator.onLine) void controllerRef.current?.sync()
    }
    const visible = () => { if (document.visibilityState === 'visible') retry() }
    const storageChanged = (event: StorageEvent) => {
      if (event.key === controllerRef.current?.persistence.key) void controllerRef.current?.sync()
    }
    const timer = window.setInterval(() => {
      if (navigator.onLine && controllerRef.current?.status === 'error') void controllerRef.current.sync()
    }, 15_000)
    window.addEventListener('online', retry)
    window.addEventListener('offline', retry)
    window.addEventListener('focus', retry)
    window.addEventListener('pageshow', retry)
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('storage', storageChanged)
    return () => {
      active = false
      unsubscribe()
      controllerRef.current?.stop()
      controllerRef.current = null
      window.clearInterval(timer)
      window.removeEventListener('online', retry)
      window.removeEventListener('offline', retry)
      window.removeEventListener('focus', retry)
      window.removeEventListener('pageshow', retry)
      document.removeEventListener('visibilitychange', visible)
      window.removeEventListener('storage', storageChanged)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let retryTimer: number | undefined
    setApiMode('loading')
    getItalianCatalog()
      .then(({ available, upcoming }) => {
        if (cancelled) return
        if (available.length) setDiscovery(available)
        setUpcomingCatalog(upcoming)
        setApiMode('live')
      })
      .catch(() => {
        if (cancelled) return
        setDiscovery(demoDiscovery)
        setApiMode('demo')
        retryTimer = window.setTimeout(() => setCatalogRevision((revision) => revision + 1), 15_000)
      })
    return () => {
      cancelled = true
      if (retryTimer) window.clearTimeout(retryTimer)
    }
  }, [catalogRevision])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 2800)
    return () => window.clearTimeout(timer)
  }, [toast])

  const updateItem = (id: string, patch: Partial<MediaItem>, fallback?: MediaItem) => {
    if (!setLibrary((items) => items.some((item) => item.id === id)
      ? items.map((item) => item.id === id ? { ...item, ...patch } : item)
      : fallback ? [...items, { ...fallback, ...patch }] : items)) return false
    setSelected((item) => item?.id === id ? { ...item, ...patch } : item)
    return true
  }

  const addOrRemove = (item: MediaItem) => {
    const exists = library.some((entry) => entry.id === item.id)
    if (!setLibrary((items) => exists ? items.filter((entry) => entry.id !== item.id) : [...items, { ...item, status: 'watchlist', statusIsManual: true }])) return
    setToast(exists ? `${item.title} rimosso dalla libreria` : `${item.title} aggiunto alla libreria`)
  }

  const setItemStatus = (item: MediaItem, status: MediaStatus) => {
    const normalized = item.type === 'movie' && !['watchlist', 'completed'].includes(status) ? 'watchlist' : status
    const patch = { status: normalized, statusIsManual: true }
    if (!updateItem(item.id, patch, item)) return
    setToast(`${item.title}: ${STATUS_META[normalized].label}`)
  }

  const markNext = (item: MediaItem) => {
    if (item.type === 'movie') {
      const patch = { watchedEpisodes: 1, status: 'completed' as MediaStatus, statusIsManual: true }
      if (!updateItem(item.id, patch, item)) return
      setToast(`${item.title} segnato come visto`)
      return
    }
    const next = Math.min(Math.max(item.totalEpisodes, 1), item.watchedEpisodes + 1)
    const updated = { ...item, watchedEpisodes: next, statusIsManual: false }
    const patch = { watchedEpisodes: next, status: deriveStatus(updated), statusIsManual: false }
    if (!updateItem(item.id, patch, item)) return
    if (next >= item.totalEpisodes) void refreshCompletedSeries({ ...item, ...patch })
    setToast(next >= item.totalEpisodes ? 'Controllo se ci sono nuovi episodi o stagioni' : `Episodio ${next} segnato come visto`)
  }

  const refreshCompletedSeries = async (item: MediaItem) => {
    if (item.type !== 'tv' || !item.tmdbId) return
    const livePatch = await getLiveDetails(item).catch(() => null)
    if (!livePatch) return
    const updated = { ...item, ...livePatch, statusIsManual: false }
    updateItem(item.id, { ...livePatch, status: deriveStatus(updated), statusIsManual: false })
  }

  const syncItems = async (items: MediaItem[], notify = false) => {
    const liveItems = items.filter((item) => item.tmdbId)
    if (!liveItems.length) { setToast('Aggiungi un titolo TMDB per sincronizzarlo'); return }
    if (notify) setToast('Aggiorno la libreria...')
    const updates = await Promise.all(liveItems.map(async (item) => ({ id: item.id, patch: await getLiveDetails(item).catch(() => ({})) })))
    const saved = setLibrary((items) => items.map((item) => {
      const found = updates.find((update) => update.id === item.id)
      const merged = found ? { ...item, ...found.patch } : item
      return { ...merged, status: deriveStatus(merged) }
    }))
    if (!saved) return
    localStorage.setItem('watchline-last-sync', Date.now().toString())
    if (notify) setToast('Libreria aggiornata')
  }

  const syncLibrary = () => {
    setCatalogRevision((revision) => revision + 1)
    void syncItems(library, true)
  }

  useEffect(() => {
    if (apiMode !== 'live') return
    const sixHours = 6 * 60 * 60 * 1000
    const last = Number(localStorage.getItem('watchline-last-sync') || 0)
    if (Date.now() - last > sixHours && library.some((item) => item.tmdbId)) void syncItems(library)
    const timer = window.setInterval(() => void syncItems(library), sixHours)
    return () => window.clearInterval(timer)
  }, [apiMode, library.length])

  const openDetail = (item: MediaItem) => {
    const detailRequest = ++detailRequestRef.current
    const seasonRequest = ++seasonRequestRef.current
    if (activeTab === 'search') searchReturnScroll.current = window.scrollY
    const saved = library.find((entry) => entry.id === item.id)
    const initial = saved || item
    const activeSeason = Object.entries(initial.seasonProgress || {}).find(([, progress]) => progress.status === 'watching')?.[0]
    const season = initial.type === 'tv' ? Number(activeSeason || 1) : 1
    setSelected(initial)
    setDetailSeason(season)
    setDetailEpisodes(initial.tmdbId ? [] : demoEpisodes(initial))
    if (initial.tmdbId) {
      setDetailLoading(true)
      void (async () => {
        try {
          const patch = await getLiveDetails(initial)
          if (detailRequestRef.current !== detailRequest) return
          const updated = { ...initial, ...patch }
          setSelected(updated)
          if (saved) updateItem(initial.id, patch)
          const episodes = await getSeasonEpisodes(updated, season)
          if (detailRequestRef.current === detailRequest && seasonRequestRef.current === seasonRequest) setDetailEpisodes(episodes)
        } catch {
          if (detailRequestRef.current === detailRequest && seasonRequestRef.current === seasonRequest) setDetailEpisodes([])
        } finally {
          if (detailRequestRef.current === detailRequest && seasonRequestRef.current === seasonRequest) setDetailLoading(false)
        }
      })()
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }

  const closeDetail = () => {
    detailRequestRef.current += 1
    seasonRequestRef.current += 1
    const returnScroll = activeTab === 'search' ? searchReturnScroll.current : null
    searchReturnScroll.current = null
    setSelected(null)
    if (returnScroll !== null) {
      window.requestAnimationFrame(() => window.scrollTo({ top: returnScroll, left: 0, behavior: 'instant' as ScrollBehavior }))
    }
  }

  const changeDetailSeason = async (season: number) => {
    if (!selected) return
    const detailRequest = detailRequestRef.current
    const seasonRequest = ++seasonRequestRef.current
    const selectedId = selected.id
    setDetailSeason(season)
    if (!selected.tmdbId) { setDetailEpisodes(demoEpisodes({ ...selected, season })); return }
    setDetailLoading(true)
    const episodes = await getSeasonEpisodes(selected, season).catch(() => [])
    if (detailRequestRef.current === detailRequest && seasonRequestRef.current === seasonRequest && selectedId === selected.id) setDetailEpisodes(episodes)
    if (detailRequestRef.current === detailRequest && seasonRequestRef.current === seasonRequest) setDetailLoading(false)
  }

  const navigateTo = (tab: TabId) => {
    setSelected(null)
    setActiveTab(tab)
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
  }

  const handleCloudSignIn = async (username: string, password: string) => {
    await signInWithUsername(username, password)
    setToast('Accesso effettuato')
  }

  if (!cloudSession) return <AuthGate status={cloudSyncStatus} onSignIn={handleCloudSignIn} />

  const page = (
    <>
      {activeTab === 'search' && <SearchPageV2 discovery={discovery} library={library} apiMode={apiMode} favoriteGenres={profile.favoriteGenres} onOpen={openDetail} onToggle={addOrRemove} hidden={Boolean(selected)} />}
      {selected ? <DetailPageV2
      item={selected}
      saved={library.some((entry) => entry.id === selected.id)}
      onBack={closeDetail}
      onToggle={() => addOrRemove(selected)}
      onStatus={(status) => setItemStatus(selected, status)}
      onMark={() => markNext(selected)}
      onEpisode={(episode, watched, visibleEpisodes) => {
        const legacyIds = selected.watchedEpisodeIds || visibleEpisodes.slice(0, Math.min(selected.watchedEpisodes, visibleEpisodes.length)).map((entry) => entry.id)
        const ids = watched ? [...new Set([...legacyIds, episode.id])] : legacyIds.filter((id) => id !== episode.id)
        const count = Math.max(0, Math.min(selected.totalEpisodes, selected.watchedEpisodes + (watched ? 1 : -1)))
        const watchedInSeason = visibleEpisodes.filter((entry) => ids.includes(entry.id)).length
        const seasonStatus: SeasonStatus = watchedInSeason === visibleEpisodes.length ? 'completed' : watchedInSeason > 0 ? 'watching' : 'watchlist'
        const updated = { ...selected, watchedEpisodes: count, statusIsManual: false }
        const patch = {
          watchedEpisodes: count,
          watchedEpisodeIds: ids,
          seasonProgress: { ...selected.seasonProgress, [String(episode.season)]: { status: seasonStatus } },
          status: deriveStatus(updated),
          statusIsManual: false,
          lastWatchedSeason: watched ? episode.season : selected.lastWatchedSeason,
          lastWatchedEpisode: watched ? episode.number : selected.lastWatchedEpisode,
        }
        if (!updateItem(selected.id, patch, selected)) return
        if (watched && count >= selected.totalEpisodes) void refreshCompletedSeries({ ...selected, ...patch })
        setToast(watched ? `${episode.title} segnato come visto` : `${episode.title} segnato come non visto`)
      }}
      onSeasonStatus={(seasonNumber, seasonStatus, visibleEpisodes) => {
        const legacyIds = selected.watchedEpisodeIds || (selected.lastWatchedSeason === seasonNumber
          ? visibleEpisodes.slice(0, Math.min(selected.watchedEpisodes, visibleEpisodes.length)).map((entry) => entry.id)
          : [])
        const seasonIds = visibleEpisodes.map((entry) => entry.id)
        const ids = seasonStatus === 'completed'
          ? [...new Set([...legacyIds, ...seasonIds])]
          : seasonStatus === 'watchlist'
            ? legacyIds.filter((id) => !seasonIds.includes(id))
            : legacyIds
        const count = Math.max(0, Math.min(selected.totalEpisodes, selected.watchedEpisodes + ids.length - legacyIds.length))
        const updated = { ...selected, watchedEpisodes: count, statusIsManual: false }
        const patch = {
          watchedEpisodes: count,
          watchedEpisodeIds: ids,
          seasonProgress: { ...selected.seasonProgress, [String(seasonNumber)]: { status: seasonStatus } },
          status: seasonStatus === 'watching' ? 'watching' as MediaStatus : deriveStatus(updated),
          statusIsManual: false,
          lastWatchedSeason: seasonStatus === 'completed' || seasonStatus === 'watching' ? seasonNumber : selected.lastWatchedSeason,
        }
        if (!updateItem(selected.id, patch, selected)) return
        if (seasonStatus === 'completed' && count >= selected.totalEpisodes) void refreshCompletedSeries({ ...selected, ...patch })
        setToast(`Stagione ${seasonNumber}: ${seasonStatus === 'watchlist' ? 'da vedere' : seasonStatus === 'watching' ? 'sto guardando' : 'completata'}`)
      }}
      episodes={detailEpisodes}
      season={detailSeason}
      loading={detailLoading}
      onSeason={changeDetailSeason}
      onOpen={openDetail}
      onRate={(rating) => { if (!updateItem(selected.id, { personalRating: rating || undefined })) return; setToast(rating ? `Il tuo voto: ${rating} su 5` : 'Voto rimosso') }}
      /> : (
    <>
      {activeTab === 'home' && <HomePage library={library} upcomingCatalog={upcomingCatalog} onOpen={openDetail} onMark={markNext} onNavigate={navigateTo} />}
      {activeTab === 'calendar' && <CalendarPageV2 library={library} onOpen={openDetail} />}
      {activeTab === 'library' && <LibraryPageV2 library={library} onOpen={openDetail} onNavigate={navigateTo} />}
      {activeTab === 'profile' && <><ProfilePage profile={profile} onChange={setProfile} /><LibrarySafetyPanel controller={controllerRef.current} userId={cloudSession.userId} onRecover={(items) => setLibrary((current) => [...current, ...items.filter((item) => !current.some((entry) => entry.id === item.id))])} /></>}
      {activeTab === 'analytics' && <AnalyticsPage library={library} />}
    </>
      )}
    </>
  )

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Vai al contenuto</a>
      <aside className="desktop-rail" aria-label="Navigazione principale">
        <Brand compact />
        <nav>{navItems.map(({ id, label, icon: Icon }) => (
          <button key={id} className={activeTab === id && !selected ? 'active' : ''} onClick={() => navigateTo(id)}>
            <Icon size={21} /><span>{label}</span>
          </button>
        ))}</nav>
        <div className={`source-state ${apiMode}`}><span />{apiMode === 'live' ? 'TMDB connesso' : apiMode === 'loading' ? 'Connessione…' : 'Modalità demo'}</div>
      </aside>

      <div className="app-frame">
        <header className="topbar">
          <Brand />
          <div className="top-actions">
            <span className={`source-pill ${apiMode}`}>{apiMode === 'live' ? 'Dati' : apiMode === 'demo' ? 'Demo' : '...'}</span>
            <button className="icon-button" onClick={syncLibrary} aria-label="Sincronizza catalogo"><RefreshCw size={19} /></button>
            <button className="pulse-button" onClick={() => navigateTo('profile')} aria-label="Apri preferenze"><UserRound size={20} /></button>
          </div>
        </header>
        <div className={`library-save-status ${cloudSyncStatus}`} role="status" aria-live="polite">
          <Cloud size={15} /><span>{cloudSyncStatus === 'storage-error' ? 'Salvataggio sul dispositivo non riuscito. Le modifiche non sono confermate.'
            : cloudSyncStatus === 'error' ? 'Modifiche sul dispositivo. Cloud non aggiornato: riprovo automaticamente.'
              : !online ? 'Offline · copia conservata sul dispositivo'
                : cloudSyncStatus === 'synced' ? 'Libreria salvata nel cloud'
                  : 'Salvataggio nel cloud in corso…'}</span>
          {(cloudSyncStatus === 'error' || cloudSyncStatus === 'storage-error') && <button onClick={() => controllerRef.current ? void controllerRef.current.sync() : window.location.reload()}>Riprova</button>}
        </div>
        <main id="main-content" tabIndex={-1}>{page}</main>
        <nav className="bottom-nav" aria-label="Navigazione principale">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button key={id} className={activeTab === id && !selected ? 'active' : ''} onClick={() => navigateTo(id)}>
              <Icon size={22} strokeWidth={activeTab === id ? 2.4 : 1.8} /><span>{label}</span>
            </button>
          ))}
        </nav>
      </div>
      <div className="toast" aria-live="polite" data-visible={Boolean(toast)}>{toast}</div>
    </div>
  )
}

function Brand({ compact = false }: { compact?: boolean }) {
  return <div className={`brand ${compact ? 'compact' : ''}`}><span className="brand-mark"><Film size={18} /></span>{!compact && <span>Watch<em>line</em></span>}</div>
}

function AuthGate({ status, onSignIn }: { status: CloudSyncStatus; onSignIn: (username: string, password: string) => Promise<void> }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  if (status === 'checking' || status === 'syncing') return <main className="auth-gate" aria-busy="true" aria-live="polite"><div className="auth-gate-card auth-gate-loading"><Brand /><span className="auth-gate-spinner" aria-hidden="true" /><p>{status === 'checking' ? 'Controllo dell’accesso…' : 'Caricamento dei tuoi dati…'}</p></div></main>

  if (status === 'unavailable') return <main className="auth-gate"><section className="auth-gate-card" aria-labelledby="auth-title"><Brand /><div className="auth-gate-heading"><span className="auth-gate-icon"><KeyRound /></span><p className="eyebrow">Accesso privato</p><h1 id="auth-title">Collega il cloud per entrare</h1><p>La schermata di accesso è pronta, ma questo ambiente non è ancora collegato a Supabase.</p></div><p className="auth-setup-note">Inserisci le variabili Supabase in <code>.env.local</code> e riavvia Watchline. Poi potrai accedere con il tuo nome utente e la tua password.</p></section></main>

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!username.trim() || !password || pending) return
    setPending(true)
    setError('')
    try {
      await onSignIn(username, password)
    } catch {
      setError('Nome utente o password non validi.')
    } finally {
      setPending(false)
    }
  }

  return <main className="auth-gate"><section className="auth-gate-card" aria-labelledby="auth-title">
    <Brand />
    <div className="auth-gate-heading"><span className="auth-gate-icon"><KeyRound /></span><p className="eyebrow">Accesso privato</p><h1 id="auth-title">Bentornato su Watchline</h1><p>Accedi per ritrovare la tua libreria e continuare da dove avevi lasciato.</p></div>
    <form className="auth-form" onSubmit={(event) => void submit(event)}>
      <label htmlFor="auth-username">Nome utente</label>
      <div className="auth-input"><UserRound aria-hidden="true" /><input id="auth-username" type="text" autoFocus autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="es. marco" value={username} onChange={(event) => { setUsername(event.target.value); setError('') }} disabled={pending} /></div>
      <label htmlFor="auth-password">Password</label>
      <div className="auth-input"><KeyRound aria-hidden="true" /><input id="auth-password" type="password" autoComplete="current-password" placeholder="La tua password" value={password} onChange={(event) => { setPassword(event.target.value); setError('') }} disabled={pending} /></div>
      {error && <p className="auth-error" role="alert">{error}</p>}
      {status === 'error' && !error && <p className="auth-error" role="alert">Servizio non disponibile. Riprova tra poco.</p>}
      <button className="auth-submit" type="submit" disabled={pending || !username.trim() || !password}>{pending ? 'Accesso…' : 'Accedi'}</button>
    </form>
    <p className="auth-note">L’accesso usa solo nome utente e password. Non serve un’email.</p>
  </section></main>
}

function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return <div className="section-header"><h2>{title}</h2>{action && <button onClick={onAction}>{action}<ChevronRight size={16} /></button>}</div>
}

function HomePage({ library, upcomingCatalog, onOpen, onMark, onNavigate }: {
  library: MediaItem[]; upcomingCatalog: MediaItem[]; onOpen: (item: MediaItem) => void; onMark: (item: MediaItem) => void; onNavigate: (tab: TabId) => void
}) {
  const [localHour, setLocalHour] = useState(() => new Date().getHours())
  useEffect(() => {
    const updateHour = () => setLocalHour(new Date().getHours())
    const timer = window.setInterval(updateHour, 60_000)
    return () => window.clearInterval(timer)
  }, [])
  const greeting = localHour >= 5 && localHour < 12
    ? 'Buongiorno Valentina'
    : localHour >= 18 || localHour < 5
      ? 'Buonasera Valentina'
      : 'Cosa guardi oggi?'
  const current = library.find((item) => item.status === 'watching')
  const upcoming = [
    ...library.filter((item) => item.type === 'tv' && isUpcomingDate(item.nextAirDate)),
    ...upcomingCatalog,
  ].sort((a, b) => (a.nextAirDate || '').localeCompare(b.nextAirDate || '')).slice(0, 6)
  const watchlist = library.filter((item) => item.status === 'watchlist')
  return <div className="page home-page">
    <div className="page-intro home-intro"><p className="eyebrow">La tua visione</p><h1>{greeting}</h1><p>{current ? 'Hai un episodio pronto da riprendere.' : 'Scegli un titolo per la tua prossima serata.'}</p></div>
    {current ? <article className="continue-card home-now" style={{ '--backdrop': `url(${current.backdrop})` } as React.CSSProperties}>
      <button className="continue-main" onClick={() => onOpen(current)} aria-label={`Apri ${current.title}`}>
        <div className="continue-copy"><span className="kicker">Continua a guardare</span><h2>{current.title}</h2><p>S{current.season || 1} · prossimo episodio {current.watchedEpisodes + 1}</p>
          <div className="progress-row"><span className="progress"><i style={{ width: `${Math.round((current.watchedEpisodes / Math.max(current.totalEpisodes, 1)) * 100)}%` }} /></span><strong>{Math.round((current.watchedEpisodes / Math.max(current.totalEpisodes, 1)) * 100)}%</strong></div>
        </div>
      </button>
      <div className="home-now-actions"><button className="mark-button" onClick={() => onMark(current)}><CircleCheck size={19} /> Segna come visto</button><span>{current.totalEpisodes - current.watchedEpisodes} episodi rimasti</span></div>
    </article> : <div className="continue-empty"><span><Tv /></span><div><p className="kicker">Continua a guardare</p><h2>Niente da riprendere</h2><p>Scegli una serie e segna il primo episodio visto per iniziare.</p></div><button onClick={() => onNavigate('search')}>Cerca titoli</button></div>}
    <section className="home-upcoming"><SectionHeader title="In arrivo" action="Calendario" onAction={() => onNavigate('calendar')} />
      <div className="upcoming-list">{upcoming.length ? upcoming.slice(0, 4).map((item) => <button className="upcoming-row" key={item.id} onClick={() => onOpen(item)}>
        <img src={item.poster} alt="" /><span><strong>{item.title}</strong><small>{item.type === 'tv' ? `S${item.season || 1} · nuovo episodio` : 'Film'}</small></span><time dateTime={item.nextAirDate}>{formatDate(item.nextAirDate)}</time>
      </button>) : <EmptyState icon={CalendarDays} text="Cerco le prossime uscite in Italia." />}</div>
    </section>
    <section className="home-watchlist"><SectionHeader title="Da scegliere" action="Vedi libreria" onAction={() => onNavigate('library')} />
      {watchlist.length ? <div className="poster-rail">{watchlist.map((item) => <PosterCard item={item} key={item.id} onClick={() => onOpen(item)} />)}</div> : <EmptyState icon={Bookmark} text="I titoli che aggiungi compariranno qui." />}
    </section>
  </div>
}

function ProfilePage({ profile, onChange }: { profile: UserProfile; onChange: (profile: UserProfile) => void }) {
  const toggleGenre = (genre: string) => onChange({ ...profile, favoriteGenres: profile.favoriteGenres.includes(genre) ? profile.favoriteGenres.filter((entry) => entry !== genre) : [...profile.favoriteGenres, genre] })
  return <div className="page profile-page">
    <div className="profile-heading"><div className="avatar"><Sparkles /></div><div><p className="eyebrow">Preferenze</p><h1>I tuoi gusti</h1><p>Rendi più personali Catalogo e “Per te”.</p></div></div>
    <section className="profile-form" aria-labelledby="profile-genres-title">
      <div className="profile-form-heading"><div><p className="eyebrow">Cosa ti piace guardare?</p><h2 id="profile-genres-title">Scegli i tuoi generi</h2><p>Li usiamo per ordinare il catalogo e scegliere i titoli in “Per te”.</p></div><Sparkles /></div>
      <div className="profile-genres">{CATALOG_GENRES.map((genre) => <button key={genre} className={profile.favoriteGenres.includes(genre) ? 'active' : ''} aria-pressed={profile.favoriteGenres.includes(genre)} onClick={() => toggleGenre(genre)}>{genre}{profile.favoriteGenres.includes(genre) && <Check />}</button>)}</div>
    </section>
  </div>
}

function CloudSyncCard({ status, session, onSignIn, onSignOut }: {
  status: CloudSyncStatus; session: CloudSession | null; onSignIn: (username: string, password: string) => Promise<void>; onSignOut: () => Promise<void>
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [loginError, setLoginError] = useState('')
  const configured = status !== 'unavailable'
  const label = status === 'synced' ? 'I tuoi dati sono sincronizzati.'
    : status === 'syncing' ? 'Sincronizzazione in corso…'
      : status === 'checking' ? 'Controllo della sessione…'
        : status === 'error' ? 'Il cloud non è raggiungibile in questo momento.'
    : 'Accedi per salvare i dati anche nel cloud.'

  const login = async () => {
    const normalizedUsername = username.trim()
    if (!normalizedUsername || !password) return
    setPending(true)
    setLoginError('')
    try {
      await onSignIn(normalizedUsername, password)
      setUsername('')
      setPassword('')
    } catch {
      // The parent keeps the current session untouched; the generic message avoids account enumeration.
      setLoginError('Nome utente o password non validi.')
    } finally {
      setPending(false)
    }
  }

  return <section className="backup-card cloud-card" aria-labelledby="cloud-title">
    <div><p className="eyebrow">Sincronizzazione</p><h2 id="cloud-title"><Cloud /> Cloud personale</h2><p>{session ? `Connesso come @${session.username}.` : 'La tua libreria, i progressi e i gusti restano disponibili su ogni dispositivo.'}</p></div>
    <p className={status === 'error' ? 'backup-warning' : 'backup-current'} role="status">{configured ? label : 'Completa la configurazione di Supabase per attivarla.'}</p>
    {!session && <div className="cloud-login">
      <label htmlFor="cloud-username">Nome utente</label>
      <div><UserRound aria-hidden="true" /><input id="cloud-username" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="es. marco" value={username} onChange={(event) => { setUsername(event.target.value); setLoginError('') }} disabled={!configured || pending} /></div>
      <label htmlFor="cloud-password">Password</label>
      <div><KeyRound aria-hidden="true" /><input id="cloud-password" type="password" autoComplete="current-password" placeholder="La tua password" value={password} onChange={(event) => { setPassword(event.target.value); setLoginError('') }} disabled={!configured || pending} /><button className="primary-action" onClick={() => void login()} disabled={!configured || pending || !username.trim() || !password}>{pending ? 'Accesso…' : 'Accedi'}</button></div>
      {loginError && <small className="cloud-login-error" role="alert">{loginError}</small>}
      <small>Usa il nome utente assegnato a te. Non serve inserire un’email.</small>
    </div>}
    {session && <div className="backup-actions"><button className="secondary-action" onClick={() => void onSignOut()}><LogOut /> Disconnetti</button></div>}
  </section>
}

function AnalyticsPage({ library }: { library: MediaItem[] }) {
  const watchedMinutes = (item: MediaItem) => item.runtime * (item.type === 'tv' ? item.watchedEpisodes : item.status === 'completed' ? 1 : 0)
  const tvItems = library.filter((item) => item.type === 'tv')
  const movieItems = library.filter((item) => item.type === 'movie')
  const episodes = tvItems.reduce((sum, item) => sum + item.watchedEpisodes, 0)
  const moviesCompleted = movieItems.filter((item) => item.status === 'completed').length
  const minutes = library.reduce((sum, item) => sum + watchedMinutes(item), 0)
  const tvMinutes = tvItems.reduce((sum, item) => sum + watchedMinutes(item), 0)
  const movieMinutes = minutes - tvMinutes
  const completedSeries = tvItems.filter((item) => item.status === 'completed').length
  const watchingNow = library.filter((item) => item.status === 'watching').length
  const rated = library.filter((item) => item.rating > 0)
  const avgRating = rated.length ? rated.reduce((sum, item) => sum + item.rating, 0) / rated.length : 0
  const personallyRated = library.filter((item) => item.personalRating)
  const personalAvg = personallyRated.length ? personallyRated.reduce((sum, item) => sum + (item.personalRating || 0), 0) / personallyRated.length : 0
  const genreCounts = library.flatMap((item) => item.genres).reduce<Record<string, number>>((acc, genre) => ({ ...acc, [genre]: (acc[genre] || 0) + 1 }), {})
  const genres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]).slice(0, 5)
  const maxGenre = genres[0]?.[1] || 1
  const topByTime = library
    .map((item) => ({ item, minutes: watchedMinutes(item) }))
    .filter((entry) => entry.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 3)
  const maxTopMinutes = topByTime[0]?.minutes || 1
  const tvShare = minutes ? Math.round((tvMinutes / minutes) * 100) : 0
  return <div className="page analytics-page">
    <div className="profile-heading analytics-profile"><div className="avatar"><UserRound /></div><div><p className="eyebrow">Le tue statistiche</p><h1>La tua visione</h1><p>Il tempo e le storie che hai seguito.</p></div><span className="library-count">{library.length} {library.length === 1 ? 'titolo' : 'titoli'} in libreria</span></div>
    <section className="year-card">
      <div className="year-card-main">
        <span>Tempo di visione</span>
        <h2>{formatHours(minutes)} <small>ore</small></h2>
        <p>Tempo passato a guardare.</p>
      </div>
      <div className="year-stats" aria-label="Riepilogo della tua attività">
        <span><strong>{episodes}</strong> episodi visti</span>
        <span><strong>{moviesCompleted}</strong> film completati</span>
        <span><strong>{completedSeries}</strong> serie terminate</span>
      </div>
      <p className="year-source">Dati calcolati dalla tua libreria.</p>
      <Activity />
    </section>
    <section className="analytics-summary">
      <SectionHeader title="In breve" />
      <div className="metrics-grid">
      <Metric icon={CircleCheck} label="Serie terminate" value={completedSeries.toString()} note={`${tvItems.length} serie in libreria`} />
      <Metric icon={Film} label="Film completati" value={moviesCompleted.toString()} note={`${movieItems.length} film in libreria`} />
      <Metric icon={MonitorPlay} label="In corso ora" value={watchingNow.toString()} note="titoli che stai seguendo" />
      <Metric icon={Star} label="Voto medio" value={personalAvg ? `${personalAvg.toFixed(1)}/5` : avgRating ? avgRating.toFixed(1) : '—'} note={personalAvg ? 'media dei tuoi voti' : 'media TMDB dei tuoi titoli'} />
      </div>
    </section>

    <section>
      <SectionHeader title="La tua libreria" />
      <div className="analytics-charts">
        <article className="chart-card">
          <header><BarChart3 /><span>I tuoi titoli per stato</span><em>{library.length} {library.length === 1 ? 'titolo' : 'titoli'}</em></header>
          <StatusDonut library={library} />
        </article>
        <article className="chart-card">
          <header><Sparkles /><span>I generi che ricorrono di più</span><em>nella libreria</em></header>
          {genres.length ? <div className="genre-bars">{genres.map(([name, count]) => (
            <div className="genre-bar" key={name}><span>{name}</span><div><i style={{ width: `${(count / maxGenre) * 100}%` }} /></div><strong>{count}</strong></div>
          ))}</div> : <p className="chart-empty">Aggiungi titoli per calcolare i tuoi generi.</p>}
        </article>
        <article className="chart-card">
          <header><Clapperboard /><span>Serie e film</span><em>ore guardate</em></header>
          {minutes ? <>
            <div className="split-bar" role="img" aria-label={`${tvShare}% del tempo sulle serie, ${100 - tvShare}% sui film`}>
              <i style={{ width: `${tvShare}%`, background: 'var(--primary)' }} />
              <i style={{ width: `${100 - tvShare}%`, background: 'var(--blue)' }} />
            </div>
            <div className="split-legend">
              <span><i style={{ background: 'var(--primary)' }} />Serie<strong>{formatHours(tvMinutes)} h · {tvShare}%</strong></span>
              <span><i style={{ background: 'var(--blue)' }} />Film<strong>{formatHours(movieMinutes)} h · {100 - tvShare}%</strong></span>
            </div>
          </> : <p className="chart-empty">Segna episodi e film come visti per confrontare il tuo tempo.</p>}
        </article>
        <article className="chart-card">
          <header><Trophy /><span>I titoli più seguiti</span><em>per tempo di visione</em></header>
          {topByTime.length ? <div className="top-titles">{topByTime.map(({ item, minutes: itemMinutes }) => (
            <div className="top-title" key={item.id}>
              <img src={item.poster} alt="" />
              <div><strong>{item.title}</strong><span className="top-bar"><i style={{ width: `${(itemMinutes / maxTopMinutes) * 100}%` }} /></span></div>
              <em>{formatHours(itemMinutes)} h</em>
            </div>
          ))}</div> : <p className="chart-empty">Le storie a cui dedichi più tempo appariranno qui.</p>}
        </article>
      </div>
    </section>

    <footer className="credits">Dati e immagini forniti da <strong>TMDB</strong>; disponibilità streaming in Italia verificata con <strong>Watchmode</strong>. Questo prodotto usa le API TMDB e Watchmode ma non è approvato o certificato da nessuno dei due.</footer>
  </div>
}

function StatusDonut({ library }: { library: MediaItem[] }) {
  const counts = statusOrder.map((status) => ({ status, value: library.filter((item) => item.status === status).length }))
  const total = counts.reduce((sum, entry) => sum + entry.value, 0)
  let acc = 0
  const slices = counts.filter((entry) => entry.value > 0).map((entry) => {
    const pct = (entry.value / total) * 100
    const slice = { ...entry, pct, offset: 25 - acc }
    acc += pct
    return slice
  })
  return <div className="donut-wrap">
    <div className="donut">
      <svg viewBox="0 0 42 42" role="img" aria-label="Distribuzione della libreria per stato">
        <circle cx="21" cy="21" r="15.9155" fill="none" stroke="#1c2336" strokeWidth="4" />
        {slices.map((slice) => <circle key={slice.status} cx="21" cy="21" r="15.9155" fill="none" stroke={STATUS_COLORS[slice.status]} strokeWidth="4" strokeDasharray={`${slice.pct >= 99.9 ? 100 : Math.max(slice.pct - 1.2, 0)} 100`} strokeDashoffset={slice.offset} />)}
      </svg>
      <div><strong>{total}</strong><span>{total === 1 ? 'titolo' : 'titoli'}</span></div>
    </div>
    <ul className="donut-legend">{counts.map((entry) => <li key={entry.status}><i style={{ background: STATUS_COLORS[entry.status] }} />{STATUS_META[entry.status].short}<strong>{entry.value}</strong></li>)}</ul>
  </div>
}

function PosterCard({ item, onClick }: { item: MediaItem; onClick: () => void }) {
  return <button className="poster-card" onClick={onClick}><img src={item.poster} alt={`Copertina di ${item.title}`} /><span>{item.title}</span><small>{item.year} · {item.rating || '—'}</small></button>
}

function Metric({ icon: Icon, label, value, note }: { icon: typeof Eye; label: string; value: string; note: string }) {
  return <article className="metric-row"><div className="metric-label"><Icon /><span>{label}</span></div><strong>{value}</strong><small>{note}</small></article>
}

function EmptyState({ icon: Icon, text }: { icon: typeof CalendarDays; text: string }) {
  return <div className="empty-state"><Icon /><p>{text}</p></div>
}

const EXPLORE_FEEDS: Array<{ id: ExploreFeed; label: string; note: string }> = [
  { id: 'popular', label: 'Catalogo', note: 'Titoli disponibili in Italia' },
  { id: 'upcoming', label: 'In uscita', note: 'Prossime uscite con data confermata' },
]

const EXPLORE_ICONS: Record<ExploreFeed, typeof Flame> = { popular: Flame, trending: Activity, upcoming: CalendarDays, 'top-rated': Trophy, cinema: Clapperboard }

function SearchPageV2({ discovery, library, apiMode, favoriteGenres, onOpen, onToggle, hidden = false }: {
  discovery: MediaItem[]; library: MediaItem[]; apiMode: string; favoriteGenres: string[]; onOpen: (item: MediaItem) => void; onToggle: (item: MediaItem) => void; hidden?: boolean
}) {
  const [query, setQuery] = useState('')
  const [type, setType] = useState<'all' | 'tv' | 'movie'>('all')
  const [feed, setFeed] = useState<ExploreFeed>('popular')
  const [selectedGenres, setSelectedGenres] = useState<string[]>([])
  const [genrePickerOpen, setGenrePickerOpen] = useState(false)
  const [catalogPage, setCatalogPage] = useState(1)
  const [catalogHasMore, setCatalogHasMore] = useState(true)
  const [results, setResults] = useState(discovery)
  const [loading, setLoading] = useState(false)
  const [personalizedPage, setPersonalizedPage] = useState(1)
  const [personalizedResults, setPersonalizedResults] = useState<MediaItem[]>([])
  const [personalizedResultKey, setPersonalizedResultKey] = useState('')
  const [personalizedLoading, setPersonalizedLoading] = useState(false)
  const [personalizedHasMore, setPersonalizedHasMore] = useState(true)
  const catalogRequestRef = useRef(0)
  const searching = query.trim().length >= 2
  const isCatalog = !searching && feed === 'popular'
  const loadingMore = loading && isCatalog && catalogPage > 1 && results.length > 0
  const preferredCatalogGenres = useMemo(() => selectedGenres.length
    ? selectedGenres as Array<typeof CATALOG_GENRES[number]>
    : favoriteGenres.filter((genre): genre is typeof CATALOG_GENRES[number] => CATALOG_GENRES.includes(genre as typeof CATALOG_GENRES[number]) && getCatalogGenresForType(type).includes(genre as typeof CATALOG_GENRES[number])), [selectedGenres, favoriteGenres, type])

  useEffect(() => {
    let cancelled = false
    const request = ++catalogRequestRef.current
    const timer = window.setTimeout(async () => {
      if (cancelled) return
      setLoading(true)
      try {
        let items: MediaItem[]
        if (searching) {
          items = await searchTmdb(query.trim(), type === 'all' ? 'multi' : type)
        } else if (apiMode === 'live' && isCatalog) {
          const preferred = !selectedGenres.length && preferredCatalogGenres.length
            ? await getExploreCatalog(feed, type, preferredCatalogGenres, catalogPage)
            : []
          const general = await getExploreCatalog(feed, type, selectedGenres as Array<typeof CATALOG_GENRES[number]>, catalogPage)
          items = [...preferred, ...general].filter((item, index, all) => all.findIndex((entry) => entry.id === item.id) === index)
        } else {
          items = apiMode === 'live'
            ? await getExploreCatalog(feed, type, [], isCatalog ? catalogPage : 1)
            : discovery.filter((item) => type === 'all' || item.type === type)
        }
        if (cancelled || catalogRequestRef.current !== request) return
        setResults((current) => isCatalog && catalogPage > 1 ? [...current, ...items].filter((item, index, all) => all.findIndex((entry) => entry.id === item.id) === index) : items)
        if (isCatalog) setCatalogHasMore(items.length > 0)
      } catch {
        if (cancelled || catalogRequestRef.current !== request) return
        const lowered = query.toLowerCase()
        setResults(discovery.filter((item) => (type === 'all' || item.type === type) && (!lowered || item.title.toLowerCase().includes(lowered))))
      } finally {
        if (!cancelled && catalogRequestRef.current === request) setLoading(false)
      }
    }, query ? 380 : 80)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [query, type, feed, selectedGenres, favoriteGenres, preferredCatalogGenres, catalogPage, discovery, apiMode, isCatalog, searching])

  const genres = useMemo(() => [...new Set(results.flatMap((item) => item.genres))].slice(0, 7), [results])
  const availableGenres = isCatalog ? getCatalogGenresForType(type) : genres
  const changeType = (nextType: 'all' | 'tv' | 'movie') => {
    setType(nextType)
    setSelectedGenres((current) => current.filter((genre) => getCatalogGenresForType(nextType).includes(genre as typeof CATALOG_GENRES[number])))
    setCatalogPage(1)
    setCatalogHasMore(true)
  }
  const visible = (isCatalog
    ? [...results].sort((a, b) => {
      const score = (item: MediaItem) => favoriteGenres.reduce((total, genre) => total + (itemMatchesCatalogGenres(item, [genre as typeof CATALOG_GENRES[number]]) ? 1 : 0), 0)
      return score(b) - score(a)
    })
    : [...results].sort((a, b) => {
      const aDate = a.nextAirDate || `${a.year}-01-01`
      const bDate = b.nextAirDate || `${b.year}-01-01`
      return bDate.localeCompare(aDate)
    }))
    .filter((item) => !isCatalog || itemMatchesCatalogGenres(item, selectedGenres as Array<typeof CATALOG_GENRES[number]>))
  const favoriteGenreIds = useMemo(() => getCatalogGenreIds(favoriteGenres), [favoriteGenres])
  const libraryTasteWeights = useMemo(() => {
    const weights: Record<number, number> = {}
    library.forEach((entry) => {
      const boost = entry.personalRating && entry.personalRating >= 4 ? 4 : entry.status === 'completed' ? 3 : entry.status === 'watching' ? 2 : 1
      getItemGenreIds(entry).forEach((genreId) => { weights[genreId] = (weights[genreId] || 0) + boost })
    })
    return weights
  }, [library])
  // A genre selected in Preferenze is a rule, not just another ranking signal.
  // Library history is used only when the user has not declared any preference.
  const tasteWeights = useMemo(() => favoriteGenreIds.length
    ? Object.fromEntries(favoriteGenreIds.map((genreId) => [genreId, 5])) as Record<number, number>
    : libraryTasteWeights, [favoriteGenreIds, libraryTasteWeights])
  const tasteGenreIds = useMemo(() => Object.keys(tasteWeights).map(Number).sort((a, b) => a - b), [tasteWeights])
  const tasteGenreKey = tasteGenreIds.join('|')
  const personalizedCatalogGenres = useMemo(() => getCatalogGenresForIds(tasteGenreIds), [tasteGenreKey])

  useEffect(() => {
    let cancelled = false
    if (searching || !tasteGenreIds.length) {
      setPersonalizedResults([])
      setPersonalizedResultKey('')
      return () => { cancelled = true }
    }
    setPersonalizedLoading(true)
    setPersonalizedResultKey('')
    const loadPersonalized = async () => {
      try {
        const items = apiMode === 'live'
          ? await getExploreCatalog('popular', 'all', personalizedCatalogGenres, personalizedPage)
          : discovery
        if (cancelled) return
        setPersonalizedResults(items)
        setPersonalizedResultKey(tasteGenreKey)
        setPersonalizedHasMore(apiMode === 'live' && items.length > 0)
      } catch {
        if (!cancelled) setPersonalizedHasMore(false)
      } finally {
        if (!cancelled) setPersonalizedLoading(false)
      }
    }
    void loadPersonalized()
    return () => { cancelled = true }
  }, [apiMode, discovery, personalizedCatalogGenres, personalizedPage, searching, tasteGenreKey])

  useEffect(() => {
    setPersonalizedPage(1)
    setPersonalizedHasMore(true)
  }, [tasteGenreKey])

  const personalized = useMemo(() => personalizedResultKey === tasteGenreKey ? personalizedResults
    .map((item) => ({ item, score: getItemGenreIds(item).reduce((total, genreId) => total + (tasteWeights[genreId] || 0), 0) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map(({ item }) => item) : [], [personalizedResultKey, personalizedResults, tasteGenreKey, tasteWeights])
  const hasLibrarySignals = library.some((item) => getItemGenreIds(item).length > 0)
  const personalizationSource = favoriteGenreIds.length ? 'Preferenze dichiarate' : 'Dalla tua libreria'
  const activeFeed = EXPLORE_FEEDS.find((entry) => entry.id === feed) || EXPLORE_FEEDS[0]
  const title = searching ? `Risultati per “${query.trim()}”` : activeFeed.label
  const emptyText = searching
    ? 'Nessun titolo italiano corrisponde alla ricerca. Prova con un altro nome.'
    : feed === 'upcoming'
      ? 'Nessuna uscita italiana con data e servizio già confermati.'
      : 'Nessun titolo italiano corrisponde ai filtri selezionati.'

  return <div className="page search-page explore-page" hidden={hidden}>
    <div className="page-intro compact-intro"><p className="eyebrow">Catalogo italiano</p><h1>Cosa vuoi guardare?</h1><p>Cerca un titolo o esplora le raccolte disponibili in Italia.</p></div>
    <label className="search-field explore-search"><span className="sr-only">Cerca film o serie</span><SearchIcon size={19} /><input value={query} onChange={(event) => { setQuery(event.target.value); setCatalogPage(1) }} placeholder="Titolo, film o serie…" autoComplete="off" />{query && <button onClick={() => { setQuery(''); setCatalogPage(1) }} aria-label="Cancella ricerca"><X size={17} /></button>}</label>
    {!searching && <section className="explore-collections" aria-label="Raccolte"><p>Raccolte</p><div>{EXPLORE_FEEDS.map((entry) => { const Icon = EXPLORE_ICONS[entry.id]; return <button key={entry.id} className={feed === entry.id ? 'active' : ''} aria-pressed={feed === entry.id} onClick={() => { setFeed(entry.id); setType('all'); setSelectedGenres([]); setCatalogPage(1); setCatalogHasMore(true) }}><Icon /><span>{entry.label}</span></button> })}</div></section>}
    {!searching && (personalized.length > 0 || personalizedLoading) && <section className="personalized-section" aria-labelledby="personalized-title"><div className="section-header"><div><p className="eyebrow">Basato sui tuoi gusti</p><h2 id="personalized-title">Per te</h2></div><span>{personalizationSource}</span></div>{personalized.length ? <div className="personalized-grid">{personalized.map((item) => <CompactMediaCard key={item.id} item={item} showRelease={false} saved={library.some((entry) => entry.id === item.id)} onOpen={() => onOpen(item)} onToggle={() => onToggle(item)} />)}</div> : <div className="personalized-loading" role="status" aria-live="polite"><RefreshCw /> Cerco titoli per te...</div>}<button className="personalized-refresh" onClick={() => setPersonalizedPage((page) => page + 1)} disabled={personalizedLoading || !personalizedHasMore} aria-label="Carica altri suggerimenti basati sui tuoi gusti">{personalizedLoading ? <><RefreshCw className="is-spinning" /> Aggiorno suggerimenti...</> : <><RefreshCw /> Altri suggerimenti</>}</button></section>}
    <div className="explore-controls"><div className="type-filter" aria-label="Filtra tipo"><button className={type === 'all' ? 'active' : ''} aria-pressed={type === 'all'} onClick={() => changeType('all')}>Tutto</button><button className={type === 'tv' ? 'active' : ''} aria-pressed={type === 'tv'} onClick={() => changeType('tv')}>Serie TV</button><button className={type === 'movie' ? 'active' : ''} aria-pressed={type === 'movie'} onClick={() => changeType('movie')}>Film</button></div>{availableGenres.length > 0 && <button className={`genre-trigger ${selectedGenres.length ? 'active' : ''}`} onClick={() => setGenrePickerOpen(true)}><ListFilter /> {selectedGenres.length ? `${selectedGenres.length} generi` : 'Generi'}</button>}</div>
    {genrePickerOpen && <div className="genre-sheet-wrap" role="presentation"><button className="genre-sheet-backdrop" onClick={() => setGenrePickerOpen(false)} aria-label="Chiudi generi" /><section className="genre-sheet" aria-label="Generi catalogo"><div className="genre-sheet-handle" /><div className="genre-sheet-heading"><div><p className="eyebrow">Catalogo italiano</p><h2>Generi</h2></div><button className="genre-reset" onClick={() => { setSelectedGenres([]); setCatalogPage(1); setCatalogHasMore(true) }}>Cancella</button></div><div className="genre-sheet-options">{availableGenres.map((name) => { const selected = selectedGenres.includes(name); return <button key={name} className={selected ? 'active' : ''} aria-pressed={selected} onClick={() => { setSelectedGenres((current) => current.includes(name) ? current.filter((genre) => genre !== name) : [...current, name]); setCatalogPage(1); setCatalogHasMore(true) }}><span>{name}</span>{selected && <Check />}</button> })}</div><button className="genre-apply" onClick={() => setGenrePickerOpen(false)}>Mostra risultati</button></section></div>}
    <div className="explore-heading"><div><p>{searching ? 'Catalogo italiano' : activeFeed.note}</p><h2>{title}</h2></div><span>{visible.length} {visible.length === 1 ? 'titolo' : 'titoli'}</span></div>
    {loading && !loadingMore ? <div className="compact-loading" aria-busy="true" aria-label="Caricamento titoli">{[1,2,3,4,5,6].map((value) => <span key={value} />)}</div> : visible.length ? <><div className="explore-grid">{visible.map((item) => <CompactMediaCard key={item.id} item={item} showRelease={!searching && feed === 'upcoming'} saved={library.some((entry) => entry.id === item.id)} onOpen={() => onOpen(item)} onToggle={() => onToggle(item)} />)}</div>{loadingMore ? <div className="catalog-more-loading" role="status" aria-live="polite"><RefreshCw /> Carico altri titoli...</div> : isCatalog && catalogHasMore && <button className="catalog-more" onClick={() => setCatalogPage((page) => page + 1)}>Carica altri titoli</button>}</> : <EmptyState icon={SearchIcon} text={emptyText} />}
  </div>
}

function CompactMediaCard({ item, showRelease, saved, onOpen, onToggle }: { item: MediaItem; showRelease: boolean; saved: boolean; onOpen: () => void; onToggle: () => void }) {
  const release = item.type === 'tv'
    ? item.nextAirDate ? `Stagione ${item.season || 1} · dal ${formatDate(item.nextAirDate, { day: 'numeric', month: 'short', year: 'numeric' })}` : `Stagione ${item.season || 1} · data da confermare`
    : item.nextAirDate ? `Uscita ${formatDate(item.nextAirDate, { day: 'numeric', month: 'short', year: 'numeric' })}` : 'Disponibilità italiana'
  const availability = showRelease ? release : `${item.type === 'tv' ? 'Serie' : 'Film'} disponibile in Italia`
  const provider = item.watchProviders?.[0]?.name || 'Italia verificata'
  return <article className="compact-media-card"><button className="compact-media-main" onClick={onOpen}><img src={item.poster} alt={`Copertina di ${item.title}`} loading="lazy" /><span><small>{item.type === 'tv' ? 'SERIE' : 'FILM'} · {item.year}</small><strong>{item.title}</strong><em>{availability}</em><small className="card-availability">{provider} · <Star size={11} /> {item.rating || '—'}</small></span></button><button className={saved ? 'saved' : ''} onClick={onToggle} aria-label={saved ? `Rimuovi ${item.title}` : `Aggiungi ${item.title}`}>{saved ? <Check /> : <Plus />}</button></article>
}

function CalendarPageV2({ library, onOpen }: { library: MediaItem[]; onOpen: (item: MediaItem) => void }) {
  const dated = library.filter((item) => isUpcomingDate(item.nextAirDate)).sort((a, b) => (a.nextAirDate || '').localeCompare(b.nextAirDate || ''))
  const todayIso = toLocalDateKey()
  const [offset, setOffset] = useState(0)
  const [selectedDate, setSelectedDate] = useState(todayIso)
  const [showAllReleases, setShowAllReleases] = useState(false)
  const startOfWeek = (value: Date) => {
    const date = new Date(value)
    const day = date.getDay() || 7
    date.setDate(date.getDate() - day + 1)
    return date
  }
  const base = new Date()
  base.setDate(base.getDate() + offset * 7)
  const weekStart = startOfWeek(base)
  const week = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart)
    date.setDate(weekStart.getDate() + index)
    return date
  })
  const selectedItems = dated.filter((item) => item.nextAirDate === selectedDate)
  const visibleItems = showAllReleases ? dated : selectedItems
  const nextRelease = dated.find((item) => item.nextAirDate && item.nextAirDate >= todayIso) || dated[0]
  const selectedLabel = formatDate(selectedDate, { weekday: 'long', day: 'numeric', month: 'long' })
  const goToday = () => { setOffset(0); setSelectedDate(todayIso); setShowAllReleases(false) }
  const moveWeek = (direction: number) => {
    const nextOffset = offset + direction
    const nextBase = new Date()
    nextBase.setDate(nextBase.getDate() + nextOffset * 7)
    setOffset(nextOffset)
    setSelectedDate(toLocalDateKey(startOfWeek(nextBase)))
    setShowAllReleases(false)
  }
  const goToReleases = () => {
    if (!nextRelease?.nextAirDate) return
    const target = new Date(`${nextRelease.nextAirDate}T12:00:00`)
    const currentWeek = startOfWeek(new Date())
    const targetWeek = startOfWeek(target)
    const targetOffset = Math.round((targetWeek.getTime() - currentWeek.getTime()) / (7 * 24 * 60 * 60 * 1000))
    setOffset(targetOffset)
    setSelectedDate(nextRelease.nextAirDate)
    setShowAllReleases(true)
  }

  return <div className="page calendar-page calendar-v2">
    <div className="page-intro split">
      <div><p className="eyebrow">Agenda personale</p><h1>{new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' }).format(base)}</h1><p>Uscite dei film e delle serie che hai salvato.</p></div>
      <div className="week-controls"><button onClick={() => moveWeek(-1)} aria-label="Settimana precedente"><ChevronLeft /></button><button onClick={goToday}>Oggi</button><button onClick={() => moveWeek(1)} aria-label="Settimana successiva"><ChevronRight /></button></div>
    </div>
    <div className="calendar-layout">
      <section className="date-navigator" aria-label="Seleziona un giorno">
        <div className="week-strip">{week.map((date) => {
          const iso = toLocalDateKey(date)
          const count = dated.filter((item) => item.nextAirDate === iso).length
          return <button key={iso} className={`${todayIso === iso ? 'today' : ''} ${selectedDate === iso ? 'selected' : ''}`} onClick={() => { setSelectedDate(iso); setShowAllReleases(false) }} aria-pressed={selectedDate === iso} aria-label={`${formatDate(iso, { weekday: 'long', day: 'numeric', month: 'long' })}, ${count} uscite`}><span>{new Intl.DateTimeFormat('it-IT', { weekday: 'short' }).format(date)}</span><strong>{date.getDate()}</strong>{count > 0 && <em>{count}</em>}</button>
        })}</div>
        {nextRelease ? <button className="calendar-note calendar-note-action" onClick={goToReleases} aria-label={`Mostra tutte le uscite programmate, a partire da ${nextRelease.title} il ${formatDate(nextRelease.nextAirDate)}`}><CalendarDays /><span><strong>Vedi tutte le uscite</strong><small>{dated.length} {dated.length === 1 ? 'uscita programmata' : 'uscite programmate'} · prossima: {formatDate(nextRelease.nextAirDate)}</small></span><ChevronRight /></button> : <div className="calendar-note"><CalendarDays /><span><strong>Nessuna uscita programmata</strong><small>Aggiungi un titolo con una data di uscita.</small></span></div>}
      </section>
      <section className="calendar-feed">
        <div className="agenda-heading"><div><p className="eyebrow">{showAllReleases ? 'Agenda futura' : 'Giorno selezionato'}</p><h2>{showAllReleases ? 'Tutte le uscite' : selectedLabel}</h2></div><span>{visibleItems.length} {visibleItems.length === 1 ? 'uscita' : 'uscite'}</span></div>
        {visibleItems.length ? visibleItems.map((item) => <article className="calendar-event" key={item.id}>
          <div className={`date-tile ${item.type}`}><span>{formatDate(item.nextAirDate, { month: 'short' })}</span><strong>{new Date(`${item.nextAirDate}T12:00:00`).getDate()}</strong></div>
          <button onClick={() => onOpen(item)}><img src={item.backdrop} alt="" /><span><small>{item.type === 'tv' ? `SERIE · S${item.season || 1}` : 'FILM · USCITA'}</small><strong>{item.title}</strong><em>{item.type === 'tv' ? `Episodio ${item.nextEpisode || 'nuovo'}` : 'Disponibilità italiana'}</em></span><ChevronRight /></button>
        </article>) : <EmptyState icon={CalendarDays} text={`Nessuna uscita ${selectedDate === todayIso ? 'oggi' : 'in questo giorno'}. Seleziona un giorno con il contatore.`} />}
      </section>
    </div>
  </div>
}

function LibraryPageV2({ library, onOpen, onNavigate }: { library: MediaItem[]; onOpen: (item: MediaItem) => void; onNavigate: (tab: TabId) => void }) {
  const [type, setType] = useState<'all' | 'tv' | 'movie'>('all')
  const [showMoreWatching, setShowMoreWatching] = useState(false)
  const [waitingOpen, setWaitingOpen] = useState(true)
  const [completedOpen, setCompletedOpen] = useState(false)
  const titlesForType = library.filter((item) => type === 'all' || item.type === type)
  const byTitle = (items: MediaItem[]) => [...items].sort((a, b) => a.title.localeCompare(b.title))
  const continueWatching = titlesForType.filter((item) => item.type === 'tv' && item.status === 'watching')
  const queueItems = byTitle(titlesForType.filter((item) => item.status === 'watchlist'))
  const waitingItems = byTitle(titlesForType.filter((item) => item.status === 'caught-up' || item.status === 'waiting'))
  const completedItems = byTitle(titlesForType.filter((item) => item.status === 'completed'))

  const renderItems = (items: MediaItem[]) => <div className="library-grid">{items.map((item, index) => {
    const isStartedSeries = item.type === 'tv' && item.watchedEpisodes > 0
    const detail = item.type === 'tv'
      ? isStartedSeries ? `${item.watchedEpisodes} di ${item.totalEpisodes} episodi` : item.totalEpisodes ? `${item.totalEpisodes} episodi` : 'Serie TV'
      : `${item.year} - ${item.runtime} min`
    return <button className={`library-item ${item.status}`} key={item.id} style={{ animationDelay: `${Math.min(index, 8) * 90}ms` }} onClick={() => onOpen(item)}>
      <img src={item.poster} alt={`Copertina di ${item.title}`} />
      <div><span className={`status-label ${item.status}`}>{STATUS_META[item.status].label}</span><h2>{item.title}</h2><p>{detail}{item.personalRating ? <span className="card-rating">Voto {item.personalRating}/5</span> : null}</p>{isStartedSeries && <span className="progress"><i style={{ width: `${(item.watchedEpisodes / Math.max(item.totalEpisodes, 1)) * 100}%` }} /></span>}</div>
      <ChevronRight />
    </button>
  })}</div>

  if (!library.length) return <div className="page library-page library-v2"><div className="page-intro"><p className="eyebrow">Il tuo archivio</p><h1>Libreria</h1></div><section className="library-empty"><span><Library /></span><p className="eyebrow">Il tuo spazio personale</p><h2>Costruisci la tua libreria</h2><p>Salva un titolo oppure segna un episodio: progressi, prossime uscite e statistiche si organizzeranno qui.</p><div><button onClick={() => onNavigate('search')}><Tv /> Scopri serie</button><button onClick={() => onNavigate('search')}><Film /> Scopri film</button></div></section></div>

  return <div className="page library-page library-v2">
    <div className="page-intro"><p className="eyebrow">Il tuo archivio</p><h1>Libreria</h1><p>{library.length} titoli, ordinati per la tua prossima visione.</p></div>
    {continueWatching.length > 0 && <section className="library-focus"><SectionHeader title="Continua a guardare" /><button className="library-primary" onClick={() => onOpen(continueWatching[0])}><img src={continueWatching[0].poster} alt="" /><span><small>PROSSIMO - S{continueWatching[0].lastWatchedSeason || continueWatching[0].season || 1} E{(continueWatching[0].lastWatchedEpisode || continueWatching[0].watchedEpisodes) + 1}</small><strong>{continueWatching[0].title}</strong><span className="progress"><i style={{ width: `${(continueWatching[0].watchedEpisodes / Math.max(continueWatching[0].totalEpisodes, 1)) * 100}%` }} /></span></span><ChevronRight /></button>{continueWatching.length > 1 && <><button className="library-more" onClick={() => setShowMoreWatching((open) => !open)} aria-expanded={showMoreWatching}>+ {continueWatching.length - 1} altra serie in corso <ChevronDown className={showMoreWatching ? 'open' : ''} /></button>{showMoreWatching && renderItems(continueWatching.slice(1))}</>}</section>}
    <div className="type-segment" role="group" aria-label="Filtra per tipo">
      {([['all', 'Tutto'], ['tv', 'Serie'], ['movie', 'Film']] as const).map(([value, label]) => <button key={value} className={type === value ? 'active' : ''} aria-pressed={type === value} onClick={() => setType(value)}>{label}</button>)}
    </div>
    <section className="library-collection library-queue"><div className="library-collection-heading"><div><p className="eyebrow">La tua coda</p><h2>Da scegliere</h2></div><span>{queueItems.length}</span></div>{queueItems.length ? renderItems(queueItems) : <EmptyState icon={Bookmark} text="Nessun titolo da scegliere con questo filtro." />}</section>
    {waitingItems.length > 0 && <section className="library-collection"><button className="library-collection-toggle" onClick={() => setWaitingOpen((open) => !open)} aria-expanded={waitingOpen}><span><p className="eyebrow">In attesa</p><h2>In pari o in uscita</h2></span><span>{waitingItems.length}<ChevronDown className={waitingOpen ? 'open' : ''} /></span></button>{waitingOpen && renderItems(waitingItems)}</section>}
    {completedItems.length > 0 && <section className="library-collection"><button className="library-collection-toggle" onClick={() => setCompletedOpen((open) => !open)} aria-expanded={completedOpen}><span><p className="eyebrow">Storico</p><h2>Terminati</h2></span><span>{completedItems.length}<ChevronDown className={completedOpen ? 'open' : ''} /></span></button>{completedOpen && renderItems(completedItems)}</section>}
  </div>
}

function DetailPageV2({ item, saved, onBack, onToggle, onStatus, onMark, onEpisode, onSeasonStatus, onOpen, onRate, episodes, season, loading, onSeason }: {
  item: MediaItem; saved: boolean; onBack: () => void; onToggle: () => void; onMark: () => void;
  onStatus: (status: MediaStatus) => void;
  onEpisode: (episode: Episode, watched: boolean, visibleEpisodes: Episode[]) => void;
  onSeasonStatus: (season: number, status: SeasonStatus, visibleEpisodes: Episode[]) => void;
  onOpen: (item: MediaItem) => void; onRate: (rating: number) => void;
  episodes: Episode[]; season: number; loading: boolean; onSeason: (season: number) => void
}) {
  const [selectedEpisode, setSelectedEpisode] = useState<Episode | null>(null)
  const [providersOpen, setProvidersOpen] = useState(false)
  const [seasonMenuOpen, setSeasonMenuOpen] = useState(false)
  const [overviewOpen, setOverviewOpen] = useState(false)
  const [similar, setSimilar] = useState<MediaItem[]>([])
  const progress = Math.round((item.watchedEpisodes / Math.max(item.totalEpisodes, 1)) * 100)
  const isWatched = (episode: Episode, index: number) => item.watchedEpisodeIds ? item.watchedEpisodeIds.includes(episode.id) : episode.season === (item.lastWatchedSeason || 1) && index < item.watchedEpisodes
  const releaseDate = item.releaseDate || (item.type === 'movie' ? item.nextAirDate : undefined)

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    setOverviewOpen(false)
    setProvidersOpen(false)
    setSimilar([])
    if (!item.tmdbId) return
    let cancelled = false
    getSimilarTitles(item).then((titles) => { if (!cancelled) setSimilar(titles) }).catch(() => {})
    return () => { cancelled = true }
  }, [item.id, item.tmdbId])
  const inferredSeasonStatus: SeasonStatus = episodes.length && episodes.every((episode, index) => isWatched(episode, index))
    ? 'completed'
    : episodes.some((episode, index) => isWatched(episode, index)) ? 'watching' : 'watchlist'
  const seasonStatus = item.seasonProgress?.[String(season)]?.status || inferredSeasonStatus
  const getSeasonStatus = (seasonNumber: number): SeasonStatus => {
    if (seasonNumber === season) return seasonStatus
    return item.seasonProgress?.[String(seasonNumber)]?.status || 'watchlist'
  }

  if (selectedEpisode) {
    const index = episodes.findIndex((episode) => episode.id === selectedEpisode.id)
    const watched = isWatched(selectedEpisode, index)
    return <EpisodePage episode={selectedEpisode} series={item} watched={watched} onBack={() => setSelectedEpisode(null)} onToggle={() => onEpisode(selectedEpisode, !watched, episodes)} onPrevious={index > 0 ? () => setSelectedEpisode(episodes[index - 1]) : undefined} onNext={index < episodes.length - 1 ? () => setSelectedEpisode(episodes[index + 1]) : undefined} />
  }

  return <div className="detail-page">
    <section className="detail-hero" style={{ '--detail-backdrop': `url(${item.backdrop})` } as React.CSSProperties}><div className="detail-actions"><button onClick={onBack} aria-label="Torna indietro"><ChevronLeft /></button><button className={saved ? 'saved' : ''} onClick={onToggle} aria-label={saved ? 'Rimuovi dalla libreria' : 'Aggiungi alla libreria'}>{saved ? <Check /> : <Plus />}</button></div><div className="detail-title"><span className={`status-label ${item.status}`}>{STATUS_META[item.status].label}</span><h1>{item.title}</h1><p>{item.genres.join(' · ') || (item.type === 'tv' ? 'Serie TV' : 'Film')} · {item.type === 'tv' && releaseDate ? `dal ${formatDate(releaseDate, { month: 'long', year: 'numeric' })}` : item.year}</p></div></section>
    <div className="detail-content"><img className="detail-poster" src={item.poster} alt={`Copertina di ${item.title}`} /><div className="detail-summary"><p className={overviewOpen ? 'open' : ''}>{item.overview}</p>{item.overview.length > 180 && <button className="overview-toggle" onClick={() => setOverviewOpen((open) => !open)}>{overviewOpen ? 'Mostra meno' : 'Leggi tutto'}</button>}<div className="mini-facts"><span><strong>{item.rating || '—'}</strong> voto</span><span><strong>{item.runtime}</strong> min</span><span><strong>{item.type === 'tv' ? item.totalEpisodes : releaseDate ? formatDate(releaseDate, { day: 'numeric', month: 'short', year: 'numeric' }) : item.year}</strong> {item.type === 'tv' ? 'episodi' : 'uscita'}</span></div></div>
      {item.watchProviders?.length ? <section className="providers-panel"><button className="providers-toggle" onClick={() => setProvidersOpen((open) => !open)} aria-expanded={providersOpen}><span className="providers-icon"><MonitorPlay /></span><span className="providers-copy"><small>Disponibilità in Italia</small><strong>Dove guardarlo</strong></span>{!providersOpen && <span className="providers-preview">{item.watchProviders.slice(0, 3).map((provider) => provider.logo ? <img key={provider.name} src={provider.logo} alt="" /> : null)}<em>{item.watchProviders.length} {item.watchProviders.length === 1 ? 'servizio' : 'servizi'}</em></span>}<ChevronDown /></button>{providersOpen && <div className="provider-list">{item.watchProviders.map((provider) => <div className="provider" key={provider.name}>{provider.logo ? <img src={provider.logo} alt="" /> : <MonitorPlay />}<span><strong>{provider.name}</strong><small>{provider.availability}</small></span></div>)}</div>}</section> : null}
      {item.type === 'movie' && <section className="movie-status"><p className="eyebrow">{saved ? 'Nella tua libreria' : 'Aggiungi alla libreria'}</p><div className="movie-status-actions"><button className={saved && item.status === 'watchlist' ? 'active watchlist' : ''} aria-pressed={saved && item.status === 'watchlist'} onClick={() => onStatus('watchlist')}><Star />Da vedere{saved && item.status === 'watchlist' && <Check />}</button><button className={saved && item.status === 'completed' ? 'active completed' : ''} aria-pressed={saved && item.status === 'completed'} onClick={() => onStatus('completed')}><CircleCheck />Visto{saved && item.status === 'completed' && <Check />}</button></div></section>}
      {saved && <section className="personal-rating"><div><p className="eyebrow">Il tuo voto</p><strong>{item.personalRating ? `${item.personalRating} su 5` : 'Non ancora valutato'}</strong></div><div className="rating-stars" role="group" aria-label="Il tuo voto">{[1, 2, 3, 4, 5].map((value) => <button key={value} className={item.personalRating && item.personalRating >= value ? 'active' : ''} aria-label={`${value} su 5`} onClick={() => onRate(item.personalRating === value ? 0 : value)}><Star /></button>)}</div></section>}
      {item.type === 'tv' && <section className="progress-panel"><div className="progress-ring" style={{ '--progress': `${progress * 3.6}deg` } as React.CSSProperties}><span>{progress}%</span></div><div><span>Il tuo avanzamento</span><strong>{item.watchedEpisodes} di {item.totalEpisodes} episodi visti</strong><span className="progress"><i style={{ width: `${progress}%` }} /></span></div></section>}
      {item.type === 'tv' ? <section className="episode-section"><SectionHeader title={`Stagione ${season}`} />{(item.seasonCount || 1) > 1 && <div className="season-tabs">{Array.from({ length: item.seasonCount || 1 }, (_, index) => index + 1).map((number) => { const tabStatus = getSeasonStatus(number); const statusLabel = tabStatus === 'completed' ? 'Completata' : tabStatus === 'watching' ? 'In corso' : 'Da vedere'; return <button key={number} className={`${season === number ? 'active ' : ''}${tabStatus}`} onClick={() => onSeason(number)} aria-label={`Stagione ${number}: ${statusLabel}`} aria-current={season === number ? 'true' : undefined}><span>S{number}</span><i aria-hidden="true">{tabStatus === 'completed' ? <Check /> : tabStatus === 'watching' ? <Activity /> : <Circle />}</i></button> })}</div>}<div className="series-status-control"><p className="eyebrow">Stato della serie</p><div className="status-options">{(['watching', 'caught-up', 'waiting', 'completed'] as MediaStatus[]).map((status) => <button key={status} className={`${status} ${item.status === status ? 'active' : ''}`} aria-pressed={item.status === status} onClick={() => onStatus(status)}>{STATUS_META[status].short}</button>)}</div></div><div className="season-state-control"><div><p className="eyebrow">Stato di questa stagione</p><strong>Stagione {season}</strong></div><button className={`status-trigger ${seasonStatus}`} onClick={() => setSeasonMenuOpen(true)}>{seasonStatus === 'watchlist' ? <Star /> : <CircleCheck />}{seasonStatus === 'watchlist' ? 'Da vedere' : seasonStatus === 'watching' ? 'In corso' : 'Completata'}<ChevronDown /></button></div>{seasonMenuOpen && <div className="status-sheet-wrap" role="presentation"><button className="status-sheet-backdrop" onClick={() => setSeasonMenuOpen(false)} aria-label="Chiudi selezione stagione" /><section className="status-sheet" aria-label="Scegli stato stagione"><div className="status-sheet-handle" /><p className="eyebrow">{item.title} · Stagione {season}</p><h2>Stato della stagione</h2><div>{(['watchlist', 'watching', 'completed'] as SeasonStatus[]).map((status) => <button key={status} className={`${status} ${seasonStatus === status ? 'active' : ''}`} onClick={() => { onSeasonStatus(season, status, episodes); setSeasonMenuOpen(false) }}>{status === 'watchlist' ? <Star /> : <CircleCheck />}{status === 'watchlist' ? 'Da vedere' : status === 'watching' ? 'In corso' : 'Completata'}{seasonStatus === status && <Check />}</button>)}</div></section></div>}{loading ? <div className="episode-loading"><RefreshCw /> Carico gli episodi...</div> : episodes.length ? <div className="episode-list">{episodes.map((episode, index) => { const watched = isWatched(episode, index); return <article key={episode.id}><button className="episode-main" onClick={() => setSelectedEpisode(episode)}><img src={episode.still} alt="" /><span className="episode-number">{episode.number}</span><div><strong>{episode.title}</strong><small>{episode.runtime} min · {formatDate(episode.airDate)}</small></div><ChevronRight /></button><button className={`episode-check ${watched ? 'watched' : ''}`} onClick={() => onEpisode(episode, !watched, episodes)} aria-label={watched ? `Segna ${episode.title} come non visto` : `Segna ${episode.title} come visto`}>{watched ? <Check /> : <Circle />}</button></article> })}</div> : <EmptyState icon={Tv} text="Gli episodi non sono ancora disponibili per questa stagione." />}<button className="primary-action" onClick={onMark}><CircleCheck /> Segna il prossimo episodio come visto</button></section> : null}
      {similar.length > 0 && <section className="similar-section"><SectionHeader title="Titoli simili" /><div className="poster-rail">{similar.map((entry) => <PosterCard key={entry.id} item={entry} onClick={() => onOpen(entry)} />)}</div></section>}
    </div>
  </div>
}

function EpisodePage({ episode, series, watched, onBack, onToggle, onPrevious, onNext }: { episode: Episode; series: MediaItem; watched: boolean; onBack: () => void; onToggle: () => void; onPrevious?: () => void; onNext?: () => void }) {
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: 'auto' }) }, [episode.id])
  return <div className="episode-page"><section className="episode-hero" style={{ '--episode-still': `url(${episode.still})` } as React.CSSProperties}><button className="episode-back" onClick={onBack}><ChevronLeft /> Tutti gli episodi</button><div><p className="eyebrow">{series.title} · Stagione {episode.season}</p><h1>{episode.number}. {episode.title}</h1></div></section><div className="episode-content"><div className="episode-meta"><span><Clock3 /> {episode.runtime} min</span><span><CalendarDays /> {formatDate(episode.airDate, { day: 'numeric', month: 'long', year: 'numeric' })}</span>{episode.rating > 0 && <span><Star /> {episode.rating}</span>}</div><p>{episode.overview}</p><button className={`primary-action ${watched ? 'is-watched' : ''}`} onClick={onToggle}>{watched ? <Check /> : <CircleCheck />}{watched ? 'Episodio visto' : 'Segna come visto'}</button><nav className="episode-nav" aria-label="Navigazione episodi"><button disabled={!onPrevious} onClick={onPrevious}><ChevronLeft /> Precedente</button><button disabled={!onNext} onClick={onNext}>Successivo <ChevronRight /></button></nav></div></div>
}

export default App
