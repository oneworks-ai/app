const WINDOWS_RESERVED_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9'
])

const toGraphemes = (value: string) => {
  if (typeof Intl.Segmenter === 'function') {
    return {
      exact: true,
      values: Array.from(
        new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(value),
        item => item.segment
      )
    }
  }

  return { exact: false, values: Array.from(value) }
}

const truncateSlug = (value: string, maxGraphemes: number, maxUtf8Bytes = 200) => {
  const graphemes = toGraphemes(value)
  const encodedLength = new TextEncoder().encode(value).byteLength
  if (
    !graphemes.exact &&
    (graphemes.values.length > maxGraphemes || encodedLength > maxUtf8Bytes)
  ) {
    return undefined
  }
  const selected: string[] = []
  let utf8Bytes = 0
  for (const grapheme of graphemes.values.slice(0, maxGraphemes)) {
    const graphemeBytes = new TextEncoder().encode(grapheme).byteLength
    if (utf8Bytes + graphemeBytes > maxUtf8Bytes) break
    selected.push(grapheme)
    utf8Bytes += graphemeBytes
  }
  return selected.join('').replace(/-$/u, '')
}

/** Returns the shared safe filesystem and semantic identifier for a data asset. */
export const toCanonicalAssetSlug = (value: string, maxGraphemes = 80) => {
  if (/[. ]$/u.test(value)) return undefined
  const normalized = value.normalize('NFKC').trim()
  const hasControlCharacter = Array.from(normalized)
    .some(character => (character.codePointAt(0) ?? 0) <= 0x1F)
  if (normalized === '' || hasControlCharacter || /[<>:"/\\|?*]/u.test(normalized)) return undefined
  if (/[. ]$/u.test(normalized)) return undefined

  const stem = normalized.split('.')[0]?.toUpperCase()
  if (stem == null || WINDOWS_RESERVED_NAMES.has(stem)) return undefined

  const slug = toGraphemes(normalized.toLocaleLowerCase('und')).values
    .map(grapheme => (/^[\p{L}\p{N}\p{M}_-]+$/u.test(grapheme) ? grapheme : '-'))
    .join('')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '')

  if (slug === '' || /^[. ]|[. ]$/u.test(slug)) return undefined
  const canonical = truncateSlug(slug, maxGraphemes)
  return canonical === '' ? undefined : canonical
}
