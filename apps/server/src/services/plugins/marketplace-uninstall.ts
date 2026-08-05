/* eslint-disable max-lines -- plan validation and exact config/install compensation form one transaction. */

import { createHash } from 'node:crypto'
import path from 'node:path'
import process from 'node:process'

import { ConfigFileRevisionConflictError, readConfigFileRevision, updateConfigFile } from '@oneworks/config'
import type { ConfigFileRevision } from '@oneworks/config'
import {
  commitManagedPluginRemoval,
  getManagedPluginRemovalCompletion,
  recoverManagedPluginRemovals,
  restoreManagedPluginRemoval,
  stageManagedPluginRemoval,
  withManagedPluginMutationLock
} from '@oneworks/managed-plugins'
import type { ManagedPluginRemovalIdentity } from '@oneworks/managed-plugins'
import type {
  Config,
  MarketplaceConfig,
  MarketplaceConfigEntry,
  PluginConfig,
  PluginMarketplaceUninstallIdentity,
  PluginMarketplaceUninstallPlan,
  PluginMarketplaceUninstallResult,
  PluginMarketplaceUninstallUnavailableReason,
  PluginRuntimeInstance
} from '@oneworks/types'
import type { ManagedPluginInstall } from '@oneworks/utils/managed-plugin'
import { getManagedPluginConfigPath, listManagedPluginInstalls } from '@oneworks/utils/managed-plugin'
import type { ResolvedPluginInstance } from '@oneworks/utils/plugin-resolver'

import { loadConfigState } from '#~/services/config/index.js'

import { getPluginManager } from './index.js'
import { updateMarketplacePluginDeclaration } from './marketplace-selection.js'

const RETAIN_ITEMS = [
  'global-config',
  'user-config',
  'sibling-plugins',
  'managed-plugin-data',
  'user-data-and-accounts',
  'shared-package-cache'
] as const

type ConfigState = Awaited<ReturnType<typeof loadConfigState>>

interface RuntimeRecordView {
  instance: PluginRuntimeInstance
  raw: ResolvedPluginInstance
}

interface ProjectDeclaration {
  entry: MarketplaceConfigEntry
  plugin: NonNullable<MarketplaceConfigEntry['plugins']>[string]
}

interface ResolvedUninstallPlan {
  configRevision: ConfigFileRevision
  install: ManagedPluginInstall
  originalSection: {
    marketplaces?: MarketplaceConfig
    plugins?: PluginConfig
  }
  plan: Extract<PluginMarketplaceUninstallPlan, { available: true }>
  replacementSection: {
    marketplaces?: MarketplaceConfig
    plugins?: PluginConfig
  }
}

export class PluginMarketplaceUninstallStaleError extends Error {
  constructor() {
    super('The uninstall plan is stale. Request a new plan and retry.')
    this.name = 'PluginMarketplaceUninstallStaleError'
  }
}

const unavailable = (
  reason: PluginMarketplaceUninstallUnavailableReason
): PluginMarketplaceUninstallPlan => ({
  available: false,
  reason
})

const getMarketplaces = (config: Config | undefined): MarketplaceConfig => config?.marketplaces ?? {}
const getPlugins = (config: Config | undefined): PluginConfig =>
  Array.isArray(config?.plugins)
    ? config.plugins
    : []

const marketplaceTypeMatchesAdapter = (
  type: MarketplaceConfigEntry['type'],
  adapter: string
) => (
  (type === 'codex' && adapter === 'codex') ||
  (type === 'claude-code' && adapter === 'claude')
)

const getProjectDeclaration = (
  config: Config | undefined,
  install: ManagedPluginInstall
): ProjectDeclaration | undefined => {
  if (install.config.source.type !== 'marketplace') return undefined
  const entry = config?.marketplaces?.[install.config.source.marketplace]
  const plugin = entry?.plugins?.[install.config.source.plugin]
  if (
    entry == null ||
    entry.enabled === false ||
    plugin == null ||
    plugin.enabled === false ||
    !marketplaceTypeMatchesAdapter(entry.type, install.config.adapter)
  ) {
    return undefined
  }
  return { entry, plugin }
}

export const isManagedPluginProjectDeclarationPresent = (
  config: Config | undefined,
  identity: ManagedPluginRemovalIdentity
) => {
  const entry = config?.marketplaces?.[identity.marketplace]
  const plugin = entry?.plugins?.[identity.plugin]
  return entry != null &&
    entry.enabled !== false &&
    plugin != null &&
    plugin.enabled !== false &&
    marketplaceTypeMatchesAdapter(entry.type, identity.adapter)
}

