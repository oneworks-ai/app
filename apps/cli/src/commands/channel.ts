/* eslint-disable max-lines -- Channel send CLI parsing and request dispatch stay colocated. */
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import process from 'node:process'

import type { Command } from 'commander'

import { MAX_CHANNEL_TEXT_MESSAGE_LENGTH, countChannelTextMessageCharacters } from '@oneworks/core/channel'
import type { ChannelTextMention } from '@oneworks/core/channel'
import {
  filterChannelEmojiRegistryEntries,
  findChannelEmojiRegistryEntry,
  formatChannelEmojiRegistryEntries,
  listChannelEmojiRegistryEntries,
  sortChannelEmojiRegistryEntriesByRecent,
  upsertChannelEmojiRegistryEntry
} from '@oneworks/utils'

import { resolveContext as resolveMemoryContext } from './memory/context'

export interface ChannelCommandOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  fetch?: typeof globalThis.fetch
}

interface ParsedChannelCommand {
  atAll?: boolean
  atIds?: string[]
  ats?: string
  channelKey?: string
  command: 'send'
  cwd?: string
  lineBreakToken?: string
  message: unknown
  receiveId?: string
  receiveIdType?: string
  server?: string
}

interface ParsedEmojiCommand {
  action: 'annotate' | 'get' | 'list' | 'save' | 'send'
  aliases?: string[]
  channelKey?: string
  emojiMd5?: string
  emojiSize?: string
  id?: string
  label?: string
  limit?: number
  metadata?: Record<string, string>
  note?: string
  platform?: string
  query?: string
  receiveId?: string
  receiveIdType?: string
  recent?: boolean
  sendable?: boolean
  server?: string
  tags?: string[]
}

const CHANNEL_CONTEXT_PATH_ENV = '__ONEWORKS_PROJECT_CHANNEL_CONTEXT_PATH__'
const CHANNEL_KEY_ENV = '__ONEWORKS_PROJECT_CHANNEL_KEY__'
const CHANNEL_ID_ENV = '__ONEWORKS_PROJECT_CHANNEL_ID__'
const SESSION_ID_ENV = '__ONEWORKS_PROJECT_SESSION_ID__'
const DEFAULT_LINE_BREAK_TOKEN = '⏎'
const ESCAPED_LINE_BREAK_RE = /\\r\\n|\\n|\\r/gu

const normalizeLineBreaks = (value: string, lineBreakToken?: string) => {
  const token = lineBreakToken?.trim()
  const marked = token == null || token === '' ? value : value.split(token).join('\n')
  return marked.replace(ESCAPED_LINE_BREAK_RE, '\n')
}

