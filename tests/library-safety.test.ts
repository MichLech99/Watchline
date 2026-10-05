import { hasPendingChanges, mergeLibraryChanges, type LibraryDraft, type LibrarySnapshot } from '../src/cloud-sync.js'
import { LibraryPersistence, type StorageAdapter } from '../src/library-persistence.js'
import { LibraryController } from '../src/library-controller.js'
import type { MediaItem } from '../src/types.js'

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }
const item = (id: string): MediaItem => ({ id, type: 'tv', title: id, poster: '', backdrop: '', overview: '', year: '', genres: [], rating: 0, status: 'completed', watchedEpisodes: 10, totalEpisodes: 10, runtime: 30 })
const snapshot = (ids: string[]): LibrarySnapshot => ({ library: ids.map(item), profile: { favoriteGenres: [] }, updatedAt: 0 })
class MemoryStorage implements StorageAdapter {
  values = new Map<string, string>()
  fail = false
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { if (this.fail) throw new Error('Quota exceeded'); this.values.set(key, value) }
}

const seventy = snapshot(Array.from({ length: 70 }, (_, i) => `tv-${i}`))
assert(mergeLibraryChanges(null, seventy, snapshot(['tv-0'])).library.length === 70, 'Migration must keep legacy titles, regardless of clocks')
const base = snapshot(['a', 'b'])
const local = snapshot(['a', 'b', 'phone'])
const remote = snapshot(['a', 'b', 'desktop'])
assert(mergeLibraryChanges(base, local, remote).library.length === 4, 'Two devices adding different titles must keep both additions')
assert(mergeLibraryChanges(base, snapshot(['b']), remote).library.map(i => i.id).join(',') === 'b,desktop', 'Explicit removal deletes only its title')
assert(mergeLibraryChanges(base, base, snapshot(['b'])).library.length === 1, 'A clean stale device must not resurrect a remotely removed title')
const rated = { ...base, library: base.library.map(i => ({ ...i, personalRating: 5 })) }
const progressed = { ...base, library: base.library.map(i => ({ ...i, watchedEpisodes: 12 })) }
const merged = mergeLibraryChanges(base, rated, progressed)
assert(merged.library[0].personalRating === 5 && merged.library[0].watchedEpisodes === 12, 'Editing a rating must preserve another device\'s progress')
const episodeBase = { ...snapshot(['a']), library: [{ ...item('a'), watchedEpisodeIds: ['1'] }] }
const phoneEpisodes = { ...episodeBase, library: [{ ...episodeBase.library[0], watchedEpisodeIds: ['1', '2'] }] }
const desktopEpisodes = { ...episodeBase, library: [{ ...episodeBase.library[0], watchedEpisodeIds: ['1', '3'] }] }
assert(mergeLibraryChanges(episodeBase, phoneEpisodes, desktopEpisodes).library[0].watchedEpisodeIds?.length === 3, 'Concurrent episode additions must survive')

const disk = new MemoryStorage()
disk.setItem('watchline-library-v1', JSON.stringify(seventy.library))
disk.setItem('watchline-library-updated-at', '0')
const persistence = new LibraryPersistence(disk, 'valentina')
let server = snapshot(['tv-0'])
let offline = true
let requests = 0
const transport = async (draft: LibraryDraft) => {
  requests++
  if (offline) throw new Error('Offline')
  server = mergeLibraryChanges(draft.base, draft.snapshot, server)
  return structuredClone(server)
}
const controller = new LibraryController(persistence, transport, () => {})
await controller.sync()
assert(controller.status === 'error' && persistence.load().snapshot.library.length === 70, 'Failed cloud load must not discard the legacy cache')
assert(controller.update(s => ({ ...s, library: [...s.library, item('offline-addition')] })), 'Local offline edits must be durable')
await controller.sync()
controller.stop()
const reopened = new LibraryController(persistence, transport, () => {})
assert(reopened.draft.snapshot.library.length === 71 && hasPendingChanges(reopened.draft), 'Reload offline must retain unacknowledged changes')
offline = false
await reopened.sync()
assert(server.library.length === 71 && !hasPendingChanges(reopened.draft), 'Reconnect must acknowledge only committed changes')
assert(new LibraryPersistence(disk, 'other-user').load().snapshot.library.length === 0, 'Legacy and scoped data must not leak into a second account')

let release: (() => void) | undefined
let calls = 0
let activeWrites = 0
let maxWrites = 0
const concurrent = new LibraryController(persistence, async draft => {
  activeWrites++; maxWrites = Math.max(maxWrites, activeWrites); calls++
  if (calls === 1) await new Promise<void>(resolve => { release = resolve })
  server = mergeLibraryChanges(draft.base, draft.snapshot, server)
  activeWrites--
  return structuredClone(server)
}, () => {})
concurrent.update(s => ({ ...s, library: [...s.library, item('first')] }))
concurrent.update(s => ({ ...s, library: [...s.library, item('second')] }))
release?.()
await concurrent.sync()
assert(maxWrites === 1 && server.library.some(i => i.id === 'second'), 'Rapid edits must serialize writes and preserve in-flight additions')
assert(!hasPendingChanges(concurrent.draft), 'Latest edit must receive its own cloud acknowledgement')
assert(persistence.backups().length > 0 && persistence.backups().length <= 5, 'Local snapshots must be recoverable and bounded')

const count = concurrent.draft.snapshot.library.length
disk.fail = true
assert(!concurrent.update(s => ({ ...s, library: [...s.library, item('quota-failure')] })), 'Storage failures must reject the edit')
assert(concurrent.status === 'storage-error' && concurrent.draft.snapshot.library.length === count, 'Failed local save must not show a successful edit')
disk.fail = false
disk.setItem(persistence.key, '{broken json')
let rejected = false
try { persistence.load() } catch { rejected = true }
assert(rejected && disk.getItem(persistence.key) === '{broken json', 'Corrupt local data must be preserved, never converted to an empty cloud upload')
assert(requests >= 2, 'Failure and reconnection paths must both run')
console.log('Library safety: migration, offline/reload, concurrency, removals, isolation, backups and storage failures passed.')