const getInstallScope = (
  install: ManagedPluginInstall,
  declaration: ProjectDeclaration
) => declaration.plugin.scope ?? install.config.scope ?? install.config.name

const isSameManagedInstallPath = (left: string, right: string) => (
  path.resolve(left) === path.resolve(right)
)

const findRuntimeOverrides = (
  config: Config | undefined,
  install: ManagedPluginInstall,
  scope: string
) =>
  getPlugins(config).map((plugin, index) => ({ index, plugin })).filter(({ plugin }) => (
    isSameManagedInstallPath(plugin.id, install.oneworksPluginDir) &&
    (plugin.scope ?? scope) === scope
  ))

const findRuntimeInstallReferences = (
  config: Config | undefined,
  install: ManagedPluginInstall
) => getPlugins(config).filter(plugin => isSameManagedInstallPath(plugin.id, install.oneworksPluginDir))

const sourceReferencesInstall = (
  config: Config | undefined,
  install: ManagedPluginInstall
) => (
  getProjectDeclaration(config, install) != null ||
  findRuntimeInstallReferences(config, install).length > 0
)

const toPluginsSection = (config: Config | undefined) => ({
  ...(config?.plugins == null ? {} : { plugins: config.plugins }),
  ...(config?.marketplaces == null ? {} : { marketplaces: config.marketplaces })
})

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value == null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)])
  )
}

const digestSnapshot = (snapshot: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonicalize(snapshot)))
    .digest('hex')

const toPublicIdentity = (
  install: ManagedPluginInstall,
  scope: string
): PluginMarketplaceUninstallIdentity => {
  if (install.config.source.type !== 'marketplace') {
    throw new Error('Managed uninstall identity is not a marketplace install.')
  }
  return {
    adapter: install.config.adapter,
    marketplace: install.config.source.marketplace,
    plugin: install.config.source.plugin,
    scope
  }
}

const toRemovedResult = (
  identity: ManagedPluginRemovalIdentity,
  scope: string
): PluginMarketplaceUninstallResult => ({
  identity: {
    adapter: identity.adapter,
    marketplace: identity.marketplace,
    plugin: identity.plugin,
    scope
  },
  removed: true
})

const getRuntimeRecord = async (scope: string) => {
  const manager = getPluginManager()
  await manager.load()
  return manager.getRecord(scope) as RuntimeRecordView | undefined
}

const buildReplacementSection = (
  config: Config | undefined,
  install: ManagedPluginInstall,
  scope: string
) => {
  if (install.config.source.type !== 'marketplace') {
    throw new PluginMarketplaceUninstallStaleError()
  }
  const declaration = getProjectDeclaration(config, install)
  if (declaration == null || getInstallScope(install, declaration) !== scope) {
    throw new PluginMarketplaceUninstallStaleError()
  }
  const runtimeOverrides = findRuntimeOverrides(config, install, scope)
  if (runtimeOverrides.length > 1) throw new PluginMarketplaceUninstallStaleError()
  const marketplaces = updateMarketplacePluginDeclaration({
    enabled: false,
    marketplaceKey: install.config.source.marketplace,
    marketplaceType: declaration.entry.type,
    marketplaces: getMarketplaces(config),
    pluginName: install.config.source.plugin
  })
  const overrideIndex = runtimeOverrides[0]?.index
  const plugins = overrideIndex == null
    ? getPlugins(config)
    : getPlugins(config).filter((_, index) => index !== overrideIndex)
  return {
    ...(plugins.length > 0 || config?.plugins != null ? { plugins } : {}),
    ...(Object.keys(marketplaces).length > 0 || config?.marketplaces != null ? { marketplaces } : {})
  }
}

