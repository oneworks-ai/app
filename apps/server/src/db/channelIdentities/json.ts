export type JsonRecord = Record<string, unknown>

export function stringifyJson(value: unknown) {
  return value == null ? null : JSON.stringify(value)
}

export function parseJsonRecord(value: string | null): JsonRecord | null {
  if (value == null || value === '') {
    return null
  }

  try {
    const parsed = JSON.parse(value) as unknown
    return parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as JsonRecord
      : null
  } catch {
    return null
  }
}

export function parseScopes(value: string | null): string[] | null {
  if (value == null || value === '') {
    return null
  }

  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : null
  } catch {
    return null
  }
}
