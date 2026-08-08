/* eslint-disable max-lines -- channel loader keeps package resolution and entry loading together */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { cwd as processCwd, env as processEnv } from 'node:process'

import type { ChannelCreateFn, ChannelDescriptor, ResolveChannelSessionMcpServersFn } from '@oneworks/core/channel'

const nodeRequire = createRequire(__filename)
const channelPackageNamesCache = new Map<string, string[]>()
const externalChannelPackageCache = new Map<string, string | null>()

const getWorkspaceFolder = () => processEnv.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ ?? processCwd()
const createWorkspaceRequire = () => createRequire(resolve(getWorkspaceFolder(), '__oneworks_channel_loader__.cjs'))

const isChannelPackageName = (name: string) => (
  name.startsWith('@oneworks/channel-') ||
  /^@[^/]+\/channel-/.test(name)
)

const collectWorkspaceChannelPackageNames = (workspaceFolder: string) => {
  const cached = channelPackageNamesCache.get(workspaceFolder)
  if (cached != null) {
    return cached
  }

  const packageNames = new Set<string>()
  const packageJsonPath = resolve(workspaceFolder, 'package.json')
  if (existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
        optionalDependencies?: Record<string, string>
        peerDependencies?: Record<string, string>
      }
      for (
        const packageName of [
          ...Object.keys(packageJson.dependencies ?? {}),
          ...Object.keys(packageJson.devDependencies ?? {}),
          ...Object.keys(packageJson.optionalDependencies ?? {}),
          ...Object.keys(packageJson.peerDependencies ?? {})
        ]
      ) {
        if (isChannelPackageName(packageName)) {
          packageNames.add(packageName)
        }
      }
    } catch {}
  }

  const workspaceChannelsRoot = resolve(workspaceFolder, 'packages/channels')
  if (existsSync(workspaceChannelsRoot)) {
    try {
      for (const entry of readdirSync(workspaceChannelsRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const localPackageJsonPath = resolve(workspaceChannelsRoot, entry.name, 'package.json')
        if (!existsSync(localPackageJsonPath)) continue
        try {
          const localPackageJson = JSON.parse(readFileSync(localPackageJsonPath, 'utf8')) as {
            name?: string
          }
          if (typeof localPackageJson.name === 'string' && isChannelPackageName(localPackageJson.name)) {
            packageNames.add(localPackageJson.name)
          }
        } catch {}
      }
    } catch {}
  }

  const resolved = Array.from(packageNames)
  channelPackageNamesCache.set(workspaceFolder, resolved)
  return resolved
}

const isMissingModuleForSpecifier = (error: unknown, specifier: string) => {
  if (!(error instanceof Error) || !('code' in error)) {
    return false
  }

  return error.code === 'MODULE_NOT_FOUND' && error.message.includes(specifier)
}

const isModuleNotFound = (error: unknown) => (
  error instanceof Error &&
  'code' in error &&
  (error.code === 'MODULE_NOT_FOUND' || error.code === 'ERR_MODULE_NOT_FOUND')
)

const requireWithWorkspaceFallback = <T>(specifier: string, workspaceRequire: NodeJS.Require): T => {
  try {
    return workspaceRequire(specifier) as T
  } catch (error) {
    if (!isMissingModuleForSpecifier(error, specifier)) {
      throw error
    }
  }

  return nodeRequire(specifier) as T
}

const resolveExternalChannelPackageName = (type: string, workspaceRequire: NodeJS.Require) => {
  const workspaceFolder = getWorkspaceFolder()
  const cacheKey = `${workspaceFolder}\n${type}`
  if (externalChannelPackageCache.has(cacheKey)) {
    return externalChannelPackageCache.get(cacheKey) ?? undefined
  }

  for (const packageName of collectWorkspaceChannelPackageNames(workspaceFolder)) {
    if (packageName.startsWith('@oneworks/channel-')) {
      continue
    }

    try {
      const mainMod = requireWithWorkspaceFallback<{
        channelDefinition?: ChannelDescriptor
      }>(packageName, workspaceRequire)
      if (mainMod.channelDefinition?.type === type) {
        externalChannelPackageCache.set(cacheKey, packageName)
        return packageName
      }
    } catch {}
  }

  externalChannelPackageCache.set(cacheKey, null)
  return undefined
}

const loadChannelModuleByPackageName = (
  packageName: string,
  workspaceRequire: NodeJS.Require
): LoadedChannel => {
  const connSpecifier = `${packageName}/connection`
  const mcpSpecifier = `${packageName}/mcp`

  const mainMod = requireWithWorkspaceFallback<{
    channelDefinition?: ChannelDescriptor
  }>(packageName, workspaceRequire)
  const definition = mainMod.channelDefinition
  if (definition == null) {
    throw new TypeError(`${packageName} must export channelDefinition`)
  }

  const connMod = requireWithWorkspaceFallback<{
    createChannelConnection?: ChannelCreateFn
  }>(connSpecifier, workspaceRequire)
  const create = connMod.createChannelConnection
  if (typeof create !== 'function') {
    throw new TypeError(`${connSpecifier} must export createChannelConnection`)
  }

  let resolveSessionMcpServers: ResolveChannelSessionMcpServersFn | undefined
  try {
    const mcpMod = requireWithWorkspaceFallback<{
      resolveChannelSessionMcpServers?: ResolveChannelSessionMcpServersFn
    }>(mcpSpecifier, workspaceRequire)
    if (typeof mcpMod.resolveChannelSessionMcpServers === 'function') {
      resolveSessionMcpServers = mcpMod.resolveChannelSessionMcpServers
    }
  } catch (error) {
    if (!isOptionalMcpModuleMissing(error, mcpSpecifier)) {
      throw error
    }
  }

  return { create, definition, resolveSessionMcpServers }
}

