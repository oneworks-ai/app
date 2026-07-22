/* eslint-disable max-lines -- plugin CLI routing keeps discovery, command registration, and invocation together. */
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import process from 'node:process'
import readline from 'node:readline/promises'

import { buildConfigJsonVariables, loadConfigState } from '@oneworks/config'
import type { PluginConfig, PluginContributionCliCommand, PluginLocalizedText } from '@oneworks/types'
import {
  flattenPluginInstances,
  mergeProcessEnvWithProjectEnv,
  resolveConfiguredPluginInstances,
  resolveRuntimePluginConfig
} from '@oneworks/utils'
import type { ResolvedPluginInstance } from '@oneworks/utils/plugin-resolver'
import type { Command } from 'commander'

import { resolveCliWorkspaceCwd } from '#~/workspace.js'

const PLUGIN_CLI_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/u
const BUILTIN_ROOT_COMMANDS = new Set([
  'agent',
  'adapter',
  'benchmark',
  'channel',
  'clear',
  'config',
  'kill',
  'list',
  'ls',
  'mem',
  'plugin',
  'report',
  'skills',
  'stop',
  '__run'
])

export interface PluginCliCommandContribution {
  command: PluginContributionCliCommand
  displayName?: string
  packageId?: string
  path: string[]
  scope: string
}

