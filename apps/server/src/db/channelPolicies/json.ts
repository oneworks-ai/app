export function stringifyJson(value: unknown) {
  if (value == null) return null
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

export function parseJson(value: string | null): unknown {
  if (value == null || value === '') return null
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}
