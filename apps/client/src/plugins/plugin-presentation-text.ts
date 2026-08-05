import { decodeSafePluginAssetReference, getPluginAssetQueryFragment } from './plugin-presentation-asset-path'

export const PRIVATE_PLUGIN_PRESENTATION_VALUE = '[private]'

const MAX_STRING_BYTES = 4096
const SAFE_PUBLIC_ROOTS = new Set(['api', 'assets', 'docs', 'help', 'plugins'])

const isWordOrRelativePathCharacter = (value: string) => /[\p{L}\p{N}_./-]/u.test(value)
const isBoundary = (value: string, index: number) => (
  index === 0 || !isWordOrRelativePathCharacter(value[index - 1] ?? '')
)

const decodeForInspection = (value: string) => {
  let decoded = value
  for (let pass = 0; pass < 2; pass += 1) {
    try {
      const next = decodeURIComponent(decoded)
      if (next === decoded) break
      decoded = next
    } catch {
      break
    }
  }
  return decoded
}

const inspectExactUrl = (value: string): 'not-url' | 'safe-asset' | 'safe-text' | 'unsafe' => {
  const schemeRelative = value.startsWith('//')
  if (!schemeRelative && !/^[a-z][a-z0-9+.-]*:\/\//iu.test(value)) return 'not-url'
  try {
    const url = new URL(schemeRelative ? `https:${value}` : value)
    if (url.protocol === 'file:' || url.username !== '' || url.password !== '') return 'unsafe'
    return url.protocol === 'http:' || url.protocol === 'https:' ? 'safe-asset' : 'safe-text'
  } catch {
    return 'unsafe'
  }
}

const hasCredentialUrl = (value: string) => {
  let offset = 0
  while (offset < value.length) {
    const delimiter = value.indexOf('//', offset)
    if (delimiter < 0) return false
    let authorityEnd = delimiter + 2
    while (authorityEnd < value.length && !/[\s/?#]/u.test(value[authorityEnd] ?? '')) authorityEnd += 1
    if (value.slice(delimiter + 2, authorityEnd).includes('@')) return true
    offset = delimiter + 2
  }
  return false
}

const hasLocalPath = (value: string) => {
  const lowerValue = value.toLowerCase()
  for (let index = 0; index < value.length; index += 1) {
    if (lowerValue.startsWith('file:', index) && isBoundary(value, index)) return true
    if (value[index] === '~' && isBoundary(value, index)) {
      const suffix = value.slice(index + 1).split(/\s/u, 1)[0] ?? ''
      if (suffix.includes('/') || suffix.includes('\\')) return true
    }
    if (
      /[a-z]/iu.test(value[index] ?? '') &&
      value[index + 1] === ':' &&
      (value[index + 2] === '/' || value[index + 2] === '\\') &&
      isBoundary(value, index)
    ) return true
    if (value.startsWith('\\\\', index) && isBoundary(value, index)) return true
    if (value[index] !== '/' || !isBoundary(value, index)) continue
    const next = value[index + 1]
    if (next == null || /[\s/*]/u.test(next)) continue
    const token = value.slice(index + 1).split(/[\s)\]}>;,]/u, 1)[0] ?? ''
    const firstSegment = token.split('/', 1)[0]?.toLowerCase() ?? ''
    if (SAFE_PUBLIC_ROOTS.has(firstSegment)) continue
    if (index === 0 || token.includes('/') || /(?:path|root|source)\s*=$/iu.test(value.slice(0, index))) return true
  }
  return false
}

const inspectText = (value: string) => {
  const decoded = decodeForInspection(value)
  const exactUrl = inspectExactUrl(decoded)
  if (exactUrl !== 'not-url') return exactUrl
  return hasCredentialUrl(decoded) || hasLocalPath(decoded) ? 'unsafe' : 'safe-text'
}
const assetSuffixIsUnsafe = (value: string) => hasCredentialUrl(value) || hasLocalPath(value)

const findPathEnd = (value: string, start: number) => {
  let index = start
  while (index < value.length && !/[\s)\]}>;,]/u.test(value[index] ?? '')) index += 1
  return index
}

const findUrlEnd = (value: string, start: number) => {
  let parentheses = 0
  for (let index = start; index < value.length; index += 1) {
    const character = value[index] ?? ''
    if (/\s/u.test(character)) return index
    if (character === '(') parentheses += 1
    if (character === ')') {
      if (parentheses === 0) return index
      parentheses -= 1
    }
    if (parentheses === 0 && /[\]}>]/u.test(character)) return index
  }
  return value.length
}

const findCredentialUrlStart = (value: string, delimiter: number) => {
  if (value[delimiter - 1] !== ':') return delimiter
  let start = delimiter - 1
  while (start > 0 && /[a-z0-9+.-]/iu.test(value[start - 1] ?? '')) start -= 1
  return start
}

const redactUnsafePresentationValue = (value: string) => {
  const spans: Array<readonly [number, number]> = []
  let index = 0
  while (index < value.length) {
    if (value.startsWith('//', index)) {
      const end = findUrlEnd(value, index)
      const authorityEnd = value.slice(index + 2, end).search(/[/?#]/u)
      const authority = value.slice(index + 2, authorityEnd < 0 ? end : index + 2 + authorityEnd)
      if (authority.includes('@')) {
        spans.push([findCredentialUrlStart(value, index), end])
        index = end
        continue
      }
    }
    const lowerValue = value.toLowerCase()
    const isFile = lowerValue.startsWith('file:', index) && isBoundary(value, index)
    const isTilde = value[index] === '~' && isBoundary(value, index) &&
      /[/\\]/u.test(value.slice(index + 1, findPathEnd(value, index)))
    const isDrive = /[a-z]/iu.test(value[index] ?? '') && value[index + 1] === ':' &&
      /[/\\]/u.test(value[index + 2] ?? '') && isBoundary(value, index)
    const isUnc = value.startsWith('\\\\', index) && isBoundary(value, index)
    let isPosix = false
    if (value[index] === '/' && isBoundary(value, index)) {
      const end = findPathEnd(value, index)
      const token = value.slice(index + 1, end)
      const firstSegment = token.split('/', 1)[0]?.toLowerCase() ?? ''
      isPosix = !SAFE_PUBLIC_ROOTS.has(firstSegment) &&
        (index === 0 || token.includes('/') || /(?:path|root|source)\s*=$/iu.test(value.slice(0, index)))
    }
    if (isFile || isTilde || isDrive || isUnc || isPosix) {
      const end = isFile ? findUrlEnd(value, index) : findPathEnd(value, index)
      spans.push([index, end])
      index = end
      continue
    }
    index += 1
  }
  if (spans.length === 0) return undefined
  let output = ''
  let offset = 0
  for (const [start, end] of spans) {
    output += value.slice(offset, start) + PRIVATE_PLUGIN_PRESENTATION_VALUE
    offset = end
  }
  return output + value.slice(offset)
}

export const sanitizePluginPresentationValue = (value: string | undefined) => {
  if (value == null || value.length > MAX_STRING_BYTES) return undefined
  if (value.trim() === '' || value.includes('\0')) return undefined
  if (new TextEncoder().encode(value).byteLength > MAX_STRING_BYTES) return undefined
  return inspectText(value) === 'unsafe' ? undefined : value
}

export const projectPluginPresentationValue = (value: string | undefined) =>
  sanitizePluginPresentationValue(value) ?? (
    value == null
      ? PRIVATE_PLUGIN_PRESENTATION_VALUE
      : redactUnsafePresentationValue(value) ?? PRIVATE_PLUGIN_PRESENTATION_VALUE
  )

export const sanitizePluginAssetReference = (value: string | undefined) => {
  const presentationValue = sanitizePluginPresentationValue(value)
  if (presentationValue == null) return undefined
  const safeText = presentationValue.trim()
  const decodedSafeText = decodeSafePluginAssetReference(safeText)
  if (
    decodedSafeText == null ||
    decodedSafeText.includes(PRIVATE_PLUGIN_PRESENTATION_VALUE) ||
    assetSuffixIsUnsafe(getPluginAssetQueryFragment(decodedSafeText) ?? '')
  ) return undefined
  const inspection = inspectExactUrl(decodedSafeText)
  if (inspection === 'safe-asset') return safeText
  if (inspection !== 'not-url') return undefined
  const absolutePublicPath = decodedSafeText.startsWith('/') && (() => {
    const firstSegment = decodedSafeText.slice(1).split('/', 1)[0]?.toLowerCase() ?? ''
    return SAFE_PUBLIC_ROOTS.has(firstSegment)
  })()
  if (
    (decodedSafeText.startsWith('/') && !absolutePublicPath) ||
    decodedSafeText.startsWith('~') ||
    decodedSafeText.startsWith('\\') ||
    decodedSafeText.includes('\\') ||
    decodedSafeText.includes(':')
  ) return undefined
  return safeText
}
