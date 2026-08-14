/* eslint-disable max-lines -- isolation staging and the strict CLI allowlist share one prepare boundary. */
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

import type { AdapterCtx, AdapterQueryOptions } from '@oneworks/types'
import {
  mergeProcessEnvWithProjectEnv,
  omitAdapterCommonConfig,
  resolveProjectOoPath,
  syncSymlinkTarget
} from '@oneworks/utils'

import type { ClineAdapterConfig } from '../config-schema'
import { resolveClineBinaryPath, resolveClineCliSource } from '../paths'
import { omitClineSensitiveEnv, resolveClineSelectedCredentialEnv } from './credentials'

export interface ClinePreparedSession {
  args: string[]
  authMethod?: string
  authTimeoutMs?: number
  binaryPath: string
  configDir: string
  credentialMode: 'cline-api-key' | 'native-provider' | 'none'
  cwd: string
  dataDir: string
  hooksDir: string
  source: 'managed' | 'path' | 'system'
  spawnEnv: Record<string, string>
}

const asRecord = (value: unknown): Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
)

const deepMerge = (base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> => {
  const result = { ...base }
  for (const [key, value] of Object.entries(override)) {
    result[key] = value != null && typeof value === 'object' && !Array.isArray(value) &&
        result[key] != null && typeof result[key] === 'object' && !Array.isArray(result[key])
      ? deepMerge(asRecord(result[key]), asRecord(value))
      : value
  }
  return result
}

export const resolveClineAdapterConfig = (
  ctx: Pick<AdapterCtx, 'configState' | 'configs'>
): ClineAdapterConfig => {
  const merged = ctx.configState?.mergedConfig.adapters?.cline
  if (merged != null) return omitAdapterCommonConfig(merged as Record<string, unknown>) as ClineAdapterConfig
  const project = asRecord(ctx.configs[0]?.adapters?.cline)
  const user = asRecord(ctx.configs[1]?.adapters?.cline)
  return omitAdapterCommonConfig(deepMerge(project, user)) as ClineAdapterConfig
}

const toProcessEnv = (env: Record<string, string | null | undefined>) =>
  Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  )

const safeOverlayName = (targetPath: string) => {
  const name = basename(targetPath).trim()
  if (name === '' || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    throw new Error(`Unsafe Cline skill overlay target: ${targetPath}`)
  }
  return name
}

const stageSkills = async (options: AdapterQueryOptions, configDir: string) => {
  const skillsDir = resolve(configDir, 'skills')
  await rm(skillsDir, { recursive: true, force: true })
  const overlays = options.assetPlan?.overlays.filter(item => item.kind === 'skill') ?? []
  for (const overlay of overlays) {
    await syncSymlinkTarget({
      sourcePath: overlay.sourcePath,
      targetPath: resolve(skillsDir, safeOverlayName(overlay.targetPath)),
      type: 'dir'
    })
  }
}

const stageSystemRule = async (options: AdapterQueryOptions, configDir: string) => {
  const rulePath = resolve(configDir, 'rules', 'oneworks-system.md')
  const systemPrompt = options.systemPrompt?.trim()
  if (!systemPrompt) {
    await rm(rulePath, { force: true })
    return
  }
  await mkdir(dirname(rulePath), { recursive: true })
  await writeFile(
    rulePath,
    `---\ndescription: One Works session instructions\nalwaysApply: true\n---\n\n${systemPrompt}\n`,
    { encoding: 'utf8', mode: 0o600 }
  )
}

const THINKING_LEVELS = new Set(['none', 'low', 'medium', 'high', 'xhigh'])
const COMPACTION_MODES = new Set(['agentic', 'basic', 'off'])

const invalidExtraOption = (option: string) => {
  throw new Error(`Cline adapter does not allow extra option "${option}".`)
}

const readRequiredValue = (options: string[], index: number, flag: string) => {
  const value = options[index + 1]
  if (value == null || value.startsWith('-')) invalidExtraOption(flag)
  return value
}