const buildResolvedPlan = async (
  scope: string,
  state: ConfigState
): Promise<ResolvedUninstallPlan | PluginMarketplaceUninstallPlan> => {
  const installs = await listManagedPluginInstalls(state.workspaceFolder, { env: process.env })
  const projectConfig = state.projectSource?.rawConfig
  const projectCandidates = installs.flatMap((install) => {
    const declaration = getProjectDeclaration(projectConfig, install)
    return declaration != null && getInstallScope(install, declaration) === scope
      ? [{ declaration, install }]
      : []
  })

  if (projectCandidates.length > 1) return unavailable('ambiguous-managed-install')
  const record = await getRuntimeRecord(scope)
  if (projectCandidates.length === 0) {
    if (record == null) return unavailable('plugin-not-found')
    if (record.raw.sourceType === 'package' || record.raw.packageId != null) {
      return unavailable('package-plugin')
    }
    if (record.instance.sourceGroup === 'global' || record.instance.sourceGroup === 'builtIn') {
      return unavailable('global-plugin')
    }
    if (record.instance.sourceGroup === 'localDev') return unavailable('local-plugin')
    return unavailable('not-managed-marketplace')
  }

  const { declaration, install } = projectCandidates[0]
  if (install.config.source.type !== 'marketplace') {
    return unavailable('not-managed-marketplace')
  }
  const duplicateSourceInstalls = installs.filter(candidate => (
    candidate.config.source.type === 'marketplace' &&
    candidate.config.source.marketplace === install.config.source.marketplace &&
    candidate.config.source.plugin === install.config.source.plugin
  ))
  if (duplicateSourceInstalls.length !== 1) return unavailable('ambiguous-managed-install')
  if (record == null) return unavailable('managed-install-mismatch')
  if (record.instance.sourceGroup !== 'project') {
    return unavailable(
      record.instance.sourceGroup === 'localDev'
        ? 'local-plugin'
        : record.raw.sourceType === 'package'
        ? 'package-plugin'
        : 'global-plugin'
    )
  }
  if (
    record.raw.sourceType !== 'directory' ||
    !isSameManagedInstallPath(record.raw.rootDir, install.oneworksPluginDir) ||
    !isSameManagedInstallPath(record.raw.requestId, install.oneworksPluginDir) ||
    record.raw.scope !== scope
  ) {
    return unavailable('managed-install-mismatch')
  }
  if (
    sourceReferencesInstall(state.globalSource?.resolvedConfig, install) ||
    sourceReferencesInstall(state.userSource?.resolvedConfig, install)
  ) {
    return unavailable('source-conflict')
  }

  const projectRuntimeOverrides = findRuntimeOverrides(projectConfig, install, scope)
  if (projectRuntimeOverrides.length > 1) return unavailable('managed-install-mismatch')
  if (
    findRuntimeInstallReferences(projectConfig, install).some(plugin => (
      (plugin.scope ?? scope) !== scope
    ))
  ) {
    return unavailable('source-conflict')
  }
  const identity = toPublicIdentity(install, scope)
  const projectConfigPath = state.projectSource?.configPath
  if (projectConfigPath == null) return unavailable('project-declaration-missing')
  const [configRevision, installRevision, installConfigRevision] = await Promise.all([
    readConfigFileRevision(projectConfigPath),
    readConfigFileRevision(install.installDir),
    readConfigFileRevision(getManagedPluginConfigPath(install.installDir))
  ])
  const token = digestSnapshot({
    configRevision,
    identity,
    install: {
      config: install.config,
      owner: {
        adapter: install.config.adapter,
        slug: path.basename(path.dirname(install.installDir))
      },
      revision: installRevision,
      configRevision: installConfigRevision
    },
    project: {
      declaration,
      runtimeOverride: projectRuntimeOverrides[0]?.plugin ?? null
    },
    runtime: {
      packageId: record.raw.packageId ?? null,
      requestId: record.raw.requestId,
      rootDir: record.raw.rootDir,
      scope: record.raw.scope,
      sourceGroup: record.instance.sourceGroup,
      sourceType: record.raw.sourceType
    },
    version: 1
  })
  const overrideIndex = projectRuntimeOverrides[0]?.index
  const originalSection = toPluginsSection(projectConfig)
  const replacementSection = buildReplacementSection(projectConfig, install, scope)
  return {
    configRevision,
    install,
    originalSection,
    plan: {
      available: true,
      deleteItems: [
        'project-marketplace-declaration',
        ...(overrideIndex == null ? [] : ['project-runtime-override' as const]),
        'managed-install'
      ],
      identity,
      retainItems: [...RETAIN_ITEMS],
      token
    },
    replacementSection
  }
}

