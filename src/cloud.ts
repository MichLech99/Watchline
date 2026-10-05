import { getApp, getApps, initializeApp } from 'firebase/app'
import { browserLocalPersistence, getAuth, onAuthStateChanged, setPersistence, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth'
import { collection, doc, getDoc, getDocs, getFirestore, limit, orderBy, query, runTransaction, serverTimestamp } from 'firebase/firestore/lite'
import { removeUndefinedValues } from './cloud-data'
import { mergeLibraryChanges, sameContent, type LibraryDraft } from './cloud-sync'
import { validateSnapshot } from './library-persistence'
import type { MediaItem } from './types'

export type CloudProfile = { favoriteGenres: string[] }
export type CloudSnapshot = { library: MediaItem[]; profile: CloudProfile; updatedAt: number }
export type CloudSession = { userId: string; username: string }

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const requiredConfig = Object.values(firebaseConfig)
export const isCloudConfigured = requiredConfig.every(Boolean)

const firebaseApp = isCloudConfigured
  ? (getApps().length ? getApp() : initializeApp(firebaseConfig))
  : null
const auth = firebaseApp ? getAuth(firebaseApp) : null
const db = firebaseApp ? getFirestore(firebaseApp) : null
const persistenceReady = auth ? setPersistence(auth, browserLocalPersistence) : Promise.resolve()

const AUTH_ALIAS_DOMAIN = 'watchline.com'

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase()
}

export function isValidUsername(value: string) {
  return /^[a-z0-9_]{3,32}$/.test(normalizeUsername(value))
}

const usernameFromUser = (email: string | null | undefined) => {
  const username = email?.split('@')[0] || ''
  return isValidUsername(username) ? username : 'utente'
}

const toSession = (user: User | null): CloudSession | null => user ? { userId: user.uid, username: usernameFromUser(user.email) } : null

export async function getCloudSession(): Promise<CloudSession | null> {
  if (!auth) return null
  await persistenceReady
  return toSession(auth.currentUser)
}

export function onCloudAuthChange(callback: (session: CloudSession | null) => void) {
  if (!auth) return () => undefined
  return onAuthStateChanged(auth, (user) => callback(toSession(user)))
}

export async function signInWithUsername(username: string, password: string) {
  if (!auth) throw new Error('Cloud non configurato')
  const normalizedUsername = normalizeUsername(username)
  if (!isValidUsername(normalizedUsername)) throw new Error('Nome utente non valido')
  if (!password) throw new Error('Password mancante')
  await persistenceReady
  const { user } = await signInWithEmailAndPassword(auth, `${normalizedUsername}@${AUTH_ALIAS_DOMAIN}`, password)
  return toSession(user)
}

export async function signOutCloud() {
  if (!auth) return
  await signOut(auth)
}

const stateRef = (userId: string) => {
  if (!db) throw new Error('Cloud non configurato')
  return doc(db, 'watchline_users', userId)
}

export async function loadCloudSnapshot(userId: string): Promise<CloudSnapshot | null> {
  const snapshot = await getDoc(stateRef(userId))
  if (!snapshot.exists()) return null
  return decodeSnapshot(snapshot.data())
}

function decodeSnapshot(data: Record<string, unknown>): CloudSnapshot {
  const timestamp = data.updatedAt as { toMillis?: () => number } | undefined
  const snapshot = { library: data.library as MediaItem[], profile: { favoriteGenres: data.favoriteGenres as string[] }, updatedAt: typeof timestamp?.toMillis === 'function' ? timestamp.toMillis() : typeof data.updatedAt === 'number' ? data.updatedAt : 0 }
  validateSnapshot(snapshot) // Never turn malformed cloud data into an empty library.
  return snapshot
}

export async function commitCloudChanges(userId: string, draft: LibraryDraft): Promise<CloudSnapshot> {
  if (!db) throw new Error('Cloud non configurato')
  const ref = stateRef(userId)
  const day = new Date().toISOString().slice(0, 10)
  return runTransaction(db, async (transaction) => {
    const current = await transaction.get(ref)
    const data = current.exists() ? current.data() : null
    const remote = data ? decodeSnapshot(data) : { library: [], profile: { favoriteGenres: [] }, updatedAt: 0 }
    const next = mergeLibraryChanges(draft.base, draft.snapshot, remote)
    if (data && typeof data.revision === 'number' && sameContent(next.library, remote.library) && sameContent(next.profile, remote.profile)) return remote
    const dailyRef = doc(ref, 'backups', `day-${day}`)
    const daily = await transaction.get(dailyRef)
    const revision = data && typeof data.revision === 'number' ? data.revision : 0
    if (data) {
      const backup = { library: data.library, favoriteGenres: data.favoriteGenres, updatedAt: data.updatedAt }
      // Commit the previous version and its replacement atomically. If backup fails, nothing is overwritten.
      transaction.set(doc(ref, 'backups', `recent-${revision % 20}`), backup)
      if (!daily.exists()) transaction.set(dailyRef, backup)
    }
    transaction.set(ref, { library: removeUndefinedValues(next.library), favoriteGenres: next.profile.favoriteGenres, updatedAt: serverTimestamp(), revision: revision + 1 })
    return next
  })
}

export type CloudBackup = { id: string; savedAt: number; snapshot: CloudSnapshot }
export async function listCloudBackups(userId: string): Promise<CloudBackup[]> {
  const backups = await getDocs(query(collection(stateRef(userId), 'backups'), orderBy('updatedAt', 'desc'), limit(30)))
  return backups.docs.map((entry) => {
    const snapshot = decodeSnapshot(entry.data())
    return { id: entry.id, savedAt: snapshot.updatedAt, snapshot }
  }).sort((a, b) => b.savedAt - a.savedAt)
}
