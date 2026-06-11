import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'

import type { Adapter } from './adapter'
import type { AdapterCliPreparer } from './adapter-cli-prepare'
import { resolveExistingAdapterPackageCacheDir } from './adapter-package-cache'
import type { AdapterBuiltinModel } from './config'
import type { AdapterPluginInstaller } from './native-plugin'

const ADAPTER_SCOPE = '@oneworks'
const ADAPTER_PREFIX = 'adapter-'
const ADAPTER_CLI_PREPARE_EXPORT = '/cli-prepare'
const ADAPTER_MODELS_EXPORT = '/models'
const ADAPTER_PLUGIN_EXPORT = '/plugins'

interface AdapterModelsExport {
  builtinModels?: unknown
  loadBuiltinModels?: unknown
}

const createWorkspaceRequire = (cwd: string) => createRequire(resolve(cwd, '__oneworks_adapter_loader__.cjs'))

const normalizeRuntimePackageDir = (value: string | undefined) => {
  const trimmed = value?.trim()
  return trimmed != null && trimmed !== '' ? trimmed : undefined
}

const unique = <T>(values: T[]) => [...new Set(values)]

const createAdapterRequires = (packageName: string) => {
  const cliPackageDir = normalizeRuntimePackageDir(process.env.__ONEWORKS_PROJECT_CLI_PACKAGE_DIR__)
  const packageDir = normalizeRuntimePackageDir(process.env.__ONEWORKS_PROJECT_PACKAGE_DIR__)
  const explicitCliPackageDir = cliPackageDir != null && cliPackageDir !== packageDir
    ? cliPackageDir
    : undefined

  return unique([
    explicitCliPackageDir,
    resolveExistingAdapterPackageCacheDir(packageName),
    packageDir,
    process.cwd()
  ].filter((value): value is string => value != null)).map(createWorkspaceRequire)
}

const isMissingRequestedModuleError = (error: unknown, request: string) => {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  const message = error instanceof Error ? error.message : String(error)
  return code === 'MODULE_NOT_FOUND' && message.includes(`Cannot find module '${request}'`)
}

const isWorkspaceDistMissingError = (error: unknown) => {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  const message = error instanceof Error ? error.message : String(error)
  return code === 'MODULE_NOT_FOUND' && message.includes('/dist/')
}

const loadWorkspacePackageExport = (params: {
  packageRequire?: NodeJS.Require
  packageName: string
  sourcePath: string
}) => {
  const packageRequire = params.packageRequire ?? require
  const packageJsonPath = packageRequire.resolve(`${params.packageName}/package.json`)
  return packageRequire(join(dirname(packageJsonPath), params.sourcePath))
}

const loadAdapterPackageExport = (params: {
  packageName: string
  request: string
  workspaceSourcePath: string
}) => {
  let missingError: unknown

  for (const packageRequire of createAdapterRequires(params.packageName)) {
    try {
      return packageRequire(params.request)
    } catch (error) {
      if (isWorkspaceDistMissingError(error)) {
        return loadWorkspacePackageExport({
          packageRequire,
          packageName: params.packageName,
          sourcePath: params.workspaceSourcePath
        })
      }
      if (isMissingRequestedModuleError(error, params.request)) {
        missingError ??= error
        continue
      }
      throw error
    }
  }

  try {
    // eslint-disable-next-line ts/no-require-imports
    return require(params.request)
  } catch (error) {
    if (isWorkspaceDistMissingError(error)) {
      return loadWorkspacePackageExport({
        packageName: params.packageName,
        sourcePath: params.workspaceSourcePath
      })
    }
    if (missingError != null && isMissingRequestedModuleError(error, params.request)) {
      throw missingError
    }
    throw error
  }
}

export const normalizeAdapterPackageId = (type: string) => {
  const trimmed = type.trim()
  if (trimmed.startsWith('@')) return trimmed

  const hasAdapterPrefix = trimmed.startsWith(ADAPTER_PREFIX)
  const adapterId = hasAdapterPrefix ? trimmed.slice(ADAPTER_PREFIX.length) : trimmed
  const normalizedAdapterId = adapterId === 'claude' ? 'claude-code' : adapterId

  return hasAdapterPrefix ? `${ADAPTER_PREFIX}${normalizedAdapterId}` : normalizedAdapterId
}

export const resolveAdapterPackageName = (type: string) => {
  const normalizedType = normalizeAdapterPackageId(type)
  if (normalizedType.startsWith('@')) return normalizedType
  return normalizedType.startsWith(ADAPTER_PREFIX)
    ? `${ADAPTER_SCOPE}/${normalizedType}`
    : `${ADAPTER_SCOPE}/${ADAPTER_PREFIX}${normalizedType}`
}

export const loadAdapter = async (type: string) => {
  const packageName = resolveAdapterPackageName(type)

  return loadAdapterPackageExport({
    packageName,
    request: packageName,
    workspaceSourcePath: 'src/index.ts'
  }).default as Adapter
}

export const loadAdapterBuiltinModels = (type: string) => {
  const packageName = resolveAdapterPackageName(type)
  const exportName = `${packageName}${ADAPTER_MODELS_EXPORT}`
  const mod = loadAdapterPackageExport({
    packageName,
    request: exportName,
    workspaceSourcePath: 'src/models.ts'
  }) as AdapterModelsExport

  if (typeof mod.loadBuiltinModels === 'function') {
    const loaded = mod.loadBuiltinModels()
    if (Array.isArray(loaded)) return loaded as AdapterBuiltinModel[]
  }
  return Array.isArray(mod.builtinModels) ? mod.builtinModels as AdapterBuiltinModel[] : undefined
}

export const loadAdapterPluginInstaller = async (type: string) => {
  const packageName = resolveAdapterPackageName(type)
  const exportName = `${packageName}${ADAPTER_PLUGIN_EXPORT}`

  try {
    return loadAdapterPackageExport({
      packageName,
      request: exportName,
      workspaceSourcePath: 'src/plugins/index.ts'
    }).default as AdapterPluginInstaller
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    const message = error instanceof Error ? error.message : String(error)
    if (
      code === 'ERR_PACKAGE_PATH_NOT_EXPORTED' ||
      (code === 'MODULE_NOT_FOUND' && message.includes(exportName))
    ) {
      throw new Error(`Adapter ${type} does not support native plugin management.`)
    }
    throw error
  }
}

export const loadAdapterCliPreparer = async (type: string) => {
  const packageName = resolveAdapterPackageName(type)
  const exportName = `${packageName}${ADAPTER_CLI_PREPARE_EXPORT}`

  try {
    return loadAdapterPackageExport({
      packageName,
      request: exportName,
      workspaceSourcePath: 'src/cli-prepare.ts'
    }).default as AdapterCliPreparer
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    const message = error instanceof Error ? error.message : String(error)
    if (
      code === 'ERR_PACKAGE_PATH_NOT_EXPORTED' ||
      (code === 'MODULE_NOT_FOUND' && message.includes(exportName))
    ) {
      throw new Error(`Adapter ${type} does not support CLI preparation.`)
    }
    throw error
  }
}
