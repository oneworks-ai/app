/* eslint-disable max-lines -- Shell word parsing and trust checks stay together for permission safety. */
const SHELL_EXECUTABLE_NAMES = new Set(['bash', 'sh', 'zsh'])
const SHELL_COMMAND_FLAGS = new Set(['-c', '-lc'])
const SHELL_META_PATTERN = /[$`;&|<>()\r\n]/
const DOUBLE_QUOTED_UNSAFE_PATTERN = /[$`\\\r\n]/
const SINGLE_QUOTED_UNSAFE_PATTERN = /[\r\n]/

interface ShellWordPart {
  unsafe: boolean
  value: string
}

export const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

export const basename = (value: string) => value.replace(/\\/g, '/').split('/').pop() ?? value

const toCommandPart = (value: unknown) => {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  return undefined
}

const splitShellWords = (command: string): string[] | undefined => {
  const words: string[] = []
  let current = ''
  let quote: '"' | "'" | undefined
  let escaped = false
  let tokenStarted = false

  for (const char of command.trim()) {
    if (escaped) {
      current += char
      escaped = false
      tokenStarted = true
      continue
    }

    if (char === '\\' && quote !== "'") {
      escaped = true
      tokenStarted = true
      continue
    }

    if (quote != null) {
      if (char === quote) {
        quote = undefined
      } else {
        current += char
      }
      tokenStarted = true
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      tokenStarted = true
      continue
    }

    if (/\s/.test(char)) {
      if (tokenStarted) {
        words.push(current)
        current = ''
        tokenStarted = false
      }
      continue
    }

    current += char
    tokenStarted = true
  }

  if (escaped || quote != null) return undefined
  if (tokenStarted) words.push(current)
  return words
}

const splitTrustedShellWords = (command: string): ShellWordPart[] | undefined => {
  const words: ShellWordPart[] = []
  let current = ''
  let quote: '"' | "'" | undefined
  let escaped = false
  let tokenStarted = false
  let unsafe = false

  const pushWord = () => {
    words.push({ unsafe, value: current })
    current = ''
    tokenStarted = false
    unsafe = false
  }

  const trimmedCommand = command.trim()
  for (let index = 0; index < trimmedCommand.length; index += 1) {
    const char = trimmedCommand[index]!
    if (escaped) {
      current += char
      escaped = false
      tokenStarted = true
      continue
    }

    if (char === '\\' && quote !== "'") {
      const nextChar = trimmedCommand[index + 1]
      if (quote === '"' && nextChar != null && !['"', '\\', '$', '`', '\r', '\n'].includes(nextChar)) {
        current += char
        tokenStarted = true
        continue
      }
      escaped = true
      tokenStarted = true
      unsafe = unsafe || (
        nextChar == null ||
        nextChar === '$' ||
        nextChar === '`' ||
        nextChar === '\r' ||
        nextChar === '\n' ||
        (quote == null && (SHELL_META_PATTERN.test(nextChar) || /\s/.test(nextChar)))
      )
      continue
    }

    if (quote != null) {
      if (char === quote) {
        quote = undefined
      } else {
        current += char
        if (quote === '"' && DOUBLE_QUOTED_UNSAFE_PATTERN.test(char)) unsafe = true
        if (quote === "'" && SINGLE_QUOTED_UNSAFE_PATTERN.test(char)) unsafe = true
      }
      tokenStarted = true
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      tokenStarted = true
      continue
    }

    if (/\s/.test(char)) {
      if (tokenStarted) {
        pushWord()
      }
      continue
    }

    current += char
    if (SHELL_META_PATTERN.test(char)) unsafe = true
    tokenStarted = true
  }

  if (escaped || quote != null) return undefined
  if (tokenStarted) pushWord()
  return words
}

export const commandValueToWordCandidates = (command: unknown): string[][] => {
  if (typeof command === 'string') {
    const words = splitShellWords(command)
    return words == null ? [] : [words]
  }

  if (Array.isArray(command)) {
    const words = command.map(toCommandPart).filter((value): value is string => value != null && value.trim() !== '')
    return words.length === command.length && words.length > 0 ? [words] : []
  }

  if (!isRecord(command)) return []

  const candidates: string[][] = []
  if (command.command != null) {
    candidates.push(...commandValueToWordCandidates(command.command))
  }

  const executable = toCommandPart(command.executable)
  const rawArgs = Array.isArray(command.argv) ? command.argv : Array.isArray(command.args) ? command.args : []
  const args = rawArgs.map(toCommandPart).filter((value): value is string => value != null && value.trim() !== '')
  if (executable != null && executable.trim() !== '' && args.length === rawArgs.length) {
    candidates.push([executable, ...args])
  }

  return candidates
}

