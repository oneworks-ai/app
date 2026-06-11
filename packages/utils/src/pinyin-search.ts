import { pinyin } from 'pinyin-pro'

type SearchValue = string | null | undefined

const CHINESE_CHARACTER_RE = /[\u3400-\u9FFF\uF900-\uFAFF]/u

export const normalizePinyinSearchQuery = (query: string) => query.trim().toLowerCase()

const toPinyinParts = (value: string, pattern?: 'first') =>
  pinyin(value, {
    pattern,
    toneType: 'none',
    type: 'array'
  })
    .map(part => part.trim().toLowerCase())
    .filter(Boolean)

export const buildPinyinSearchText = (values: SearchValue[]) => {
  const variants = new Set<string>()
  for (const value of values) {
    const normalizedValue = value?.trim().toLowerCase()
    if (normalizedValue == null || normalizedValue === '') continue

    variants.add(normalizedValue)
    if (!CHINESE_CHARACTER_RE.test(normalizedValue)) continue

    const fullPinyinParts = toPinyinParts(normalizedValue)
    const firstLetterParts = toPinyinParts(normalizedValue, 'first')
    if (fullPinyinParts.length > 0) {
      variants.add(fullPinyinParts.join(' '))
      variants.add(fullPinyinParts.join(''))
    }
    if (firstLetterParts.length > 0) {
      variants.add(firstLetterParts.join(' '))
      variants.add(firstLetterParts.join(''))
    }
  }
  return Array.from(variants).join('\n')
}

export const matchesPinyinSearch = (query: string, values: SearchValue[]) => {
  const tokens = normalizePinyinSearchQuery(query).split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return true
  const searchText = buildPinyinSearchText(values)
  return tokens.every(token => searchText.includes(token))
}
