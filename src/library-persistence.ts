import { sameContent, type LibraryDraft, type LibrarySnapshot } from './cloud-sync.js'

export type StorageAdapter = Pick<Storage, 'getItem' | 'setItem'>
export type LocalBackup = { id: string; savedAt: number; snapshot: LibrarySnapshot }
const prefix = 'watchline-durable-v2:'
const empty = (): LibrarySnapshot => ({ library: [], profile: { favoriteGenres: [] }, updatedAt: 0 })

export function validateSnapshot(value: unknown): asserts value is LibrarySnapshot {
  const snapshot = value as LibrarySnapshot | null
  if (!snapshot || !Array.isArray(snapshot.library) || !snapshot.profile || !Array.isArray(snapshot.profile.favoriteGenres) || !snapshot.profile.favoriteGenres.every((genre) => typeof genre === 'string') || typeof snapshot.updatedAt !== 'number' || !Number.isFinite(snapshot.updatedAt)) throw new Error('Copia della libreria non valida')
  const ids = new Set<string>()
  for (const item of snapshot.library) {
    if (!item || typeof item.id !== 'string' || ids.has(item.id) || typeof item.title !== 'string' || typeof item.backdrop !== 'string' || !Array.isArray(item.genres) || !['tv', 'movie'].includes(item.type) || !['watchlist', 'watching', 'caught-up', 'waiting', 'completed'].includes(item.status) || !Number.isFinite(item.watchedEpisodes) || !Number.isFinite(item.totalEpisodes)) throw new Error('Titolo della libreria non valido')
    ids.add(item.id)
  }
}

export class LibraryPersistence {
  readonly key: string
  constructor(readonly storage: StorageAdapter, readonly userId: string) { this.key = `${prefix}${userId}` }

  load(): LibraryDraft {
    const stored = this.storage.getItem(this.key)
    if (stored) {
      const draft = JSON.parse(stored) as LibraryDraft
      validateSnapshot(draft.snapshot)
      if (draft.base !== null) validateSnapshot(draft.base)
      return draft
    }
    // Claim the legacy cache once. A second account never imports the first account's data.
    const owner = this.storage.getItem('watchline-legacy-owner')
    if (owner && owner !== this.userId) return { snapshot: empty(), base: null }
    const legacy = this.storage.getItem('watchline-library-v1')
    const profile = JSON.parse(this.storage.getItem('watchline-profile-v1') || '{"favoriteGenres":[]}')
    const snapshot = { library: legacy ? JSON.parse(legacy).filter((item: { id: string }) => !item.id.startsWith('demo-')) : [], profile, updatedAt: Number(this.storage.getItem('watchline-library-updated-at') || 0) }
    validateSnapshot(snapshot)
    this.storage.setItem('watchline-legacy-owner', this.userId)
    const draft = { snapshot, base: null }
    this.save(draft)
    return draft
  }

  save(draft: LibraryDraft) {
    validateSnapshot(draft.snapshot)
    if (draft.base) validateSnapshot(draft.base)
    const previous = this.storage.getItem(this.key)
    if (previous) {
      const before = JSON.parse(previous) as LibraryDraft
      if (!sameContent(before.snapshot.library, draft.snapshot.library) || !sameContent(before.snapshot.profile, draft.snapshot.profile)) {
        // Backups are bounded; the atomic draft is the required durable write.
        try {
          const backups = this.backups()
          backups.unshift({ id: crypto.randomUUID(), savedAt: Date.now(), snapshot: before.snapshot })
          this.storage.setItem(`${this.key}:backups`, JSON.stringify(backups.slice(0, 5)))
        } catch { /* A full device must still try saving the current draft. */ }
      }
    }
    this.storage.setItem(this.key, JSON.stringify(draft))
  }

  backups(): LocalBackup[] {
    const backups = JSON.parse(this.storage.getItem(`${this.key}:backups`) || '[]') as LocalBackup[]
    if (!Array.isArray(backups)) throw new Error('Backup locali non validi')
    backups.forEach((backup) => validateSnapshot(backup.snapshot))
    return backups
  }
}