const trimNonEmpty = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const readContext = (env: NodeJS.ProcessEnv) => {
  const contextPath = trimNonEmpty(env[CHANNEL_CONTEXT_PATH_ENV])
  if (contextPath == null) return {}

  try {
    const parsed = JSON.parse(readFileSync(contextPath, 'utf8')) as unknown
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

const optionValueNames = new Set([
  '--at',
  '--ats',
  '--channel',
  '--channel-key',
  '--cwd',
  '--line-break-token',
  '--newline-token',
  '--receive-id',
  '--receive-id-type',
  '--server',
  '--to'
])
const booleanOptions = new Set(['--br'])

type StringOptionKey = 'channelKey' | 'cwd' | 'receiveId' | 'receiveIdType' | 'server'

const optionAliases: Record<string, StringOptionKey> = {
  '--channel': 'channelKey',
  '--channel-key': 'channelKey',
  '--cwd': 'cwd',
  '--receive-id': 'receiveId',
  '--receive-id-type': 'receiveIdType',
  '--server': 'server',
  '--to': 'receiveId'
}

const emojiOptionValueNames = new Set([
  '--alias',
  '--channel',
  '--channel-key',
  '--emoji-md5',
  '--emoji-size',
  '--id',
  '--label',
  '--limit',
  '--meta',
  '--note',
  '--platform',
  '--query',
  '--receive-id',
  '--receive-id-type',
  '--server',
  '--tag',
  '--to'
])
const emojiBooleanOptions = new Set(['--recent', '--sendable'])

const isEmojiCommand = (argv: string[]) => argv[0] === 'emoji' || argv[1] === 'emoji'

const parseEmojiArgs = (argv: string[]): ParsedEmojiCommand => {
  const channelKey = argv[0] === 'emoji' ? undefined : argv[0]
  const args = argv[0] === 'emoji' ? argv.slice(1) : argv.slice(2)
  const action = args[0]
  if (action !== 'list' && action !== 'get' && action !== 'save' && action !== 'annotate' && action !== 'send') {
    throw new Error('Usage: oneworks channel [channelKey] emoji <list|get|save|annotate|send> [id]')
  }

  const positionals: string[] = []
  const options: ParsedEmojiCommand = { action, channelKey }
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index]
    if (emojiBooleanOptions.has(arg)) {
      if (arg === '--recent') {
        options.recent = true
      } else if (arg === '--sendable') {
        options.sendable = true
      }
      continue
    }
    if (emojiOptionValueNames.has(arg)) {
      const value = args[index + 1]
      if (value == null) {
        throw new Error(`Missing value for ${arg}.`)
      }
      if (arg === '--alias') {
        options.aliases = [...(options.aliases ?? []), value]
      } else if (arg === '--channel' || arg === '--channel-key') {
        options.channelKey = value
      } else if (arg === '--emoji-md5') {
        options.emojiMd5 = value
      } else if (arg === '--emoji-size') {
        options.emojiSize = value
      } else if (arg === '--id') {
        options.id = value
      } else if (arg === '--label') {
        options.label = value
      } else if (arg === '--limit') {
        const limit = Number.parseInt(value, 10)
        if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('--limit must be a positive integer.')
        options.limit = limit
      } else if (arg === '--meta') {
        const separator = value.indexOf('=')
        if (separator < 1) throw new Error('--meta expects key=value.')
        const key = value.slice(0, separator).trim()
        if (key === '') throw new Error('--meta expects key=value.')
        options.metadata = {
          ...(options.metadata ?? {}),
          [key]: value.slice(separator + 1).trim()
        }
      } else if (arg === '--note') {
        options.note = value
      } else if (arg === '--platform') {
        options.platform = value
      } else if (arg === '--query') {
        options.query = value
      } else if (arg === '--receive-id' || arg === '--to') {
        options.receiveId = value
      } else if (arg === '--receive-id-type') {
        options.receiveIdType = value
      } else if (arg === '--server') {
        options.server = value
      } else if (arg === '--tag') {
        options.tags = [...(options.tags ?? []), value]
      }
      index += 1
      continue
    }
    positionals.push(arg)
  }

  return {
    ...options,
    id: options.id ?? positionals[0]
  }
}

const parseArgs = (argv: string[]): Omit<ParsedChannelCommand, 'message'> & { contentParts: string[] } => {
  const positionals: string[] = []
  const options: Partial<ParsedChannelCommand> = {}

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--at-all') {
      options.atAll = true
      continue
    }
    if (booleanOptions.has(arg)) {
      if (arg === '--br') {
        options.lineBreakToken = DEFAULT_LINE_BREAK_TOKEN
      }
      continue
    }
    if (optionValueNames.has(arg)) {
      const value = argv[index + 1]
      if (value == null) {
        throw new Error(`Missing value for ${arg}.`)
      }
      if (arg === '--at') {
        options.atIds = [...(options.atIds ?? []), value]
      } else if (arg === '--ats') {
        options.ats = value
      } else if (arg === '--line-break-token' || arg === '--newline-token') {
        options.lineBreakToken = value
      } else {
        const optionKey = optionAliases[arg]
        if (optionKey != null) {
          options[optionKey] = value
        }
      }
      index += 1
      continue
    }
    positionals.push(arg)
  }

  if (positionals[0] === 'send') {
    return {
      ...options,
      command: 'send',
      contentParts: positionals.slice(1)
    }
  }

  if (positionals[1] === 'send') {
    return {
      ...options,
      channelKey: options.channelKey ?? positionals[0],
      command: 'send',
      contentParts: positionals.slice(2)
    }
  }

  throw new Error('Usage: oneworks channel [channelKey] send <text|payload>')
}

