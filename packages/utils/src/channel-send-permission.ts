import { basename, commandValueToTrustedAndListWordCandidates, isRecord } from './permission-command'
import type { PermissionToolSubject } from './permission-tool'
import { normalizePermissionToolName } from './permission-tool'

export const CHANNEL_SEND_PERMISSION_KEY = 'bash-oneworks-channel-send'
export const CHANNEL_SEND_PERMISSION_LABEL = 'oneworks channel send'
export const CHANNEL_SEND_PERMISSION_BASH_LOOKUP_KEYS = ['Bash']
export const ONEWORKS_MEM_PERMISSION_KEY = 'bash-oneworks-mem'
export const ONEWORKS_MEM_PERMISSION_LABEL = 'oneworks mem'
export const TRUSTED_ONEWORKS_CLI_PERMISSION_BASH_LOOKUP_KEYS = ['Bash']
export const CHANNEL_SESSION_BUILTIN_PERMISSION_KEYS = [
  CHANNEL_SEND_PERMISSION_KEY,
  ONEWORKS_MEM_PERMISSION_KEY
] as const

const ONEWORKS_MEM_SUBCOMMANDS = new Set(['get', 'list', 'patch', 'set'])
const ONEWORKS_CHANNEL_EMOJI_SUBCOMMANDS = new Set(['annotate', 'get', 'list', 'save', 'send'])
const ONEWORKS_CLI_ENTRIES = new Set(['oneworks', 'ow', 'owo'])

const isWorkingDirectoryPrefixWords = (words: string[]) => (
  basename(words[0] ?? '') === 'cd' && words.length === 2 && (words[1]?.trim() ?? '') !== ''
)

const stripWorkingDirectoryPrefixes = (commands: string[][]) => {
  let index = 0
  while (index < commands.length && isWorkingDirectoryPrefixWords(commands[index]!)) {
    index += 1
  }
  return commands.slice(index)
}

const resolveSendIndex = (words: string[], startIndex: number) => {
  if (words[startIndex] === 'send') return startIndex
  if (words[startIndex + 1] === 'send') return startIndex + 1
  return -1
}

const isOneworksChannelEmojiWords = (words: string[], startIndex: number) => {
  const emojiIndex = words[startIndex] === 'emoji'
    ? startIndex
    : words[startIndex + 1] === 'emoji'
    ? startIndex + 1
    : -1
  if (emojiIndex < 0) return false
  const action = words[emojiIndex + 1]
  if (!ONEWORKS_CHANNEL_EMOJI_SUBCOMMANDS.has(action ?? '')) return false
  return action === 'list' || emojiIndex + 1 < words.length - 1
}

const isOneworksChannelSendWords = (words: string[]) => {
  const executable = basename(words[0] ?? '')
  const commandStartIndex = ONEWORKS_CLI_ENTRIES.has(executable) && words[1] === 'channel'
    ? 2
    : -1
  if (commandStartIndex < 0) return false
  if (isOneworksChannelEmojiWords(words, commandStartIndex)) return true

  const sendIndex = resolveSendIndex(words, commandStartIndex)
  return sendIndex > 0 && sendIndex < words.length - 1
}

const isOneworksMemWords = (words: string[]) => {
  const executable = basename(words[0] ?? '')
  const commandIndex = ONEWORKS_CLI_ENTRIES.has(executable) && words[1] === 'mem'
    ? 2
    : -1

  return commandIndex > 0 && ONEWORKS_MEM_SUBCOMMANDS.has(words[commandIndex] ?? '')
}

export const isChannelSendCommandValue = (command: unknown) => (
  commandValueToTrustedAndListWordCandidates(command).some(commands => {
    const channelCommands = stripWorkingDirectoryPrefixes(commands)
    return channelCommands.length > 0 && channelCommands.every(isOneworksChannelSendWords)
  })
)

export const isOneworksMemCommandValue = (command: unknown) => (
  commandValueToTrustedAndListWordCandidates(command).some(commands => {
    const memCommands = stripWorkingDirectoryPrefixes(commands)
    return memCommands.length > 0 && memCommands.every(isOneworksMemWords)
  })
)

export const resolveChannelSendPermissionSubjectFromCommand = (
  command: unknown
): PermissionToolSubject | undefined => (
  isChannelSendCommandValue(command)
    ? {
      key: CHANNEL_SEND_PERMISSION_KEY,
      label: CHANNEL_SEND_PERMISSION_LABEL,
      scope: 'tool'
    }
    : undefined
)

export const resolveOneworksMemPermissionSubjectFromCommand = (
  command: unknown
): PermissionToolSubject | undefined => (
  isOneworksMemCommandValue(command)
    ? {
      key: ONEWORKS_MEM_PERMISSION_KEY,
      label: ONEWORKS_MEM_PERMISSION_LABEL,
      scope: 'tool'
    }
    : undefined
)

export const resolveTrustedOneworksCliPermissionSubjectFromCommand = (
  command: unknown
): PermissionToolSubject | undefined => (
  resolveChannelSendPermissionSubjectFromCommand(command) ??
    resolveOneworksMemPermissionSubjectFromCommand(command)
)

const resolveCommandFromToolInput = (toolInput: unknown) => (
  typeof toolInput === 'string'
    ? toolInput
    : isRecord(toolInput)
    ? toolInput.command ?? toolInput.cmd ?? toolInput.script
    : undefined
)

export const resolveTrustedOneworksCliPermissionSubjectFromToolCall = (params: {
  toolName?: string
  toolInput?: unknown
}): PermissionToolSubject | undefined => {
  const subject = normalizePermissionToolName(params.toolName)
  if (subject?.key !== 'Bash') return undefined

  return resolveTrustedOneworksCliPermissionSubjectFromCommand(resolveCommandFromToolInput(params.toolInput))
}

export const resolveChannelSendPermissionSubjectFromToolCall = (params: {
  toolName?: string
  toolInput?: unknown
}): PermissionToolSubject | undefined => {
  const subject = normalizePermissionToolName(params.toolName)
  if (subject?.key !== 'Bash') return undefined

  return resolveChannelSendPermissionSubjectFromCommand(resolveCommandFromToolInput(params.toolInput))
}
