import { hasPendingChanges, mergeLibraryChanges, type LibraryDraft, type LibrarySnapshot } from './cloud-sync.js'
import { LibraryPersistence } from './library-persistence.js'

export type SaveStatus = 'checking' | 'syncing' | 'synced' | 'error' | 'storage-error'
export class LibraryController {
  draft: LibraryDraft
  status: SaveStatus = 'checking'
  private running: Promise<void> | null = null
  private stopped = false
  constructor(readonly persistence: LibraryPersistence, readonly commit: (draft: LibraryDraft) => Promise<LibrarySnapshot>, readonly changed: (draft: LibraryDraft, status: SaveStatus) => void) { this.draft = persistence.load() }

  private emit() { if (!this.stopped) this.changed(this.draft, this.status) }
  stop() { this.stopped = true }
  update(change: (snapshot: LibrarySnapshot) => LibrarySnapshot): boolean {
    if (this.stopped) return false
    try {
      const latest = this.persistence.load()
      const next = { ...latest, snapshot: { ...change(latest.snapshot), updatedAt: Date.now() } }
      this.persistence.save(next) // Persist before changing the visible UI or contacting Firebase.
      this.draft = next
      this.status = 'syncing'
      this.emit()
      void this.sync()
      return true
    } catch {
      this.status = 'storage-error'
      this.emit()
      return false
    }
  }

  sync(): Promise<void> {
    if (this.stopped) return Promise.resolve()
    if (this.running) return this.running
    this.running = this.drain().finally(() => { this.running = null })
    return this.running
  }

  private async drain() {
    this.status = 'syncing'
    this.emit()
    let failure: SaveStatus = 'error'
    try {
      do {
        failure = 'storage-error'
        const sent = this.persistence.load()
        failure = 'error'
        const remote = await this.commit(sent)
        if (this.stopped) return
        failure = 'storage-error'
        const latest = this.persistence.load()
        // Acknowledge only what was sent. Keep any edits made while the request was in flight.
        const snapshot = mergeLibraryChanges(sent.snapshot, latest.snapshot, remote)
        const next = { snapshot, base: remote }
        this.persistence.save(next)
        this.draft = next
        this.status = hasPendingChanges(next) ? 'syncing' : 'synced'
        this.emit()
      } while (hasPendingChanges(this.draft) && !this.stopped)
    } catch {
      this.status = failure
      this.emit()
    }
  }
}