const hasUnsafeShellSyntax = (words: string[]) => words.some(word => SHELL_META_PATTERN.test(word))

const unwrapShellWords = (words: string[]): string[] | undefined => {
  const executable = basename(words[0] ?? '')
  if (!SHELL_EXECUTABLE_NAMES.has(executable)) return words
  if (words.length !== 3 || !SHELL_COMMAND_FLAGS.has(words[1] ?? '')) return undefined

  const nested = splitShellWords(words[2] ?? '')
  return nested == null ? undefined : nested
}

export const resolveTrustedShellWords = (words: string[]) => {
  if (words.length === 0 || hasUnsafeShellSyntax(words)) return undefined

  const unwrappedWords = unwrapShellWords(words)
  if (unwrappedWords == null || unwrappedWords.length === 0 || hasUnsafeShellSyntax(unwrappedWords)) return undefined
  return unwrappedWords
}

const resolveTrustedShellWordParts = (parts: ShellWordPart[]): string[] | undefined => {
  if (parts.length === 0) return undefined

  const executable = basename(parts[0]?.value ?? '')
  if (SHELL_EXECUTABLE_NAMES.has(executable)) {
    if (parts.length !== 3 || parts[0]?.unsafe === true || parts[1]?.unsafe === true) return undefined
    if (!SHELL_COMMAND_FLAGS.has(parts[1]?.value ?? '')) return undefined
    const nested = splitTrustedShellWords(parts[2]?.value ?? '')
    return nested == null ? undefined : resolveTrustedShellWordParts(nested)
  }

  if (parts.some(part => part.unsafe)) return undefined
  return parts.map(part => part.value)
}

const resolveTrustedShellWordPartsAllowingAndList = (parts: ShellWordPart[]): string[] | undefined => {
  if (parts.length === 0) return undefined

  const executable = basename(parts[0]?.value ?? '')
  if (SHELL_EXECUTABLE_NAMES.has(executable)) {
    if (parts.length !== 3 || parts[0]?.unsafe === true || parts[1]?.unsafe === true) return undefined
    if (!SHELL_COMMAND_FLAGS.has(parts[1]?.value ?? '')) return undefined
    const nested = splitTrustedShellWords(parts[2]?.value ?? '')
    return nested == null ? undefined : resolveTrustedShellWordPartsAllowingAndList(nested)
  }

  if (parts.some(part => part.unsafe && part.value !== '&&')) return undefined
  return parts.map(part => part.value)
}

export const commandValueToTrustedWordCandidates = (command: unknown): string[][] => {
  if (typeof command === 'string') {
    const words = splitTrustedShellWords(command)
    const trustedWords = words == null ? undefined : resolveTrustedShellWordParts(words)
    return trustedWords == null ? [] : [trustedWords]
  }

  return commandValueToWordCandidates(command)
    .map(resolveTrustedShellWords)
    .filter((words): words is string[] => words != null)
}

const splitAndListWords = (words: string[]): string[][] | undefined => {
  const commands: string[][] = []
  let current: string[] = []

  for (const word of words) {
    if (word === '&&') {
      if (current.length === 0) return undefined
      commands.push(current)
      current = []
      continue
    }

    current.push(word)
  }

  if (current.length === 0) return undefined
  commands.push(current)
  return commands
}

export const commandValueToTrustedAndListWordCandidates = (command: unknown): string[][][] => {
  if (typeof command === 'string') {
    const words = splitTrustedShellWords(command)
    const trustedWords = words == null ? undefined : resolveTrustedShellWordPartsAllowingAndList(words)
    const commands = trustedWords == null ? undefined : splitAndListWords(trustedWords)
    return commands == null ? [] : [commands]
  }

  return commandValueToTrustedWordCandidates(command).map(words => [words])
}