/**
 * Only behavior-neutral diagnostics/tuning flags verified in Cline 3.0.54 are accepted.
 * Everything else is adapter-owned or rejected, including unknown future flags.
 */
export const validateClineExtraOptions = (options: string[] | undefined) => {
  const input = options ?? []
  for (let index = 0; index < input.length; index += 1) {
    const option = input[index]!
    if (option === '--' || !option.startsWith('-')) invalidExtraOption(option)
    if (option === '--verbose' || option === '-v') continue
    if (option.startsWith('-') && !option.startsWith('--') && option.length > 2) {
      invalidExtraOption(option)
    }

    const equalsIndex = option.indexOf('=')
    const flag = equalsIndex < 0 ? option : option.slice(0, equalsIndex)
    const inlineValue = equalsIndex < 0 ? undefined : option.slice(equalsIndex + 1)
    if (flag === '--thinking') {
      const nextValue = inlineValue ?? (
        input[index + 1] != null && !input[index + 1]!.startsWith('-') ? input[++index] : undefined
      )
      if (nextValue != null && !THINKING_LEVELS.has(nextValue)) invalidExtraOption(option)
      continue
    }
    if (flag === '--retries') {
      const nextValue = inlineValue ?? (
        input[index + 1] != null && !input[index + 1]!.startsWith('-') ? input[++index] : undefined
      )
      if (nextValue != null && !/^\d+$/u.test(nextValue)) invalidExtraOption(option)
      continue
    }
    if (flag === '--compaction') {
      const value = inlineValue ?? readRequiredValue(input, index, flag)
      if (inlineValue == null) index += 1
      if (!COMPACTION_MODES.has(value)) invalidExtraOption(option)
      continue
    }
    if (flag === '--timeout' || flag === '-t') {
      const value = inlineValue ?? readRequiredValue(input, index, flag)
      if (inlineValue == null) index += 1
      if (!/^\d+(?:\.\d+)?$/u.test(value)) invalidExtraOption(option)
      continue
    }
    invalidExtraOption(option)
  }
}

const validateClineModel = (model: string | undefined) => {
  if (model == null || model.trim() === '' || model.trim() === 'default') return
  throw new Error(
    `Cline only supports its native Default model until verified provider routing is available; received "${model}".`
  )
}

const resolveClineProvider = (provider: string | undefined) => {
  const value = provider?.trim()
  if (value == null || value === '') return undefined
  const containsControl = [...value].some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })
  if (value.startsWith('-') || value.length > 128 || /\s/u.test(value) || containsControl) {
    throw new Error(`Unsafe Cline provider id "${provider}".`)
  }
  return value
}

const resolveClineAuthMethod = (methodId: string | undefined) => {
  const value = methodId?.trim()
  if (value == null || value === '') return undefined
  if (value.length > 128 || value.startsWith('_') || !/^\w[\w.-]*$/u.test(value)) {
    throw new Error(`Unsafe Cline ACP authentication method id "${methodId}".`)
  }
  return value
}