const toMention = (id: string): ChannelTextMention | undefined => {
  const normalized = trimNonEmpty(id)
  if (normalized == null) return undefined
  return {
    id: normalized,
    platform: 'wechat',
    type: normalized === 'notify@all' ? 'all' : 'user'
  }
}

const resolveMentions = (parsed: Omit<ParsedChannelCommand, 'message'>) => {
  const atsMentions = trimNonEmpty(parsed.ats)
    ?.split(',')
    .map(toMention)
    .filter((item): item is ChannelTextMention => item != null) ?? []
  const directMentions = (parsed.atIds ?? [])
    .map(toMention)
    .filter((item): item is ChannelTextMention => item != null)
  const allMention = parsed.atAll === true
    ? [toMention('notify@all')].filter((item): item is ChannelTextMention => item != null)
    : []
  const mentions = [...atsMentions, ...directMentions, ...allMention]
  return mentions.length === 0 ? undefined : mentions
}

const readStdin = async () => {
  if (process.stdin.isTTY) return ''
  const chunks: Uint8Array[] = []
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

const parseLooseObject = (raw: string) => {
  const body = raw.replace(/^\s*\{\s*/u, '').replace(/\s*\}\s*$/u, '')
  const entries = body
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
  const result: Record<string, string> = {}

  for (const entry of entries) {
    const separator = entry.indexOf(':')
    if (separator < 0) continue
    const key = entry.slice(0, separator).trim().replace(/^['"]|['"]$/gu, '')
    const value = entry.slice(separator + 1).trim().replace(/^['"]|['"]$/gu, '')
    if (key !== '') {
      result[key] = value
    }
  }

  return Object.keys(result).length === 0 ? undefined : result
}

const normalizeParsedMessage = (message: unknown, lineBreakToken?: string): unknown => {
  if (typeof message === 'string') return normalizeLineBreaks(message, lineBreakToken)
  if (!isRecord(message)) return message
  const next = { ...message }
  if (typeof next.text === 'string') next.text = normalizeLineBreaks(next.text, lineBreakToken)
  if (typeof next.content === 'string') next.content = normalizeLineBreaks(next.content, lineBreakToken)
  return next
}

const parseMessage = async (contentParts: string[], options: { lineBreakToken?: string } = {}) => {
  const raw = (contentParts.join(' ') || await readStdin()).trim()
  if (raw === '') {
    throw new Error('Missing message content.')
  }

  if (raw.startsWith('{') && raw.endsWith('}')) {
    try {
      return normalizeParsedMessage(JSON.parse(raw) as unknown, options.lineBreakToken)
    } catch {
      const loose = parseLooseObject(raw)
      if (loose != null) return normalizeParsedMessage(loose, options.lineBreakToken)
      throw new Error('Object payload must be valid JSON or key:value pairs.')
    }
  }

  return normalizeLineBreaks(raw, options.lineBreakToken)
}

const normalizeServerHost = (host: string) => {
  const normalized = host.trim()
  if (normalized === '' || normalized === '0.0.0.0' || normalized === '::') {
    return '127.0.0.1'
  }
  return normalized
}

const resolveServerBaseUrl = (input: { env: NodeJS.ProcessEnv; server?: string }) => {
  const explicit = trimNonEmpty(input.server)
  if (explicit != null) return explicit.replace(/\/+$/u, '')

  const envBase = trimNonEmpty(input.env.__ONEWORKS_PROJECT_SERVER_BASE_URL__)
  if (envBase != null) return envBase.replace(/\/+$/u, '')

  const host = normalizeServerHost(trimNonEmpty(input.env.__ONEWORKS_PROJECT_SERVER_HOST__) ?? '127.0.0.1')
  const port = trimNonEmpty(input.env.__ONEWORKS_PROJECT_SERVER_PORT__) ?? '8787'
  return `http://${host}:${port}`
}

const normalizeApiResponse = async (response: Response) => {
  const text = await response.text()
  const parsed = text === ''
    ? {}
    : JSON.parse(text) as unknown

  if (!response.ok) {
    if (isRecord(parsed) && isRecord(parsed.error) && typeof parsed.error.message === 'string') {
      throw new Error(parsed.error.message)
    }
    if (isRecord(parsed) && typeof parsed.message === 'string') {
      throw new Error(parsed.message)
    }
    throw new Error(`Channel send failed: HTTP ${response.status}`)
  }

  if (isRecord(parsed) && parsed.success === true) {
    return isRecord(parsed.data) ? parsed.data : {}
  }
  return isRecord(parsed) ? parsed : {}
}

const resolveTextMessageContent = (message: unknown) => {
  if (typeof message === 'string') return message
  if (!isRecord(message)) return undefined

  const type = trimNonEmpty(message.type)?.toLowerCase()
  if (type != null && type !== 'text') return undefined

  return trimNonEmpty(message.text) ?? trimNonEmpty(message.content)
}

const assertTextMessageLength = (message: unknown) => {
  const text = resolveTextMessageContent(message)
  if (text == null) return

  const length = countChannelTextMessageCharacters(text)
  if (length > MAX_CHANNEL_TEXT_MESSAGE_LENGTH) {
    throw new Error(
      `Channel text messages must be ${MAX_CHANNEL_TEXT_MESSAGE_LENGTH} characters or fewer; got ${length}. ` +
        'Shorten the visible reply or send an emoji/file instead.'
    )
  }
}

const resolveEmojiRegistryContext = (input: {
  cwd: string
  env: NodeJS.ProcessEnv
  platform?: string
}) => {
  const context = resolveMemoryContext({
    channel: input.platform,
    cwd: input.cwd,
    env: input.env
  })
  const platform = trimNonEmpty(input.platform) ?? context.channelType
  if (platform == null) {
    throw new Error('Missing emoji platform. Pass --platform or run from a channel session context.')
  }
  return {
    platform,
    root: context.root
  }
}

const runEmojiCommand = async (
  argv: string[],
  options: ChannelCommandOptions
): Promise<string> => {
  const env = options.env ?? process.env
  const cwd = options.cwd ?? process.cwd()
  const parsed = parseEmojiArgs(argv)
  const { platform, root } = resolveEmojiRegistryContext({ cwd, env, platform: parsed.platform })

  if (parsed.action === 'list') {
    const entries = filterChannelEmojiRegistryEntries(
      await listChannelEmojiRegistryEntries(root, platform),
      {
        query: parsed.query,
        sendable: parsed.sendable,
        tags: parsed.tags
      }
    )
    const ordered = parsed.recent === true ? sortChannelEmojiRegistryEntriesByRecent(entries) : entries
    return formatChannelEmojiRegistryEntries(parsed.limit == null ? ordered : ordered.slice(0, parsed.limit))
  }

  const id = trimNonEmpty(parsed.id)
  if (id == null) {
    throw new Error(`Emoji ${parsed.action} requires an id.`)
  }

  if (parsed.action === 'get') {
    const emoji = await findChannelEmojiRegistryEntry(root, { id, platform })
    if (emoji == null) throw new Error(`Emoji "${id}" was not found in the ${platform} registry.`)
    return JSON.stringify(emoji, null, 2)
  }

  if (parsed.action === 'save' || parsed.action === 'annotate') {
    const emojiMd5 = trimNonEmpty(parsed.emojiMd5)
    const emojiSize = trimNonEmpty(parsed.emojiSize)
    const emoji = await upsertChannelEmojiRegistryEntry(root, {
      id,
      platform,
      ...(parsed.aliases == null || parsed.aliases.length === 0 ? {} : { aliases: parsed.aliases }),
      ...(trimNonEmpty(parsed.label) == null ? {} : { label: trimNonEmpty(parsed.label) }),
      ...(trimNonEmpty(parsed.note) == null ? {} : { note: trimNonEmpty(parsed.note) }),
      ...(parsed.tags == null || parsed.tags.length === 0 ? {} : { tags: parsed.tags }),
      metadata: {
        ...(parsed.metadata ?? {}),
        ...(emojiMd5 == null ? {} : { emojiMd5 }),
        ...(emojiSize == null ? {} : { emojiSize })
      }
    })
    return `Emoji saved: ${emoji.platform}:${emoji.id}`
  }

  return await runChannelCommand([
    ...(parsed.channelKey == null ? [] : [parsed.channelKey]),
    'send',
    ...(parsed.receiveId == null ? [] : ['--to', parsed.receiveId]),
    ...(parsed.receiveIdType == null ? [] : ['--receive-id-type', parsed.receiveIdType]),
    ...(parsed.server == null ? [] : ['--server', parsed.server]),
    JSON.stringify({ type: 'emoji', id, platform })
  ], options)
}

export const runChannelCommand = async (
  argv: string[],
  options: ChannelCommandOptions = {}
): Promise<string> => {
  if (isEmojiCommand(argv)) {
    return await runEmojiCommand(argv, options)
  }

  const env = options.env ?? process.env
  const cwd = options.cwd ?? process.cwd()
  const context = readContext(env)
  const parsed = parseArgs(argv)
  const message = await parseMessage(parsed.contentParts, { lineBreakToken: parsed.lineBreakToken })
  assertTextMessageLength(message)
  const mentions = resolveMentions(parsed)
  const channelKey = trimNonEmpty(parsed.channelKey) ??
    trimNonEmpty(context.channelKey) ??
    trimNonEmpty(env[CHANNEL_KEY_ENV])
  const receiveId = trimNonEmpty(parsed.receiveId) ??
    trimNonEmpty(context.replyReceiveId) ??
    trimNonEmpty(context.channelId) ??
    trimNonEmpty(env[CHANNEL_ID_ENV])
  const receiveIdType = trimNonEmpty(parsed.receiveIdType) ??
    trimNonEmpty(context.replyReceiveIdType) ??
    'chat_id'
  const sessionId = trimNonEmpty(context.sessionId) ?? trimNonEmpty(env[SESSION_ID_ENV])

  if (channelKey == null) {
    throw new Error('Missing channel key. Pass a channel key or run from a channel session context.')
  }

  const fetchImpl = options.fetch ?? globalThis.fetch
  const response = await fetchImpl(
    `${resolveServerBaseUrl({ env, server: parsed.server })}/api/channels/${encodeURIComponent(channelKey)}/send`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cwd: parsed.cwd ?? cwd,
        message,
        ...(mentions == null ? {} : { mentions }),
        receiveId,
        receiveIdType,
        ...(sessionId == null ? {} : { sessionId })
      })
    }
  )
  const data = await normalizeApiResponse(response)
  const type = typeof data.type === 'string' ? data.type : 'message'
  const messageId = typeof data.messageId === 'string' ? data.messageId : undefined

  return [
    `Sent ${type} message through channel ${channelKey}.`,
    messageId == null ? undefined : `messageId: ${messageId}`
  ].filter(Boolean).join('\n')
}

const printResult = (output: string) => {
  if (output === '') return
  process.stdout.write(output.endsWith('\n') ? output : `${output}\n`)
}

export const registerChannelSubcommands = (command: Command) => {
  command
    .allowUnknownOption()
    .allowExcessArguments()
    .argument('[args...]')
    .description('Send messages through OneWorks channels from agent sessions')
    .action(async (args: string[]) => {
      printResult(await runChannelCommand(args))
    })

  return command
}

export const registerChannelCommand = (program: Command) => {
  registerChannelSubcommands(
    program
      .command('channel')
      .description('Send messages through OneWorks channels from agent sessions')
  )
}
