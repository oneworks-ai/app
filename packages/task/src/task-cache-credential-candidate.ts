interface CredentialCandidatePrefix {
  boundary: 'assignment' | 'query'
  formEncoded: boolean | ((match: RegExpExecArray) => boolean)
  pattern: RegExp
  quoteIndex: number
}

interface CredentialCandidateMatch {
  end: number
  start: number
}

const assignmentBoundaryPattern = /[\s,;|()#{}[\]&"']/u
const queryBoundaryPattern = /[\s&#"']/u

const isUnquotedEqualsAssignment = (match: RegExpExecArray) => match[1] === '=' && (match[2] ?? '') === ''

const credentialCandidatePrefixes: CredentialCandidatePrefix[] = [
  {
    boundary: 'assignment',
    pattern: /\bAuthorization\s*[:=]\s*(?:Bearer\s+)?(["']?)/giu,
    quoteIndex: 1,
    formEncoded: false
  },
  {
    boundary: 'assignment',
    pattern: /\bBearer\s+(["']?)/giu,
    quoteIndex: 1,
    formEncoded: false
  },
  {
    boundary: 'query',
    pattern: /[?&](?:api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password)=\s*(["']?)/giu,
    quoteIndex: 1,
    formEncoded: true
  },
  {
    boundary: 'assignment',
    pattern: /\bFACTORY_(?:API_KEY|TOKEN)\s*([:=])\s*(["']?)/giu,
    quoteIndex: 2,
    formEncoded: isUnquotedEqualsAssignment
  },
  {
    boundary: 'assignment',
    pattern:
      /(?<![\w?&])["']?(?:api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|authorization)["']?\s*([:=])\s*(["']?)/giu,
    quoteIndex: 2,
    formEncoded: isUnquotedEqualsAssignment
  }
]

const findUnescapedClosingQuote = (value: string, start: number, quote: string) => {
  for (let index = start; index < value.length; index += 1) {
    if (value[index] !== quote) continue
    let backslashes = 0
    for (let cursor = index - 1; cursor >= start && value[cursor] === '\\'; cursor -= 1) {
      backslashes += 1
    }
    if (backslashes % 2 === 0) return index
  }
  return undefined
}

const readCredentialCandidateEnds = (
  value: string,
  start: number,
  quote: string,
  boundary: CredentialCandidatePrefix['boundary']
) => {
  if (quote !== '') {
    const closingQuote = findUnescapedClosingQuote(value, start, quote)
    return closingQuote == null ? [] : [closingQuote]
  }
  const pattern = boundary === 'query' ? queryBoundaryPattern : assignmentBoundaryPattern
  const ends: number[] = []
  for (let end = start; end < value.length; end += 1) {
    if (!pattern.test(value[end])) continue
    ends.push(end)
    if (boundary === 'query') break
  }
  if (ends.at(-1) !== value.length) ends.push(value.length)
  return ends.sort((left, right) => right - left)
}

const decodeQuotedEscapes = (value: string, quote: string) => {
  let decoded = ''
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (character !== '\\') {
      decoded += character
      continue
    }
    const escaped = value[++index]
    if (escaped !== '\\' && escaped !== quote) return undefined
    decoded += escaped
  }
  return decoded
}

const decodeCredentialCandidate = (
  candidate: string,
  formEncoded: boolean,
  quote: string
) => {
  if (!candidate.includes('%') && !(formEncoded && candidate.includes('+'))) return undefined
  try {
    const decoded = decodeURIComponent(formEncoded ? candidate.replaceAll('+', ' ') : candidate)
    if (quote === '') return [decoded]
    const unescaped = decodeQuotedEscapes(decoded, quote)
    return candidate.includes('\\') ? [unescaped] : [decoded, unescaped]
  } catch {
    return undefined
  }
}

const collectMatches = (value: string, rawSecrets: ReadonlySet<string>) => {
  const matches: CredentialCandidateMatch[] = []
  for (const prefix of credentialCandidatePrefixes) {
    prefix.pattern.lastIndex = 0
    let match = prefix.pattern.exec(value)
    while (match != null) {
      const start = match.index + match[0].length
      const quote = match[prefix.quoteIndex] ?? ''
      const formEncoded = typeof prefix.formEncoded === 'function'
        ? prefix.formEncoded(match)
        : prefix.formEncoded
      for (const end of readCredentialCandidateEnds(value, start, quote, prefix.boundary)) {
        const decoded = decodeCredentialCandidate(value.slice(start, end), formEncoded, quote)
        if (decoded == null || !decoded.some(candidate => candidate != null && rawSecrets.has(candidate))) continue
        matches.push({ end, start })
        break
      }
      match = prefix.pattern.exec(value)
    }
  }
  return matches
}

export const redactEncodedCredentialCandidates = (
  value: string,
  rawSecrets: ReadonlySet<string>,
  replacement: string
) => {
  const matches = collectMatches(value, rawSecrets)
  if (matches.length === 0) return value
  matches.sort((left, right) => left.start - right.start || right.end - left.end)
  let cursor = 0
  let sanitized = ''
  for (const match of matches) {
    if (match.start < cursor) continue
    sanitized += value.slice(cursor, match.start) + replacement
    cursor = match.end
  }
  return sanitized + value.slice(cursor)
}
