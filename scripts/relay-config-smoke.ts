import { existsSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import process from 'node:process'

import {
  RELAY_CONFIG_SMOKE_MODEL,
  RELAY_CONFIG_SMOKE_SERVICE_KEY,
  createWorkspaceFixture
} from './relay-config-smoke-fixture'

export {
  RELAY_CONFIG_SMOKE_MODEL,
  RELAY_CONFIG_SMOKE_SERVICE_KEY,
  RELAY_CONFIG_SNAPSHOT_RELATIVE_PATH
} from './relay-config-smoke-fixture'

type ConfigApi = Pick<typeof import('../packages/config/src/index'), 'loadConfigState' | 'resetConfigCache'>
type RelayConfigSmokeState = Awaited<ReturnType<ConfigApi['loadConfigState']>>
type ModelServiceConfig = NonNullable<RelayConfigSmokeState['mergedConfig']['modelServices']>[string]

export interface RelayConfigSmokeOptions {
  allowPending?: boolean
  json?: boolean
  keepTemp?: boolean
  repoRoot?: string
}

export interface RelayConfigSmokeResult {
  cachePath: string
  ok: boolean
  pending: string[]
  projectHome: string
  service?: ModelServiceConfig
  tempRoot: string
  workspaceDir: string
}

const loadConfigApi = async (workspaceDir: string): Promise<ConfigApi> => {
  const workspaceRequire = createRequire(joinWorkspaceConfig(workspaceDir))
  const entryPath = workspaceRequire.resolve('@oneworks/config')
  return workspaceRequire(entryPath) as ConfigApi
}

const joinWorkspaceConfig = (workspaceDir: string) => resolve(workspaceDir, '.oo.config.json')

const relayConfigHookExists = (repoRoot: string) => {
  const relayPackageJsonPath = resolve(repoRoot, 'packages/plugins/relay/package.json')
  const packageJson = JSON.parse(
    existsSync(relayPackageJsonPath)
      ? readFileSync(relayPackageJsonPath, 'utf8')
      : '{}'
  ) as { exports?: Record<string, unknown> }
  return packageJson.exports?.['./config'] != null ||
    existsSync(resolve(repoRoot, 'packages/plugins/relay/config.js')) ||
    existsSync(resolve(repoRoot, 'packages/plugins/relay/config/index.js')) ||
    existsSync(resolve(repoRoot, 'packages/plugins/relay/dist/config.js'))
}

const assertSmokeResult = (result: RelayConfigSmokeResult, allowPending: boolean) => {
  if (result.ok || allowPending) return

  throw new Error([
    'Relay config smoke did not observe the managed model service.',
    ...result.pending.map(item => `- ${item}`),
    `workspace: ${result.workspaceDir}`,
    `projectHome: ${result.projectHome}`,
    `cache: ${result.cachePath}`
  ].join('\n'))
}

const printSmokeResult = (result: RelayConfigSmokeResult, json: boolean) => {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }

  if (result.ok) {
    process.stdout.write('[relay-config-smoke] ok\n')
    process.stdout.write(`[relay-config-smoke] service=${RELAY_CONFIG_SMOKE_SERVICE_KEY}\n`)
    return
  }

  process.stdout.write('[relay-config-smoke] pending\n')
  for (const item of result.pending) {
    process.stdout.write(`[relay-config-smoke] ${item}\n`)
  }
  process.stdout.write(`[relay-config-smoke] workspace=${result.workspaceDir}\n`)
  process.stdout.write(`[relay-config-smoke] projectHome=${result.projectHome}\n`)
  process.stdout.write(`[relay-config-smoke] cache=${result.cachePath}\n`)
}

const buildSmokeResult = (
  state: RelayConfigSmokeState,
  fixture: Awaited<ReturnType<typeof createWorkspaceFixture>>,
  pending: string[]
): RelayConfigSmokeResult => {
  const service = state.mergedConfig.modelServices?.[RELAY_CONFIG_SMOKE_SERVICE_KEY]
  const ok = state.mergedConfig.defaultModelService === RELAY_CONFIG_SMOKE_SERVICE_KEY &&
    service?.apiBaseUrl === 'https://relay.example.com/v1' &&
    service?.apiKey === 'relay-smoke-key' &&
    service?.models?.includes(RELAY_CONFIG_SMOKE_MODEL) === true &&
    state.mergedConfig.env?.RELAY_FORBIDDEN_ENV == null &&
    state.mergedConfig.mcpServers?.forbidden == null &&
    state.mergedConfig.plugins?.some(plugin => plugin.id === '@oneworks/plugin-forbidden') !== true &&
    state.mergedConfig.modelServices?.['relay-denied'] == null

  return {
    cachePath: fixture.cachePath,
    ok,
    pending,
    projectHome: fixture.projectHome,
    service,
    tempRoot: fixture.tempRoot,
    workspaceDir: fixture.workspaceDir
  }
}

const collectPendingSmokeChecks = (state: RelayConfigSmokeState, pending: string[]) => {
  const service = state.mergedConfig.modelServices?.[RELAY_CONFIG_SMOKE_SERVICE_KEY]
  if (state.mergedConfig.defaultModelService !== RELAY_CONFIG_SMOKE_SERVICE_KEY) {
    pending.push('mergedConfig.defaultModelService must come from the allowlisted Relay config snapshot assignment.')
  }
  if (service == null) {
    pending.push('mergedConfig.modelServices.relay-smoke must be produced by the Relay config hook.')
  }
  if (state.mergedConfig.modelServices?.['relay-denied'] != null) {
    pending.push('non-matching Relay config snapshot assignments must not affect mergedConfig.')
  }
  if (
    state.mergedConfig.env?.RELAY_FORBIDDEN_ENV != null ||
    state.mergedConfig.mcpServers?.forbidden != null ||
    state.mergedConfig.plugins?.some(plugin => plugin.id === '@oneworks/plugin-forbidden') === true
  ) {
    pending.push('forbidden remote config fields must be filtered before merge.')
  }
}

export const runRelayConfigSmoke = async (options: RelayConfigSmokeOptions = {}) => {
  const repoRoot = resolve(options.repoRoot ?? process.cwd())
  const fixture = await createWorkspaceFixture(repoRoot)
  const pending: string[] = []

  try {
    const configApi = await loadConfigApi(fixture.workspaceDir)
    if (!relayConfigHookExists(repoRoot)) {
      pending.push('@oneworks/plugin-relay must expose ./config or configHook for loadConfigState().')
    }

    configApi.resetConfigCache()
    const state = await configApi.loadConfigState({
      cwd: fixture.workspaceDir,
      env: fixture.env,
      jsonVariables: {}
    })
    collectPendingSmokeChecks(state, pending)

    const result = buildSmokeResult(state, fixture, pending)
    assertSmokeResult(result, options.allowPending === true)
    printSmokeResult(result, options.json === true)
    return result
  } finally {
    try {
      const configApi = await loadConfigApi(fixture.workspaceDir)
      configApi.resetConfigCache()
    } catch {}
    if (options.keepTemp !== true) {
      await rm(fixture.tempRoot, { force: true, recursive: true })
    }
  }
}
