import { getApp, getApps, initializeApp } from 'firebase/app'
import { browserLocalPersistence, getAuth, onAuthStateChanged, setPersistence, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth'
import { doc, getDoc, getFirestore, serverTimestamp, setDoc } from 'firebase/firestore/lite'
import type { MediaItem } from './types'

export type CloudProfile = { favoriteGenres: string[] }
export type CloudSnapshot = { library: MediaItem[]; profile: CloudProfile }
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
  const data = snapshot.data() as { library?: unknown; favoriteGenres?: unknown }
  return {
    library: Array.isArray(data.library) ? data.library as MediaItem[] : [],
    profile: { favoriteGenres: Array.isArray(data.favoriteGenres) ? data.favoriteGenres.filter((value): value is string => typeof value === 'string') : [] },
  }
}

export async function saveCloudSnapshot(userId: string, snapshot: CloudSnapshot) {
  await setDoc(stateRef(userId), {
    library: snapshot.library,
    favoriteGenres: snapshot.profile.favoriteGenres,
    updatedAt: serverTimestamp(),
  }, { merge: true })
}
