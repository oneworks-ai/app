/* eslint-disable max-lines */

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import {
  buildNodeScriptCommand,
  hasManagedHookPlugins,
  mergeManagedHookGroups,
  prepareManagedHookRuntime,
  readJsonFileOrDefault,
  resolveManagedHookScriptPath,
  shellQuote,
  writeJsonFile
} from '@oneworks/hooks'
import type { NativeHookMatcherGroup } from '@oneworks/hooks'
import type { AdapterCtx } from '@oneworks/types'
import { unlinkMockHomeBridgePaths } from '@oneworks/utils'

export const CODEX_NATIVE_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop'
] as const

type CodexNativeHookEvent = (typeof CODEX_NATIVE_HOOK_EVENTS)[number]

const CODEX_NATIVE_HOOK_EVENT_KEYS: Record<CodexNativeHookEvent, string> = {
  SessionStart: 'session_start',
  UserPromptSubmit: 'user_prompt_submit',
  PreToolUse: 'pre_tool_use',
  PostToolUse: 'post_tool_use',
  Stop: 'stop'
}

const CODEX_NATIVE_HOOK_EVENTS_WITH_MATCHERS = new Set<CodexNativeHookEvent>([
  'SessionStart',
  'PreToolUse',
  'PostToolUse'
])

const MANAGED_TRUST_BLOCK_START = '# BEGIN ONEWORKS MANAGED CODEX HOOK TRUST'
const MANAGED_TRUST_BLOCK_END = '# END ONEWORKS MANAGED CODEX HOOK TRUST'

const escapeRegExp = (value: string) => value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')

const MANAGED_TRUST_BLOCK_PATTERN = new RegExp(
  `${escapeRegExp(MANAGED_TRUST_BLOCK_START)}[\\s\\S]*?${escapeRegExp(MANAGED_TRUST_BLOCK_END)}\\n?`,
  'g'
)

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const MANAGED_COMMAND_PATH = resolveManagedHookScriptPath('call-hook.js')
const MANAGED_COMMAND_MARKERS = [
  MANAGED_COMMAND_PATH,
  'oneworks-call-hook',
  'codex-hook.js',
  'call-hook.js'
]

const isManagedCommand = (command: unknown): command is string => (
  typeof command === 'string' &&
  MANAGED_COMMAND_MARKERS.some(marker => command.includes(marker))
)

const isManagedGroup = (group: NativeHookMatcherGroup) => (
  Array.isArray(group.hooks) &&
  group.hooks.some(hook => isManagedCommand(hook.command))
)

const toCanonicalJson = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(toCanonicalJson)
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right))
        .map(key => [key, toCanonicalJson(value[key])])
    )
  }
  return value
}

const createCodexNativeHookHash = (
  eventName: CodexNativeHookEvent,
  group: NativeHookMatcherGroup,
  hook: NonNullable<NativeHookMatcherGroup['hooks']>[number]
) => {
  const identity: Record<string, unknown> = {
    event_name: CODEX_NATIVE_HOOK_EVENT_KEYS[eventName],
    hooks: [{
      async: Boolean((hook as { async?: unknown }).async),
      command: hook.command,
      timeout: Math.max(hook.timeout ?? 600, 1),
      type: hook.type,
      ...(hook.statusMessage == null ? {} : { statusMessage: hook.statusMessage })
    }]
  }
  if (CODEX_NATIVE_HOOK_EVENTS_WITH_MATCHERS.has(eventName) && group.matcher != null) {
    identity.matcher = group.matcher
  }

  return `sha256:${
    createHash('sha256')
      .update(JSON.stringify(toCanonicalJson(identity)))
      .digest('hex')
  }`
}

const getCodexNativeHookStateKey = (params: {
  hooksPath: string
  eventName: CodexNativeHookEvent
  groupIndex: number
  hookIndex: number
}) => `${params.hooksPath}:${CODEX_NATIVE_HOOK_EVENT_KEYS[params.eventName]}:${params.groupIndex}:${params.hookIndex}`

const getHookSourcePathFromStateKey = (stateKey: string) => {
  for (const eventKey of Object.values(CODEX_NATIVE_HOOK_EVENT_KEYS)) {
    const suffix = new RegExp(`:${escapeRegExp(eventKey)}:\\d+:\\d+$`)
    if (suffix.test(stateKey)) {
      return stateKey.replace(suffix, '')
    }
  }
  return undefined
}

