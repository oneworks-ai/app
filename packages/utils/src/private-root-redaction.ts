import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { hasLiteralRootBoundary, redactLiteralPrivateRoots } from './private-root-literal-redaction'

const MAX_DECODE_DEPTH = 4
const TOKEN_PATTERN = /[^\s:"'`<>()[\]{},;=]+/gu
const FILE_URL_PATTERN = /file:\/\/\/[^\s:"'`<>()[\]{},;=]+/giu
const HTTP_URL_START_PATTERN = /https?:\/\//giu
const HTTP_URL_END_PATTERN = /[\s"'`<>{}()]/u

export type PrivateRootRedactionField = 'route' | 'text' | 'url'

export interface PrivateRootRedactionOptions {
  field?: PrivateRootRedactionField
}

const isAbsolutePrivateRoot = (value: string) => (
  path.isAbsolute(value) || /^(?:file:\/\/\/|[a-z]:[\\/]|\\\\)/iu.test(value)
)

const trimTrailingSeparators = (value: string) => (
  value.length <= 1 ? value : value.replace(/[\\/]+$/gu, '')
)

const toFilesystemPath = (value: string) => {
  if (!/^file:/iu.test(value)) return value
  try {
    return fileURLToPath(value)
  } catch {
    return value
  }
}

const normalizeComparablePath = (value: string) =>
  trimTrailingSeparators(
    toFilesystemPath(value).replaceAll('\\', '/')
  )

const getPrivateRoots = (roots: Array<string | null | undefined>) => [
  ...new Set(roots.flatMap((candidate) => {
    const root = candidate?.trim()
    if (root == null || root === '' || !isAbsolutePrivateRoot(root)) return []
    const normalized = normalizeComparablePath(root)
    return normalized === '/' ? [] : [normalized]
  }))
]

const decodeCandidates = (value: string) => {
  const candidates = [value]
  let current = value
  for (let depth = 0; depth < MAX_DECODE_DEPTH; depth += 1) {
    try {
      const decoded = decodeURIComponent(current)
      if (decoded === current) break
      candidates.push(decoded)
      current = decoded
    } catch {
      break
    }
  }
  return candidates
}

const getRecoveryCandidates = (value: string) => {
  const starts = new Set<number>()
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '/') starts.add(index)
  }
  for (const match of value.matchAll(/%(?:25){0,4}2f/giu)) {
    if (match.index != null) starts.add(match.index)
  }
  return [...starts].flatMap(index => decodeCandidates(value.slice(index)))
}

const isPrivatePath = (value: string, roots: string[]) => {
  for (const candidate of [...decodeCandidates(value), ...getRecoveryCandidates(value)]) {
    const normalized = normalizeComparablePath(candidate)
    for (const root of roots) {
      if (
        normalized === root ||
        (normalized.startsWith(root) && normalized[root.length] === '/')
      ) return true
    }
  }
  return false
}

const isHttpUrl = (value: string) => /^https?:\/\//iu.test(value)

const isValidHttpUrl = (value: string) => {
  try {
    const url = new URL(value)
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.hostname !== ''
    )
  } catch {
    return false
  }
}

const redactToken = (value: string, roots: string[], replacement: string) => {
  if (isHttpUrl(value) || !isPrivatePath(value, roots)) return value
  return replacement
}

const findProtectedHttpUrlEnd = (
  value: string,
  start: number,
  roots: string[]
) => {
  let tokenEnd = start
  while (tokenEnd < value.length && !HTTP_URL_END_PATTERN.test(value[tokenEnd] ?? '')) {
    tokenEnd += 1
  }
  const token = value.slice(start, tokenEnd)
  for (let index = 0; index < token.length; index += 1) {
    if (token[index] !== ',' && token[index] !== ';') continue
    const suffix = token.slice(index + 1)
    const suffixStart = start + index + 1
    const literalPrivateRoot = roots.some(root =>
      value.startsWith(root, suffixStart) &&
      hasLiteralRootBoundary(value, suffixStart, suffixStart + root.length)
    )
    if (
      /^https?:\/\//iu.test(suffix) ||
      isPrivatePath(suffix, roots) ||
      literalPrivateRoot
    ) {
      const prefix = token.slice(0, index)
      return isValidHttpUrl(prefix) ? start + index : undefined
    }
  }
  return isValidHttpUrl(token) ? tokenEnd : undefined
}

const redactUnprotectedText = (
  value: string,
  roots: string[],
  replacement: string
) => {
  const literalRedacted = redactLiteralPrivateRoots(value, roots, replacement)
  return literalRedacted
    .replace(FILE_URL_PATTERN, token => redactToken(token, roots, replacement))
    .replace(TOKEN_PATTERN, token => redactToken(token, roots, replacement))
}

const redactTextAroundHttpUrls = (
  value: string,
  roots: string[],
  replacement: string
) => {
  const output: string[] = []
  let cursor = 0
  HTTP_URL_START_PATTERN.lastIndex = 0
  for (const match of value.matchAll(HTTP_URL_START_PATTERN)) {
    const start = match.index
    if (start < cursor) continue
    const end = findProtectedHttpUrlEnd(value, start, roots)
    if (end == null) continue
    output.push(redactUnprotectedText(value.slice(cursor, start), roots, replacement))
    output.push(value.slice(start, end))
    cursor = end
  }
  output.push(redactUnprotectedText(value.slice(cursor), roots, replacement))
  return output.join('')
}

/**
 * Redacts only verified filesystem roots. Route and HTTP URL fields must opt
 * into their field semantics so `/oauth/callback` remains a route even if an
 * unrelated private root happens to share its prefix.
 */
export const redactPrivateRoots = (
  value: string,
  roots: Array<string | null | undefined>,
  replacement = '[local path]',
  options: PrivateRootRedactionOptions = {}
) => {
  const field = options.field ?? 'text'
  if (field === 'route' || field === 'url') return value
  const privateRoots = getPrivateRoots(roots)
  if (privateRoots.length === 0) return value
  return redactTextAroundHttpUrls(value, privateRoots, replacement)
}

export const containsPrivateRoot = (
  value: string,
  roots: Array<string | null | undefined>,
  options?: PrivateRootRedactionOptions
) => redactPrivateRoots(value, roots, '[local path]', options) !== value
