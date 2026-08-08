export function stringifyJson(value: unknown) {
  if (value == null) return null
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

export function parseStringArray(value: string | null): string[] {
  if (value == null || value === '') return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
      : []
  } catch {
    return []
  }
}

export function parseJsonRecord(value: string | null): Record<string, unknown> | null {
  if (value == null || value === '') return null
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

export function uniqueStrings(values: readonly (string | null | undefined)[]) {
  const seen = new Set<string>()
  for (const value of values) {
    const normalized = value?.trim()
    if (normalized) seen.add(normalized)
  }
  return [...seen]
}