export const prepareClineSession = async (
  ctx: AdapterCtx,
  options: AdapterQueryOptions
): Promise<ClinePreparedSession> => {
  const adapterConfig = resolveClineAdapterConfig(ctx)
  const source = resolveClineCliSource(ctx.env, adapterConfig.cli)
  validateClineModel(options.model)
  validateClineExtraOptions(options.extraOptions)
  const provider = resolveClineProvider(adapterConfig.provider)
  const authMethod = resolveClineAuthMethod(adapterConfig.authMethod)
  const rawMergedEnv = mergeProcessEnvWithProjectEnv(ctx.env, { workspaceFolder: ctx.cwd })
  const selectedCredential = resolveClineSelectedCredentialEnv({
    credentialEnv: adapterConfig.credentialEnv,
    env: rawMergedEnv,
    provider
  })
  if (authMethod != null && selectedCredential.mode === 'cline-api-key') {
    throw new Error('Cline authMethod cannot be combined with a selected API-key credential.')
  }
  const sessionRoot = resolveProjectOoPath(
    ctx.cwd,
    ctx.env,
    'caches',
    ctx.ctxId,
    options.sessionId,
    'adapter-cline'
  )
  const sessionHome = resolve(sessionRoot, 'home')
  const configDir = resolve(sessionRoot, 'config')
  const hooksDir = resolve(sessionRoot, 'hooks')
  // The native store is project-scoped so a Cline id can be loaded by a later One Works process.
  const dataDir = resolveProjectOoPath(ctx.cwd, ctx.env, 'caches', 'adapter-cline', 'native-data')
  await Promise.all([
    mkdir(sessionHome, { recursive: true, mode: 0o700 }),
    mkdir(configDir, { recursive: true, mode: 0o700 }),
    mkdir(hooksDir, { recursive: true, mode: 0o700 }),
    mkdir(resolve(dataDir, 'db'), { recursive: true, mode: 0o700 }),
    mkdir(resolve(dataDir, 'sessions'), { recursive: true, mode: 0o700 }),
    mkdir(resolve(dataDir, 'settings'), { recursive: true, mode: 0o700 })
  ])
  await stageSkills(options, configDir)
  await stageSystemRule(options, configDir)

  // Start from a scrubbed ambient environment. Only explicitly selected provider
  // credentials are added back to this process; values are never written to config.
  const mergedEnv = omitClineSensitiveEnv(rawMergedEnv)
  const spawnEnv = toProcessEnv({
    ...mergedEnv,
    HOME: sessionHome,
    USERPROFILE: sessionHome,
    XDG_CONFIG_HOME: resolve(sessionHome, '.config'),
    XDG_DATA_HOME: resolve(sessionHome, '.local', 'share'),
    CLINE_DIR: configDir,
    CLINE_DATA_DIR: dataDir,
    CLINE_DB_DATA_DIR: resolve(dataDir, 'db'),
    CLINE_SESSION_DATA_DIR: resolve(dataDir, 'sessions'),
    CLINE_TEAM_DATA_DIR: resolve(dataDir, 'teams'),
    CLINE_GLOBAL_SETTINGS_PATH: resolve(dataDir, 'settings', 'global-settings.json'),
    CLINE_MCP_SETTINGS_PATH: resolve(dataDir, 'settings', 'cline_mcp_settings.json'),
    CLINE_HOOKS_LOG_PATH: resolve(dataDir, 'logs', 'hooks.jsonl'),
    CLINE_TELEMETRY_DISABLED: adapterConfig.telemetry === 'inherit' ? undefined : '1',
    CLINE_DISABLE_CLINE_PASS_NOTICE: '1',
    CLINE_NO_AUTO_UPDATE: '1',
    NO_UPDATE_NOTIFIER: '1',
    ...selectedCredential.childEnv
  })
  return {
    args: [
      '--acp',
      '--config',
      configDir,
      '--data-dir',
      dataDir,
      '--hooks-dir',
      hooksDir,
      '--auto-approve',
      'false',
      ...(options.permissionMode === 'plan' ? ['--plan'] : []),
      ...(provider == null ? [] : ['--provider', provider]),
      ...(options.extraOptions ?? [])
    ],
    ...(authMethod == null ? {} : { authMethod }),
    ...(adapterConfig.authTimeoutMs == null ? {} : { authTimeoutMs: adapterConfig.authTimeoutMs }),
    binaryPath: resolveClineBinaryPath(ctx.env, ctx.cwd, adapterConfig.cli),
    configDir,
    credentialMode: selectedCredential.mode,
    cwd: ctx.cwd,
    dataDir,
    hooksDir,
    source,
    spawnEnv
  }
}
