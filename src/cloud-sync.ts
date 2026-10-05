export type CloudSnapshot<TLibrary, TProfile> = {
  library: TLibrary[]
  profile: TProfile
  updatedAt: number
}

export function chooseInitialCloudSnapshot<TLibrary extends { id: string }, TProfile>(
  local: CloudSnapshot<TLibrary, TProfile>,
  remote: CloudSnapshot<TLibrary, TProfile>,
) {
  if (remote.library.length === 0 || local.updatedAt > remote.updatedAt) {
    const missing = remote.library.filter((item) => !local.library.some((entry) => entry.id === item.id))
    return { snapshot: missing.length ? { ...local, library: [...local.library, ...missing] } : local, source: 'local' as const }
  }
  const missing = local.library.filter((item) => !remote.library.some((entry) => entry.id === item.id))
  return missing.length
    ? { snapshot: { ...remote, library: [...remote.library, ...missing] }, source: 'local' as const }
    : { snapshot: remote, source: 'remote' as const }
}

export type LibrarySnapshot = { library: import('./types').MediaItem[]; profile: { favoriteGenres: string[] }; updatedAt: number }
export type LibraryDraft = { snapshot: LibrarySnapshot; base: LibrarySnapshot | null }

export const sameContent = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => sameContent(value, b[i]))
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])]
  return keys.every((key) => sameContent(left[key], right[key]))
}

export const hasPendingChanges = (draft: LibraryDraft) => !draft.base || !sameContent(draft.snapshot.library, draft.base.library) || !sameContent(draft.snapshot.profile, draft.base.profile)

// Apply only changes made relative to the last acknowledged cloud copy.
// A title missing from a stale device is never treated as a deletion.
export function mergeLibraryChanges(base: LibrarySnapshot | null, local: LibrarySnapshot, remote: LibrarySnapshot): LibrarySnapshot {
  if (!base) return chooseInitialCloudSnapshot(local, remote).snapshot
  const result = new Map(remote.library.map((item) => [item.id, item]))
  const localItems = new Map(local.library.map((item) => [item.id, item]))
  const baseItems = new Map(base.library.map((item) => [item.id, item]))
  for (const item of base.library) if (!localItems.has(item.id)) result.delete(item.id)
  for (const item of local.library) {
    const previous = baseItems.get(item.id)
    if (sameContent(previous, item)) continue
    if (!previous || !result.has(item.id)) { result.set(item.id, item); continue }
    const merged = { ...result.get(item.id) } as Record<string, unknown>
    for (const key of new Set([...Object.keys(previous), ...Object.keys(item)])) {
      const before = (previous as unknown as Record<string, unknown>)[key]
      const after = (item as unknown as Record<string, unknown>)[key]
      if (sameContent(before, after)) continue
      if (key === 'watchedEpisodeIds' && Array.isArray(after)) {
        const oldIds = Array.isArray(before) ? before : []
        const remoteIds = Array.isArray(merged[key]) ? merged[key] as string[] : []
        merged[key] = [...new Set([...remoteIds.filter((id) => !oldIds.includes(id) || after.includes(id)), ...after.filter((id) => !oldIds.includes(id))])]
      } else if (key === 'seasonProgress' && after && typeof after === 'object') {
        const oldSeasons = (before || {}) as Record<string, unknown>
        const seasons = { ...(merged[key] || {}) as Record<string, unknown> }
        for (const season of new Set([...Object.keys(oldSeasons), ...Object.keys(after)])) {
          const value = (after as Record<string, unknown>)[season]
          if (!sameContent(oldSeasons[season], value)) {
            if (value === undefined) delete seasons[season]
            else seasons[season] = value
          }
        }
        merged[key] = seasons
      } else if (after === undefined) delete merged[key]
      else merged[key] = after
    }
    result.set(item.id, merged as unknown as import('./types').MediaItem)
  }
  return { library: [...result.values()], profile: sameContent(base.profile, local.profile) ? remote.profile : local.profile, updatedAt: Math.max(local.updatedAt, remote.updatedAt) }
}
