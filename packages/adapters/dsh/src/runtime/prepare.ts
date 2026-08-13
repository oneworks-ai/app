/* eslint-disable max-lines -- composition, environment, filesystem, and redaction form one preparation boundary. */
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'

import type { AdapterCtx, AdapterQueryOptions } from '@oneworks/types'
import { resolveProjectOoPath, sanitizeInheritedNodeRuntimeEnv } from '@oneworks/utils'

import { buildDshComposition, normalizeDshModel, resolveDshPermissionMode } from './composition'
import { resolveDshAdapterConfig } from './config'
import { resolveDshCli } from './install'

const SYSTEM_ENV_KEYS = [
  'ALL_PROXY',
  'ComSpec',
  'FORCE_COLOR',
  'HOME',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'NO_COLOR',
  'NO_PROXY',
  'PATH',
  'PATHEXT',
  'SHELL',
  'SystemRoot',
  'TEMP',
  'TERM',
  'TMP',
  'TMPDIR',
  'USERPROFILE',
  'WINDIR',
  'all_proxy',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_DIR',
  'SSL_CERT_FILE'
] as const

const CREDENTIAL_BEARING_URL_ENV_KEYS = new Set([
  'ALL_PROXY',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'all_proxy',
  'http_proxy',
  'https_proxy'
])

const assertCredentialFreeUrl = (label: string, value: string) => {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`DSH ${label} must be a valid URL.`)
  }
  if (parsed.username !== '' || parsed.password !== '' || parsed.search !== '' || parsed.hash !== '') {
    throw new Error(`DSH ${label} cannot contain credentials, query parameters, or a fragment.`)
  }
  return value
}

const buildChildEnv = (ctx: AdapterCtx, params: {
  agentsHome: string
  dshHome: string
  permissionMode: string
  baseUrl?: string
}) => {
  const selected: NodeJS.ProcessEnv = {}
  for (const key of SYSTEM_ENV_KEYS) {
    const actualKey = process.platform === 'win32'
      ? Object.keys(ctx.env).find(candidate => candidate.toLowerCase() === key.toLowerCase()) ?? key
      : key
    const value = ctx.env[actualKey]
    if (typeof value === 'string') {
      selected[actualKey] = CREDENTIAL_BEARING_URL_ENV_KEYS.has(key)
        ? assertCredentialFreeUrl(`${key} environment value`, value)
        : value
    }
  }
  const apiKey = ctx.env.DEEPSEEK_API_KEY
  if (typeof apiKey !== 'string' || apiKey.trim() === '') {
    throw new Error('DSH requires DEEPSEEK_API_KEY in the One Works process environment.')
  }
  selected.DEEPSEEK_API_KEY = apiKey
  const baseUrl = params.baseUrl ?? (
    typeof ctx.env.DEEPSEEK_BASE_URL === 'string' ? ctx.env.DEEPSEEK_BASE_URL : undefined
  )
  selected.DEEPSEEK_BASE_URL = baseUrl == null
    ? undefined
    : assertCredentialFreeUrl('base URL', baseUrl)
  selected.DSH_HOME = params.dshHome
  selected.DSH_AGENTS_HOME = params.agentsHome
  selected.DSH_PERMISSION_MODE = params.permissionMode
  selected.HOME = params.dshHome
  selected.USERPROFILE = params.dshHome
  return sanitizeInheritedNodeRuntimeEnv(selected)
}

const replaceAllSafe = (value: string, search: string, replacement: string) => (
  search === '' ? value : value.split(search).join(replacement)
)

const assertSafePathSegment = (label: string, value: string) => {
  const windowsReservedName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu
  if (
    !/^\w[\w.-]*$/u.test(value) ||
    value.endsWith('.') ||
    windowsReservedName.test(value)
  ) {
    throw new Error(`DSH ${label} must be an opaque path segment.`)
  }
  return value
}

export interface PreparedDshRuntime {
  binaryPath: string
  configPath: string
  env: NodeJS.ProcessEnv
  model: string
  redact: (value: string) => string
  sessionRoot: string
  startupTimeoutMs: number
  usesOfficialManagedComposition: boolean
}

export const prepareDshRuntime = async (
  ctx: AdapterCtx,
  options: AdapterQueryOptions
): Promise<PreparedDshRuntime> => {
  const adapterConfig = resolveDshAdapterConfig(ctx)
  if (adapterConfig.allowUnrestrictedReadNetwork !== true) {
    throw new Error(
      'DSH rc.6 does not confine host file reads or network access. ' +
        'Set adapters.dsh.allowUnrestrictedReadNetwork=true only after accepting this boundary.'
    )
  }
  const ctxId = assertSafePathSegment('context id', ctx.ctxId)
  const sessionId = assertSafePathSegment('session id', options.sessionId)
  const sessionCacheRoot = resolveProjectOoPath(
    ctx.cwd,
    ctx.env,
    'caches',
    ctxId,
    sessionId,
    'adapter-dsh'
  )
  await mkdir(sessionCacheRoot, { recursive: true, mode: 0o700 })
  const sessionRoot = await mkdtemp(resolve(sessionCacheRoot, 'runtime-'))
  const dshHome = resolve(sessionRoot, 'home')
  const agentsHome = resolve(sessionRoot, 'agents')
  const persistenceRoot = resolve(sessionRoot, 'sessions')
  await mkdir(dshHome, { recursive: true, mode: 0o700 })
  await mkdir(agentsHome, { recursive: true, mode: 0o700 })
  await mkdir(persistenceRoot, { recursive: true, mode: 0o700 })
  const model = normalizeDshModel(options.model)
  const configPath = resolve(sessionRoot, 'cordis.yml')
  await writeFile(
    configPath,
    `${
      JSON.stringify(
        buildDshComposition({
          cwd: ctx.cwd,
          effort: options.effort,
          model,
          permissionMode: options.permissionMode,
          persistenceRoot,
          systemPrompt: options.systemPrompt
        }),
        null,
        2
      )
    }\n`,
    { mode: 0o600 }
  )
  const env = buildChildEnv(ctx, {
    agentsHome,
    baseUrl: adapterConfig.baseUrl,
    dshHome,
    permissionMode: resolveDshPermissionMode(options.permissionMode)
  })
  const canonicalSessionRoot = await realpath(sessionRoot)
  const secrets = [
    { replacement: '<DSH_SESSION_ROOT>', value: sessionRoot },
    { replacement: '<DSH_SESSION_ROOT>', value: canonicalSessionRoot },
    { replacement: '<redacted>', value: env.DEEPSEEK_API_KEY },
    { replacement: '<redacted>', value: env.DEEPSEEK_BASE_URL }
  ]
    .filter((entry): entry is { replacement: string; value: string } => (
      typeof entry.value === 'string' && entry.value !== ''
    ))
    .sort((left, right) => right.value.length - left.value.length)
  const redact = (value: string) =>
    secrets.reduce(
      (current, secret) => replaceAllSafe(current, secret.value, secret.replacement),
      value
    )
  const resolvedCli = await resolveDshCli(ctx)
  return {
    binaryPath: resolvedCli.binaryPath,
    configPath,
    env,
    model,
    redact,
    sessionRoot,
    startupTimeoutMs: adapterConfig.startupTimeoutMs ?? 30_000,
    usesOfficialManagedComposition: resolvedCli.provenance === 'managed-official'
  }
}