const findLocalFirstPartyChannelPackageRoot = (packageName: string) => {
  if (!packageName.startsWith('@oneworks/channel-')) {
    return undefined
  }

  const workspaceChannelsRoot = resolve(getWorkspaceFolder(), 'packages/channels')
  if (!existsSync(workspaceChannelsRoot)) {
    return undefined
  }

  try {
    for (const entry of readdirSync(workspaceChannelsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const packageRoot = resolve(workspaceChannelsRoot, entry.name)
      const packageJsonPath = resolve(packageRoot, 'package.json')
      if (!existsSync(packageJsonPath)) continue
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { name?: string }
      if (packageJson.name === packageName) {
        return packageRoot
      }
    }
  } catch {}

  return undefined
}

const loadLocalSourceChannelModule = (
  packageName: string,
  packageRoot: string
): LoadedChannel => {
  const packageRequire = createRequire(resolve(packageRoot, 'package.json'))
  const sourceIndexPath = resolve(packageRoot, 'src/index.ts')
  const sourceConnectionPath = resolve(packageRoot, 'src/connection.ts')
  const sourceMcpPath = resolve(packageRoot, 'src/mcp/index.ts')

  if (!existsSync(sourceIndexPath) || !existsSync(sourceConnectionPath)) {
    throw new TypeError(`${packageName} local source must contain src/index.ts and src/connection.ts`)
  }

  const mainMod = packageRequire(sourceIndexPath) as {
    channelDefinition?: ChannelDescriptor
  }
  const definition = mainMod.channelDefinition
  if (definition == null) {
    throw new TypeError(`${sourceIndexPath} must export channelDefinition`)
  }

  const connMod = packageRequire(sourceConnectionPath) as {
    createChannelConnection?: ChannelCreateFn
  }
  const create = connMod.createChannelConnection
  if (typeof create !== 'function') {
    throw new TypeError(`${sourceConnectionPath} must export createChannelConnection`)
  }

  let resolveSessionMcpServers: ResolveChannelSessionMcpServersFn | undefined
  if (existsSync(sourceMcpPath)) {
    const mcpMod = packageRequire(sourceMcpPath) as {
      resolveChannelSessionMcpServers?: ResolveChannelSessionMcpServersFn
    }
    if (typeof mcpMod.resolveChannelSessionMcpServers === 'function') {
      resolveSessionMcpServers = mcpMod.resolveChannelSessionMcpServers
    }
  }

  return { create, definition, resolveSessionMcpServers }
}

const loadFirstPartyChannelModule = (
  packageName: string,
  workspaceRequire: NodeJS.Require
) => {
  try {
    return loadChannelModuleByPackageName(packageName, workspaceRequire)
  } catch (error) {
    const packageRoot = findLocalFirstPartyChannelPackageRoot(packageName)
    if (packageRoot == null || !isModuleNotFound(error)) {
      throw error
    }
    return loadLocalSourceChannelModule(packageName, packageRoot)
  }
}

export interface LoadedChannel {
  create: ChannelCreateFn
  definition: ChannelDescriptor
  resolveSessionMcpServers?: ResolveChannelSessionMcpServersFn
}

const isOptionalMcpModuleMissing = (error: unknown, specifier: string) => {
  if (!(error instanceof Error) || !('code' in error)) {
    return false
  }

  if (error.code === 'MODULE_NOT_FOUND') {
    return error.message.includes(specifier)
  }

  return (
    error.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED' &&
    specifier.endsWith('/mcp') &&
    error.message.includes("Package subpath './mcp'") &&
    error.message.includes('"exports"')
  )
}

export const loadChannelModule = (type: string): LoadedChannel => {
  const workspaceRequire = createWorkspaceRequire()
  const packageName = type.startsWith('@')
    ? type
    : `@oneworks/channel-${type}`

  try {
    return packageName.startsWith('@oneworks/channel-')
      ? loadFirstPartyChannelModule(packageName, workspaceRequire)
      : loadChannelModuleByPackageName(packageName, workspaceRequire)
  } catch (error) {
    if (type.startsWith('@') || !isMissingModuleForSpecifier(error, packageName)) {
      throw error
    }

    const externalPackageName = resolveExternalChannelPackageName(type, workspaceRequire)
    if (externalPackageName == null) {
      throw error
    }

    return loadChannelModuleByPackageName(externalPackageName, workspaceRequire)
  }
}