interface RunPluginCliCommandOptions {
  account?: string
  args: string[]
  commandId: string
  daemon?: string
  input?: string
  interactive?: boolean
  json?: boolean
  open?: boolean
  scope: string
  server?: string
  stdin?: boolean
  user?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const sanitizeScopePart = (value: string) => (
  value
    .replace(/^@/u, '')
    .replace(/^oneworks[/-]plugin[/-]/u, '')
    .replace(/^plugin[/-]/u, '')
    .replace(/[^\w.-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .toLowerCase()
)

const deriveScope = (instance: ResolvedPluginInstance) => {
  if (instance.scope?.trim()) return instance.scope.trim()
  const source = instance.packageId ?? instance.rootDir.split(/[\\/]+/u).pop() ?? ''
  const parts = source.split('/')
  return sanitizeScopePart(parts[parts.length - 1] ?? '') || 'plugin'
}

const normalizeCommandId = (value: unknown) => {
  const text = typeof value === 'string' ? value.trim() : ''
  return PLUGIN_CLI_ID_PATTERN.test(text) ? text : undefined
}

const normalizeStringList = (value: unknown) => (
  Array.isArray(value)
    ? value.map(normalizeCommandId).filter((item): item is string => item != null)
    : undefined
)

const normalizeCliPath = (value: unknown) => {
  const path = normalizeStringList(value)
  return path == null || path.length === 0 ? undefined : path
}

const normalizeLocalizedText = (value: unknown): PluginLocalizedText | undefined => {
  if (typeof value === 'string' && value.trim() !== '') return value.trim()
  if (!isRecord(value)) return undefined
  return textRecord(value)
}

const textRecord = (value: Record<string, unknown>) => {
  const entries = Object.entries(value)
    .filter((entry): entry is [string, string] => entry[0].trim() !== '' && typeof entry[1] === 'string')
    .map(([key, item]) => [key.trim(), item.trim()] as const)
    .filter(([, item]) => item !== '')
  return entries.length === 0 ? undefined : Object.fromEntries(entries)
}

const normalizeCliCommandContribution = (value: unknown): PluginContributionCliCommand | undefined => {
  if (!isRecord(value)) return undefined
  const id = normalizeCommandId(value.id)
  const command = normalizeCommandId(value.command)
  if (id == null || command == null) return undefined

  const title = typeof value.title === 'string' && value.title.trim() !== '' ? value.title.trim() : undefined
  const aliases = normalizeStringList(value.aliases)
  const path = normalizeCliPath(value.path)
  const description = normalizeLocalizedText(value.description)
  return {
    id,
    command,
    ...(aliases == null ? {} : { aliases }),
    ...(description == null ? {} : { description }),
    ...(isRecord(value.descriptionI18n) ? { descriptionI18n: textRecord(value.descriptionI18n) } : {}),
    ...(isRecord(value.i18n) ? { i18n: value.i18n as PluginContributionCliCommand['i18n'] } : {}),
    ...(path == null ? {} : { path }),
    ...(value.root === true ? { root: true } : {}),
    ...(title == null ? {} : { title }),
    ...(isRecord(value.titleI18n) ? { titleI18n: textRecord(value.titleI18n) } : {})
  }
}

const normalizeCliCommands = (value: unknown) => (
  Array.isArray(value)
    ? value.map(normalizeCliCommandContribution).filter((item): item is PluginContributionCliCommand => item != null)
    : []
)

const localeCandidates = () => {
  const lang = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || ''
  return lang.toLowerCase().startsWith('zh')
    ? ['zh-Hans', 'zh-CN', 'zh', 'en']
    : ['en', 'zh-Hans', 'zh-CN', 'zh']
}

const pickLocalizedText = (value: PluginLocalizedText | undefined) => {
  if (typeof value === 'string') return value
  if (value == null) return undefined
  for (const locale of localeCandidates()) {
    const text = value[locale]
    if (typeof text === 'string' && text.trim() !== '') return text.trim()
  }
  return Object.values(value).find(text => text.trim() !== '')?.trim()
}

const pickCommandI18nText = (
  command: PluginContributionCliCommand,
  field: 'description' | 'title'
) => (
  command.i18n == null
    ? undefined
    : pickLocalizedText(
      Object.fromEntries(Object.entries(command.i18n).map(([key, value]) => [key, value[field] ?? '']))
    )
)

const readCommandTitle = (command: PluginContributionCliCommand) => (
  command.title ??
    pickLocalizedText(command.titleI18n) ??
    pickCommandI18nText(command, 'title') ??
    command.id
)

const readCommandDescription = (command: PluginContributionCliCommand) => (
  pickLocalizedText(command.description) ??
    pickLocalizedText(command.descriptionI18n) ??
    pickCommandI18nText(command, 'description') ??
    readCommandTitle(command)
)

const resolveServerBaseUrl = (input: { daemon?: string; env: NodeJS.ProcessEnv }) => {
  const explicit = input.daemon?.trim()
  if (explicit != null && explicit !== '') return explicit.replace(/\/+$/u, '')

  const envBase = input.env.__ONEWORKS_PROJECT_SERVER_BASE_URL__?.trim()
  if (envBase != null && envBase !== '') return envBase.replace(/\/+$/u, '')

  const rawHost = input.env.__ONEWORKS_PROJECT_SERVER_HOST__?.trim() || '127.0.0.1'
  const host = rawHost === '0.0.0.0' || rawHost === '::' ? '127.0.0.1' : rawHost
  const port = input.env.__ONEWORKS_PROJECT_SERVER_PORT__?.trim() || '8787'
  return `http://${host}:${port}`
}

const readStdinText = async () => {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  return Buffer.concat(chunks).toString('utf8')
}

const parseJsonText = (value: string, label: string) => {
  if (value.trim() === '') return undefined
  try {
    return JSON.parse(value) as unknown
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid ${label} JSON: ${message}`)
  }
}

const readStructuredInput = async (options: RunPluginCliCommandOptions) => {
  if (options.stdin === true) return parseJsonText(await readStdinText(), 'stdin')
  if (options.input != null) return parseJsonText(options.input, '--input')
  return undefined
}

const buildInvocationPayload = async (options: RunPluginCliCommandOptions) => {
  const structuredInput = await readStructuredInput(options)
  const payload = isRecord(structuredInput)
    ? { ...structuredInput }
    : structuredInput == null
    ? {}
    : { input: structuredInput }
  return {
    ...payload,
    ...(options.account == null ? {} : { accountKey: options.account }),
    args: options.args,
    interactive: options.interactive === true,
    ...(options.server == null ? {} : { server: options.server }),
    ...(options.user == null ? {} : { user: options.user })
  }
}

const readJsonResponse = async (response: Response) => {
  const text = await response.text()
  if (text.trim() === '') return {}
  return JSON.parse(text) as unknown
}

const unwrapApiResponse = async (response: Response) => {
  const parsed = await readJsonResponse(response)

  if (!response.ok) {
    if (isRecord(parsed) && isRecord(parsed.error) && typeof parsed.error.message === 'string') {
      throw new Error(parsed.error.message)
    }
    if (isRecord(parsed) && typeof parsed.message === 'string') {
      throw new Error(parsed.message)
    }
    throw new Error(`Plugin command failed: HTTP ${response.status}`)
  }

  if (isRecord(parsed) && parsed.success === true) {
    return isRecord(parsed.data) ? parsed.data : {}
  }
  return parsed
}

const invokePluginCommand = async (
  baseUrl: string,
  options: RunPluginCliCommandOptions,
  payload: Record<string, unknown>
) => {
  const response = await fetch(
    `${baseUrl}/api/plugins/${encodeURIComponent(options.scope)}/commands/${encodeURIComponent(options.commandId)}`,
    {
      body: JSON.stringify({ payload }),
      headers: {
        'content-type': 'application/json'
      },
      method: 'POST'
    }
  )
  return await unwrapApiResponse(response)
}

const openUrl = async (url: string) => {
  const command = process.platform === 'darwin'
    ? 'open'
    : process.platform === 'win32'
    ? 'cmd'
    : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]

  return await new Promise<boolean>((resolve) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    child.once('error', () => resolve(false))
    child.once('spawn', () => {
      child.unref()
      resolve(true)
    })
  })
}

const formatAccountLabel = (value: unknown, index: number) => {
  if (!isRecord(value)) return `${index + 1}. ${String(value)}`
  const login = typeof value.loginId === 'string' && value.loginId.trim() !== ''
    ? value.loginId.trim()
    : typeof value.name === 'string' && value.name.trim() !== ''
    ? value.name.trim()
    : typeof value.userId === 'string'
    ? value.userId
    : 'unknown'
  const server = typeof value.serverAlias === 'string' && value.serverAlias.trim() !== ''
    ? value.serverAlias.trim()
    : typeof value.serverId === 'string'
    ? value.serverId
    : ''
  const email = typeof value.email === 'string' && value.email.trim() !== '' ? ` <${value.email.trim()}>` : ''
  const key = typeof value.accountKey === 'string' && value.accountKey.trim() !== ''
    ? ` (${value.accountKey.trim()})`
    : ''
  return `${index + 1}. ${login}${email}${server === '' ? '' : ` @ ${server}`}${key}`
}

const needsSelection = (value: unknown): value is { candidates: unknown[]; selectionRequired: true } => (
  isRecord(value) && value.selectionRequired === true && Array.isArray(value.candidates)
)

const promptForAccountKey = async (candidates: unknown[]) => {
  for (const [index, candidate] of candidates.entries()) {
    console.error(formatAccountLabel(candidate, index))
  }
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr
  })
  try {
    const answer = await rl.question('Select account: ')
    const selectedIndex = Number(answer.trim())
    if (!Number.isInteger(selectedIndex) || selectedIndex < 1 || selectedIndex > candidates.length) {
      throw new Error('Invalid account selection.')
    }
    const selected = candidates[selectedIndex - 1]
    if (!isRecord(selected) || typeof selected.accountKey !== 'string' || selected.accountKey.trim() === '') {
      throw new Error('Selected account does not include an accountKey.')
    }
    return selected.accountKey.trim()
  } finally {
    rl.close()
  }
}

const printAccountRows = (accounts: unknown[]) => {
  if (accounts.length === 0) {
    console.log('No accounts.')
    return
  }
  for (const account of accounts) {
    if (!isRecord(account)) {
      console.log(String(account))
      continue
    }
    const enabled = account.enabled === true ? 'enabled' : 'disabled'
    const login = typeof account.loginId === 'string' && account.loginId.trim() !== ''
      ? account.loginId.trim()
      : typeof account.name === 'string' && account.name.trim() !== ''
      ? account.name.trim()
      : typeof account.userId === 'string'
      ? account.userId
      : 'unknown'
    const server = typeof account.serverAlias === 'string' && account.serverAlias.trim() !== ''
      ? account.serverAlias.trim()
      : typeof account.serverId === 'string'
      ? account.serverId
      : ''
    const email = typeof account.email === 'string' && account.email.trim() !== '' ? ` ${account.email.trim()}` : ''
    const key = typeof account.accountKey === 'string' && account.accountKey.trim() !== ''
      ? ` ${account.accountKey.trim()}`
      : ''
    console.log(`${enabled}\t${server}\t${login}${email}${key}`)
  }
}

const printCommandResult = async (result: unknown, options: RunPluginCliCommandOptions) => {
  if (options.json === true) {
    console.log(JSON.stringify(result ?? null, null, 2))
    return
  }

  if (isRecord(result) && typeof result.loginUrl === 'string' && result.loginUrl.trim() !== '') {
    if (options.open === true && !await openUrl(result.loginUrl)) {
      console.error('Failed to open login URL in the system browser.')
    }
    console.log(result.loginUrl)
    return
  }

  if (isRecord(result) && Array.isArray(result.accounts)) {
    printAccountRows(result.accounts)
    return
  }

  if (isRecord(result) && typeof result.message === 'string' && result.message.trim() !== '') {
    console.log(result.message.trim())
    return
  }

  if (typeof result === 'string') {
    console.log(result)
    return
  }
  console.log(JSON.stringify(result ?? null, null, 2))
}

const commandPathForContribution = (scope: string, command: PluginContributionCliCommand) => {
  const path = command.path == null || command.path.length === 0 ? [command.id] : command.path
  return command.root === true ? path : [scope, ...path]
}

export const getPluginCliCommandRoots = (
  commands: PluginCliCommandContribution[]
) => [...new Set(commands.map(command => command.path[0]).filter((item): item is string => item != null))]

export const loadPluginCliCommandContributions = async (
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
): Promise<PluginCliCommandContribution[]> => {
  const cwd = resolveCliWorkspaceCwd(options.cwd ?? process.cwd(), options.env ?? process.env)
  const env = mergeProcessEnvWithProjectEnv(options.env, { workspaceFolder: cwd }) as NodeJS.ProcessEnv
  const state = await loadConfigState({
    cwd,
    env,
    jsonVariables: buildConfigJsonVariables(cwd, env)
  })
  const disableGlobalConfig = state.mergedConfig.disableGlobalConfig === true ||
    (state.globalConfig == null && state.globalSource?.resolvedConfig?.disableGlobalConfig === true)
  const plugins = await resolveRuntimePluginConfig({
    cwd,
    disableGlobalConfig,
    env,
    includeDefaultOfficialPlugins: true,
    marketplaces: state.mergedConfig.marketplaces,
    plugins: state.mergedConfig.plugins as PluginConfig | undefined
  })
  const instances = flattenPluginInstances(
    await resolveConfiguredPluginInstances({
      cwd,
      includeDisabled: false,
      plugins,
      preferBundledOfficialPlugins: true
    })
  )

  return instances.flatMap((instance) => {
    const scope = deriveScope(instance)
    if (BUILTIN_ROOT_COMMANDS.has(scope)) return []
    return normalizeCliCommands(instance.manifest?.plugin?.contributions?.cliCommands).map(command => ({
      command,
      displayName: instance.manifest?.displayName ?? instance.manifest?.name,
      packageId: instance.packageId,
      path: commandPathForContribution(scope, command),
      scope
    }))
  })
}

export const runPluginCliCommand = async (options: RunPluginCliCommandOptions) => {
  const baseUrl = resolveServerBaseUrl({ daemon: options.daemon, env: process.env })
  const payload = await buildInvocationPayload(options)
  let result = await invokePluginCommand(baseUrl, options, payload)
  if (needsSelection(result)) {
    if (options.json === true || options.interactive !== true) {
      console.log(JSON.stringify(result, null, 2))
      process.exitCode = 1
      return
    }
    const accountKey = await promptForAccountKey(result.candidates)
    result = await invokePluginCommand(baseUrl, options, {
      ...payload,
      accountKey
    })
  }
  await printCommandResult(result, options)
}

const ensureCommandPath = (
  root: Command,
  commandsByPath: Map<string, Command>,
  path: string[]
) => {
  let parent = root
  const segments: string[] = []
  for (const segment of path) {
    segments.push(segment)
    const key = segments.join(' ')
    let command = commandsByPath.get(key)
    if (command == null) {
      command = parent.command(segment)
      commandsByPath.set(key, command)
    }
    parent = command
  }
  return parent
}

interface PluginCliCommanderOptions {
  account?: string
  daemon?: string
  input?: string
  interactive?: boolean
  json?: boolean
  open?: boolean
  server?: string
  stdin?: boolean
  user?: string
}

const collectCommandOptions = (command: Command): PluginCliCommanderOptions => {
  const chain: Command[] = []
  let current: Command | null = command
  while (current != null) {
    chain.unshift(current)
    current = current.parent
  }
  return Object.assign({}, ...chain.map(item => item.opts())) as PluginCliCommanderOptions
}

export const registerPluginCliCommands = (program: Command, commands: PluginCliCommandContribution[]) => {
  const commandsByPath = new Map<string, Command>()
  const registeredCommands = new Set<string>()

  for (const contribution of commands) {
    const { command, path, scope } = contribution
    const key = `${scope}/${path.join('/')}`
    if (registeredCommands.has(key)) continue
    registeredCommands.add(key)

    const cliCommand = ensureCommandPath(program, commandsByPath, path)
    cliCommand
      .description(readCommandDescription(command))
      .argument('[args...]')
      .option('-s, --server <server>', 'Relay server alias, id, or URL. Defaults to cf for account commands.')
      .option('--account <accountKey>', 'Stable account key, usually serverId:userId')
      .option('--user <user>', 'User loginId, email, userId, or accountKey')
      .option('--daemon <url>', 'OneWorks server daemon base URL')
      .option('--input <json>', 'JSON payload merged into the plugin command payload')
      .option('--stdin', 'Read JSON payload from stdin', false)
      .option('--json', 'Print JSON output and disable interactive selection', false)
      .option('--open', 'Open loginUrl results in the system browser', false)
      .option('--no-interactive', 'Disable interactive account selection')
      .action(async (args: string[], _opts: PluginCliCommanderOptions, actionCommand: Command) => {
        const opts = collectCommandOptions(actionCommand)
        try {
          await runPluginCliCommand({
            account: opts.account,
            args,
            commandId: command.command,
            daemon: opts.daemon,
            input: opts.input,
            interactive: opts.interactive !== false && opts.json !== true && process.stdin.isTTY &&
              process.stdout.isTTY,
            json: opts.json,
            open: opts.open,
            scope,
            server: opts.server,
            stdin: opts.stdin,
            user: opts.user
          })
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error))
          process.exit(1)
        }
      })

    for (const alias of command.aliases ?? []) {
      cliCommand.alias(alias)
    }
  }
}
