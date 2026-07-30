import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { parse } from 'smol-toml'

import {
  CODEX_PROJECT_CONFIG_INVALID_ERROR_CODE,
  CODEX_PROJECT_CONFIG_RELATIVE_PATH
} from '@oneworks/runtime-protocol'
import { AdapterStartupError } from '@oneworks/types'
import type { ProjectConfigPolicy } from '@oneworks/types'

export const CODEX_PROJECT_CONFIG_ERROR_CODE = CODEX_PROJECT_CONFIG_INVALID_ERROR_CODE
export const CODEX_PROJECT_CONFIG_PATH = CODEX_PROJECT_CONFIG_RELATIVE_PATH

const SUPPORTED_CODEX_WIRE_APIS = new Set(['chat', 'responses'])

interface TomlKeyToken {
  column: number
  line: number
  type: 'bare' | 'comma' | 'dot' | 'equals' | 'lbrace' | 'lbracket' | 'newline' | 'rbrace' | 'rbracket' | 'string'
  value?: string
}

interface TomlKeyLocation {
  column: number
  line: number
  path: string[]
}

const isWhitespace = (value: string) => value === ' ' || value === '\t' || value === '\r'
const isBareKeyCharacter = (value: string) => /[A-Za-z0-9_-]/u.test(value)

const tokenizeTomlKeys = (content: string): TomlKeyToken[] => {
  const tokens: TomlKeyToken[] = []
  let index = 0
  let line = 1
  let column = 1

  const advance = () => {
    const value = content[index++]
    if (value === '\n') {
      line += 1
      column = 1
    } else {
      column += 1
    }
    return value
  }

  const push = (type: TomlKeyToken['type'], tokenLine = line, tokenColumn = column, value?: string) => {
    tokens.push({
      type,
      line: tokenLine,
      column: tokenColumn,
      ...(value == null ? {} : { value })
    })
  }

  while (index < content.length) {
    const value = content[index]
    if (isWhitespace(value)) {
      advance()
      continue
    }
    if (value === '\n') {
      push('newline')
      advance()
      continue
    }
    if (value === '#') {
      while (index < content.length && content[index] !== '\n') advance()
      continue
    }

    const punctuation = {
      ',': 'comma',
      '.': 'dot',
      '=': 'equals',
      '{': 'lbrace',
      '[': 'lbracket',
      '}': 'rbrace',
      ']': 'rbracket'
    } as const
    const punctuationType = punctuation[value as keyof typeof punctuation]
    if (punctuationType != null) {
      push(punctuationType)
      advance()
      continue
    }

    if (value === '"' || value === '\'') {
      const tokenLine = line
      const tokenColumn = column
      const quote = value
      const multiline = content.slice(index, index + 3) === quote.repeat(3)
      const quoteLength = multiline ? 3 : 1
      for (let count = 0; count < quoteLength; count += 1) advance()
      let decoded = ''
      while (index < content.length) {
        if (content.slice(index, index + quoteLength) === quote.repeat(quoteLength)) {
          for (let count = 0; count < quoteLength; count += 1) advance()
          break
        }
        const next = advance()
        if (quote === '"' && next === '\\' && index < content.length) {
          const escaped = advance()
          decoded += escaped === 'n' ? '\n' : escaped === 't' ? '\t' : escaped
        } else {
          decoded += next
        }
      }
      push('string', tokenLine, tokenColumn, decoded)
      continue
    }

    if (isBareKeyCharacter(value)) {
      const tokenLine = line
      const tokenColumn = column
      let bare = ''
      while (index < content.length && isBareKeyCharacter(content[index])) bare += advance()
      push('bare', tokenLine, tokenColumn, bare)
      continue
    }

    advance()
  }

  return tokens
}

const readDottedKey = (tokens: TomlKeyToken[], startIndex: number) => {
  const segments: string[] = []
  let index = startIndex
  let lastToken: TomlKeyToken | undefined
  while (index < tokens.length) {
    const token = tokens[index]
    if (token.type !== 'bare' && token.type !== 'string') break
    lastToken = token
    segments.push(token.value ?? '')
    index += 1
    if (tokens[index]?.type !== 'dot') break
    index += 1
  }
  return { lastToken, index, segments }
}