const parseManagedTrustBlockSourcePaths = (content: string) => {
  const sourcePaths = new Set<string>()
  for (const blockMatch of content.matchAll(MANAGED_TRUST_BLOCK_PATTERN)) {
    const block = blockMatch[0]
    for (const line of block.split('\n')) {
      const encodedKey = /^\[hooks\.state\.(".*")\]$/.exec(line.trim())?.[1]
      if (encodedKey == null) continue
      try {
        const stateKey = JSON.parse(encodedKey) as unknown
        if (typeof stateKey !== 'string') continue
        const sourcePath = getHookSourcePathFromStateKey(stateKey)
        if (sourcePath != null) {
          sourcePaths.add(sourcePath)
        }
      } catch {
        // Ignore malformed legacy trust entries; they will be dropped with the managed block.
      }
    }
  }
  return sourcePaths
}

const collectCodexNativeHookTrustEntries = (
  hooksConfig: unknown,
  hooksPaths: Iterable<string>
) => {
  const parsedHooks = isRecord(hooksConfig) && isRecord(hooksConfig.hooks)
    ? hooksConfig.hooks
    : undefined
  const entries = new Map<string, string>()

  if (parsedHooks == null) {
    return entries
  }

  for (const eventName of CODEX_NATIVE_HOOK_EVENTS) {
    const groups = parsedHooks[eventName]
    if (!Array.isArray(groups)) continue
    for (const [groupIndex, groupValue] of groups.entries()) {
      if (!isRecord(groupValue)) continue
      const group = groupValue as NativeHookMatcherGroup
      if (!Array.isArray(group.hooks)) continue
      for (const [hookIndex, hook] of group.hooks.entries()) {
        if (hook.type !== 'command' || !isManagedCommand(hook.command)) continue
        const trustedHash = createCodexNativeHookHash(eventName, group, hook)
        for (const hooksPath of hooksPaths) {
          entries.set(
            getCodexNativeHookStateKey({
              hooksPath,
              eventName,
              groupIndex,
              hookIndex
            }),
            trustedHash
          )
        }
      }
    }
  }

  return entries
}

const removeTomlSections = (content: string, headersToRemove: ReadonlySet<string>) => {
  if (headersToRemove.size === 0) return content

  const lines = content.split('\n')
  const nextLines: string[] = []
  let skipping = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('[') && trimmed.includes(']')) {
      skipping = headersToRemove.has(trimmed)
    }
    if (!skipping) {
      nextLines.push(line)
    }
  }

  return nextLines.join('\n')
}

const buildCodexNativeHookTrustBlock = (entries: ReadonlyMap<string, string>) => {
  if (entries.size === 0) return ''

  const lines = [
    MANAGED_TRUST_BLOCK_START,
    '# This block is managed by OneWorks to satisfy Codex native hook trust checks.'
  ]

  for (const [stateKey, trustedHash] of [...entries].sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(
      '',
      `[hooks.state.${JSON.stringify(stateKey)}]`,
      `trusted_hash = ${JSON.stringify(trustedHash)}`
    )
  }

  lines.push(MANAGED_TRUST_BLOCK_END, '')
  return lines.join('\n')
}

export const upsertCodexNativeHookTrustState = (params: {
  currentContent: string
  hooksConfig: unknown
  hooksPath: string
}) => {
  const normalizedContent = params.currentContent.replaceAll('\r\n', '\n')
  const hooksPaths = parseManagedTrustBlockSourcePaths(normalizedContent)
  hooksPaths.add(params.hooksPath)

  const entries = collectCodexNativeHookTrustEntries(params.hooksConfig, hooksPaths)
  const headersToRemove = new Set(
    [...entries.keys()].map(stateKey => `[hooks.state.${JSON.stringify(stateKey)}]`)
  )
  const strippedContent = removeTomlSections(
    normalizedContent.replace(MANAGED_TRUST_BLOCK_PATTERN, '').trim(),
    headersToRemove
  ).trim()
  const managedBlock = buildCodexNativeHookTrustBlock(entries).trim()

  const nextContent = [strippedContent, managedBlock].filter(Boolean).join('\n\n')
  return nextContent === '' ? '' : `${nextContent}\n`
}

