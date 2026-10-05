import { chooseInitialCloudSnapshot } from '../src/cloud-sync.js'

const local = { library: [{ id: 'tmdb-movie-12' }], profile: { favoriteGenres: ['Dramma'] }, updatedAt: 1_000 }
const remote = { library: [], profile: { favoriteGenres: [] }, updatedAt: 2_000 }
const result = chooseInitialCloudSnapshot(local, remote)

if (result.source !== 'local' || result.snapshot !== local) {
  throw new Error('A locally saved library must seed an empty cloud snapshot.')
}

const newerLocal = { library: [{ id: 'tmdb-movie-12' }, { id: 'tmdb-tv-77' }], profile: { favoriteGenres: ['Dramma'] }, updatedAt: 2_000 }
const olderRemote = { library: [{ id: 'tmdb-movie-12' }], profile: { favoriteGenres: ['Dramma'] }, updatedAt: 1_000 }
const newerLocalResult = chooseInitialCloudSnapshot(newerLocal, olderRemote)

if (newerLocalResult.source !== 'local' || newerLocalResult.snapshot !== newerLocal) {
  throw new Error('A newer local save must not be replaced by an older cloud snapshot.')
}

const seventyLocal = { library: Array.from({ length: 70 }, (_, id) => ({ id: `tv-${id}` })), profile: { favoriteGenres: [] }, updatedAt: 0 }
const incompleteCloud = { ...seventyLocal, library: seventyLocal.library.slice(0, 13), updatedAt: 5_000 }
if (chooseInitialCloudSnapshot(seventyLocal, incompleteCloud).snapshot.library.length !== 70) {
  throw new Error('An incomplete cloud snapshot must not discard locally saved titles during migration.')
}