const collectTomlKeyLocations = (content: string): TomlKeyLocation[] => {
  const tokens = tokenizeTomlKeys(content)
  const locations: TomlKeyLocation[] = []
  let tablePath: string[] = []

  const parseEntries = (
    startIndex: number,
    basePath: string[],
    terminator: 'newline' | 'rbrace'
  ): number => {
    let index = startIndex
    while (index < tokens.length) {
      const token = tokens[index]
      if (token.type === terminator) return index + 1
      if (token.type === 'newline' || token.type === 'comma') {
        index += 1
        continue
      }

      const key = readDottedKey(tokens, index)
      if (key.segments.length === 0 || tokens[key.index]?.type !== 'equals') {
        index += 1
        continue
      }
      const path = [...basePath, ...key.segments]
      if (key.lastToken != null) {
        locations.push({
          path,
          line: key.lastToken.line,
          column: key.lastToken.column
        })
      }
      index = key.index + 1
      if (tokens[index]?.type === 'lbrace') {
        index = parseEntries(index + 1, path, 'rbrace')
        continue
      }

      let arrayDepth = 0
      while (index < tokens.length) {
        const valueToken = tokens[index]
        if (valueToken.type === 'lbracket') arrayDepth += 1
        if (valueToken.type === 'rbracket' && arrayDepth > 0) arrayDepth -= 1
        if (arrayDepth === 0 && (
          valueToken.type === terminator ||
          valueToken.type === 'newline' ||
          valueToken.type === 'comma'
        )) break
        index += 1
      }
    }
    return index
  }

  let index = 0
  while (index < tokens.length) {
    const token = tokens[index]
    if (token.type === 'lbracket') {
      const header = readDottedKey(tokens, index + 1)
      if (header.segments.length > 0 && tokens[header.index]?.type === 'rbracket') {
        tablePath = header.segments
        index = header.index + 1
        continue
      }
    }
    const nextIndex = parseEntries(index, tablePath, 'newline')
    index = nextIndex > index ? nextIndex : index + 1
  }
  return locations
}

const findTomlKeyLocation = (content: string, path: string[]) => {
  const matches = collectTomlKeyLocations(content)
    .filter(location => location.path.length === path.length && location.path.every((part, index) => part === path[index]))
  return matches.length === 1
    ? { line: matches[0].line, column: matches[0].column }
    : undefined
}

const sanitizeDiagnosticReason = (value: string) => {
  const sanitized = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, ' ')
    .trim()
    .slice(0, 2000)
  return sanitized === '' ? 'Invalid TOML configuration.' : sanitized
}

const createProjectConfigError = (params: {
  adapter: string
  message: string
  location?: { line: number; column?: number }
  reason: string
  sessionId: string
  workspaceFolder: string
}) => new AdapterStartupError(
  params.message,
  CODEX_PROJECT_CONFIG_ERROR_CODE,
  {
    adapter: params.adapter,
    runtimeAdapter: 'codex',
    configPath: CODEX_PROJECT_CONFIG_PATH,
    configSource: 'project',
    workspaceSource: 'active-session-workspace',
    workspaceFolder: params.workspaceFolder,
    sessionId: params.sessionId,
    reason: sanitizeDiagnosticReason(params.reason),
    ...(params.location == null ? {} : params.location)
  }
)

const describeTomlValue = (value: unknown) => {
  if (Array.isArray(value)) return 'array'
  if (value == null) return 'null'
  return typeof value === 'object' ? 'table' : typeof value
}

const validateCodexWireApis = (params: {
  adapter: string
  content: string
  parsed: unknown
  sessionId: string
  workspaceFolder: string
}) => {
  const { content, parsed } = params
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return
  const providers = (parsed as Record<string, unknown>).model_providers
  if (providers == null || typeof providers !== 'object' || Array.isArray(providers)) return

  for (const [providerKey, providerValue] of Object.entries(providers)) {
    if (providerValue == null || typeof providerValue !== 'object' || Array.isArray(providerValue)) continue
    const providerRecord = providerValue as Record<string, unknown>
    if (!Object.hasOwn(providerRecord, 'wire_api')) continue
    const wireApi = providerRecord.wire_api
    if (typeof wireApi === 'string' && SUPPORTED_CODEX_WIRE_APIS.has(wireApi)) continue
    const location = findTomlKeyLocation(content, ['model_providers', providerKey, 'wire_api'])
    const reason = typeof wireApi === 'string'
      ? 'Unsupported wire_api value. Expected "responses" or "chat".'
      : `wire_api must be a string, not ${describeTomlValue(wireApi)}.`
    throw createProjectConfigError({
      ...params,
      message: 'Codex project config has an invalid wire_api value.',
      reason,
      location
    })
  }
}

export const validateCodexProjectConfig = async (params: {
  adapter: string
  cwd: string
  projectConfigPolicy?: ProjectConfigPolicy
  sessionId: string
}) => {
  if (params.projectConfigPolicy === 'global-only') return

  const workspaceFolder = resolve(params.cwd)
  const configPath = resolve(workspaceFolder, CODEX_PROJECT_CONFIG_PATH)
  let content: string
  try {
    content = await readFile(configPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }

  let parsed: unknown
  try {
    parsed = parse(content)
  } catch {
    throw createProjectConfigError({
      adapter: params.adapter,
      message: 'Codex could not parse the active workspace project config.',
      reason: 'The project config contains invalid TOML syntax.',
      sessionId: params.sessionId,
      workspaceFolder
    })
  }
  validateCodexWireApis({
    adapter: params.adapter,
    content,
    parsed,
    sessionId: params.sessionId,
    workspaceFolder
  })
}