export const ensureCodexNativeHookTrustState = async (params: {
  configPath: string
  hooksPath: string
  hooksConfig?: unknown
}) => {
  const hooksConfig = params.hooksConfig ?? await readJsonFileOrDefault<unknown>(params.hooksPath, {})
  let currentContent = ''
  try {
    currentContent = await readFile(params.configPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  const nextContent = upsertCodexNativeHookTrustState({
    currentContent,
    hooksConfig,
    hooksPath: params.hooksPath
  })
  if (nextContent === currentContent) return

  await mkdir(dirname(params.configPath), { recursive: true })
  await writeFile(params.configPath, nextContent, 'utf8')
}

const createManagedGroup = (
  command: string,
  eventName: CodexNativeHookEvent
): NativeHookMatcherGroup => ({
  ...(eventName === 'PreToolUse' || eventName === 'PostToolUse'
    ? { matcher: '^Bash$' }
    : {}),
  hooks: [{
    type: 'command',
    command,
    timeout: 600,
    statusMessage: `running oneworks ${eventName} hook`
  }]
})

const withProjectHomeEnv = (command: string, mockHome: string) =>
  [
    `HOME=${shellQuote(mockHome)}`,
    `USERPROFILE=${shellQuote(mockHome)}`,
    '__ONEWORKS_DISABLE_MOCK_HOME_BRIDGE=1',
    command
  ].join(' ')

export const ensureCodexNativeHooksInstalled = async (
  ctx: Pick<AdapterCtx, 'cwd' | 'env' | 'logger' | 'assets'>
) => {
  const { env, logger, assets } = ctx

  env.__ONEWORKS_PROJECT_CODEX_NATIVE_HOOKS_AVAILABLE__ = '0'
  const enabled = hasManagedHookPlugins({ assets }) || env.__ONEWORKS_PROJECT_ENABLE_BUILTIN_PERMISSION_HOOKS__ === '1'

  try {
    const { mockHome, nodePath } = prepareManagedHookRuntime(ctx)
    const hooksPath = resolve(mockHome, '.codex', 'hooks.json')
    const projectHooksPath = resolve(ctx.cwd, '.codex', 'hooks.json')
    const existing = await readJsonFileOrDefault<unknown>(hooksPath, {})
    const projectHooks = await readJsonFileOrDefault<unknown>(projectHooksPath, {})
    const projectHooksConfig = isRecord(projectHooks) && isRecord(projectHooks.hooks)
      ? projectHooks.hooks
      : undefined
    const projectManagedEvents = new Set<CodexNativeHookEvent>(
      CODEX_NATIVE_HOOK_EVENTS.filter((eventName) => {
        const hooks = projectHooksConfig?.[eventName]
        return Array.isArray(hooks) && hooks.some(group => isManagedGroup(group as NativeHookMatcherGroup))
      })
    )
    const command = buildNodeScriptCommand({
      nodePath,
      scriptPath: MANAGED_COMMAND_PATH
    })
    const commandWithProjectHome = withProjectHomeEnv(command, mockHome)

    const merged = mergeManagedHookGroups({
      existing,
      eventNames: CODEX_NATIVE_HOOK_EVENTS,
      enabled,
      isManagedGroup,
      createGroup: (eventName: string) => createManagedGroup(commandWithProjectHome, eventName as CodexNativeHookEvent),
      shouldManageEvent: (eventName: string) => !projectManagedEvents.has(eventName as CodexNativeHookEvent)
    })
    await unlinkMockHomeBridgePaths({
      mockHome,
      paths: ['.codex/hooks.json']
    })
    await writeJsonFile(hooksPath, merged)
    await ensureCodexNativeHookTrustState({
      configPath: resolve(mockHome, '.codex', 'config.toml'),
      hooksPath,
      hooksConfig: merged
    })

    env.__ONEWORKS_PROJECT_CODEX_NATIVE_HOOKS_AVAILABLE__ = enabled ? '1' : '0'
    return enabled
  } catch (error) {
    logger.warn('[codex hooks] failed to install native hook bridge', error)
    env.__ONEWORKS_PROJECT_CODEX_NATIVE_HOOKS_AVAILABLE__ = '0'
    return false
  }
}
