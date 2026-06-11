import type { AgentRoomInteractionRequestView } from '../@types/agent-room-view'

export interface StructuredCommandContent {
  command: string
  shell?: string
  args: string[]
  script?: string
}

const shellNames = new Set(['bash', 'zsh', 'sh', 'fish'])

const extractBacktickCommand = (content: string) => {
  const match = /`([^`]+)`/u.exec(content)

  return match?.[1]?.trim()
}

const tokenizeCommand = (command: string) => {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaping = false

  for (const char of command) {
    if (escaping) {
      current += char
      escaping = false
      continue
    }

    if (char === '\\' && quote !== "'") {
      escaping = true
      continue
    }

    if (quote != null) {
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      continue
    }

    if (/\s/u.test(char)) {
      if (current !== '') {
        tokens.push(current)
        current = ''
      }
      continue
    }

    current += char
  }

  if (escaping) {
    current += '\\'
  }

  if (current !== '') {
    tokens.push(current)
  }

  return tokens
}

const getShellInvocation = (commandPath: string | undefined) => {
  if (commandPath == null || commandPath === '') {
    return undefined
  }

  const basename = commandPath.split('/').filter(Boolean).at(-1)

  return basename != null && shellNames.has(basename) ? commandPath : undefined
}

export const getStructuredCommandContent = (
  content: string,
  request: AgentRoomInteractionRequestView
): StructuredCommandContent | undefined => {
  const command = extractBacktickCommand(content)
  if (command == null || command === '') {
    return undefined
  }

  const subject = request.subjectLabel?.trim().toLowerCase()
  const looksLikeCommandRequest = subject === 'bash' || /bash|shell|command|命令|执行/iu.test(content)
  if (!looksLikeCommandRequest) {
    return undefined
  }

  const tokens = tokenizeCommand(command)
  const shell = getShellInvocation(tokens[0])
  const scriptOptionIndex = shell != null
    ? tokens.findIndex((token, index) => index > 0 && token.startsWith('-') && token.includes('c'))
    : -1
  const script = scriptOptionIndex >= 0 ? tokens[scriptOptionIndex + 1] : undefined

  return {
    command,
    shell,
    args: shell != null
      ? tokens.slice(1, scriptOptionIndex >= 0 ? scriptOptionIndex + 1 : undefined)
      : [],
    script: script == null || script === '' ? undefined : script
  }
}