const recoverPendingRemovals = async (state: ConfigState) =>
  recoverManagedPluginRemovals({
    cwd: state.workspaceFolder,
    env: process.env,
    isDeclarationPresent: async (identity) => {
      const currentState = await loadConfigState()
      return isManagedPluginProjectDeclarationPresent(currentState.projectSource?.rawConfig, identity)
    }
  })

const withCurrentWorkspaceMutation = async <T>(
  callback: (state: ConfigState) => Promise<T>
) => {
  const initialState = await loadConfigState()
  return withManagedPluginMutationLock({
    cwd: initialState.workspaceFolder,
    env: process.env
  }, async () => {
    const state = await loadConfigState()
    if (path.resolve(state.workspaceFolder) !== path.resolve(initialState.workspaceFolder)) {
      throw new PluginMarketplaceUninstallStaleError()
    }
    return callback(state)
  })
}

export const getPluginMarketplaceUninstallPlan = async (
  scope: string
): Promise<PluginMarketplaceUninstallPlan> =>
  withCurrentWorkspaceMutation(async (state) => {
    const recovered = await recoverPendingRemovals(state)
    if (recovered.length > 0) {
      await getPluginManager().reload()
    }
    const resolved = await buildResolvedPlan(scope, await loadConfigState())
    return 'plan' in resolved ? resolved.plan : resolved
  })

export const uninstallPluginMarketplacePlugin = async (params: {
  scope: string
  token: string
}): Promise<PluginMarketplaceUninstallResult> =>
  withCurrentWorkspaceMutation(async (state) => {
    const recovered = await recoverPendingRemovals(state)
    const completedRetry = recovered.find(result => (
      result.action === 'cleaned' &&
      result.operationId === params.token &&
      (result.identity.scope ?? result.identity.name) === params.scope
    ))
    if (completedRetry != null) {
      const scope = completedRetry.identity.scope ?? completedRetry.identity.name
      await getPluginManager().reload()
      return toRemovedResult(completedRetry.identity, scope)
    }

    const completion = await getManagedPluginRemovalCompletion({
      cwd: state.workspaceFolder,
      env: process.env,
      operationId: params.token
    })
    if (
      completion != null &&
      (completion.identity.scope ?? completion.identity.name) === params.scope
    ) {
      await getPluginManager().reload()
      return toRemovedResult(completion.identity, params.scope)
    }

    const resolved = await buildResolvedPlan(params.scope, await loadConfigState())
    if (!('plan' in resolved) || resolved.plan.token !== params.token) {
      throw new PluginMarketplaceUninstallStaleError()
    }

    const manager = getPluginManager()
    const removal = await stageManagedPluginRemoval({
      cwd: state.workspaceFolder,
      env: process.env,
      install: resolved.install,
      operationId: params.token
    })
    let configUpdated = false
    let updatedConfigRevision: ConfigFileRevision | undefined
    let readyForCleanup = false
    try {
      try {
        const updateResult = await updateConfigFile({
          expectedRevision: resolved.configRevision,
          resolveValue: currentConfig => buildReplacementSection(currentConfig, resolved.install, params.scope),
          workspaceFolder: state.workspaceFolder,
          source: 'project',
          section: 'plugins'
        })
        configUpdated = true
        updatedConfigRevision = await readConfigFileRevision(updateResult.configPath)
      } catch (error) {
        if (error instanceof ConfigFileRevisionConflictError) {
          throw new PluginMarketplaceUninstallStaleError()
        }
        throw error
      }
      manager.forgetRuntimeMutationState(params.scope)
      await manager.reload()
      readyForCleanup = true
      await commitManagedPluginRemoval(removal)
      return {
        identity: resolved.plan.identity,
        removed: true
      }
    } catch (error) {
      if (!configUpdated) {
        await restoreManagedPluginRemoval(removal)
        throw error
      }
      if (readyForCleanup) {
        throw error
      }
      await updateConfigFile({
        ...(updatedConfigRevision == null ? {} : { expectedRevision: updatedConfigRevision }),
        resolveValue: (currentConfig) => {
          if (digestSnapshot(toPluginsSection(currentConfig)) !== digestSnapshot(resolved.replacementSection)) {
            throw new PluginMarketplaceUninstallStaleError()
          }
          return resolved.originalSection
        },
        workspaceFolder: state.workspaceFolder,
        source: 'project',
        section: 'plugins'
      })
      await restoreManagedPluginRemoval(removal)
      manager.forgetRuntimeMutationState(params.scope)
      await manager.reload()
      throw error
    }
  })
