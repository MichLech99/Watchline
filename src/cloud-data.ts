export function removeUndefinedValues<T>(value: T): T {
  if (Array.isArray(value)) return value.map(removeUndefinedValues) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, removeUndefinedValues(entry)]),
    ) as T
  }
  return value
}
