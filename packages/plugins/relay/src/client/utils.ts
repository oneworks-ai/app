export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value)

export const cleanText = (value: unknown) => {
  const text = typeof value === 'string' ? value.trim() : ''
  return text === '' ? undefined : text
}

export const valueOrDash = (value: unknown) => cleanText(value) ?? '-'

export const cleanTextList = (values: unknown[]) =>
  values.map(cleanText).filter((value): value is string => value != null)

export const getAvatarInitials = (value: unknown) => {
  const text = cleanText(value) ?? 'AC'
  const parts = text.split(/\s+/u).filter(Boolean)
  if (parts.length >= 2) return `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase()
  return text.slice(0, 2).toUpperCase()
}

export const formatDateTime = (value?: string | null) => {
  const text = cleanText(value)
  if (text == null) return '-'
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) return text
  return date.toLocaleString()
}

export const toErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

export const normalizeComparableUrl = (value?: string) => {
  const text = cleanText(value)
  if (text == null) return undefined
  try {
    const url = new URL(text)
    url.hash = ''
    url.search = ''
    return url.toString().replace(/\/$/u, '')
  } catch {
    return text.replace(/\/$/u, '')
  }
}
