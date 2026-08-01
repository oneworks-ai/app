import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { validateModelProviderCatalog } from '@oneworks/model-provider-catalog'
import { resolveActiveModulePackageDirSync } from '@oneworks/types'
import { installModelProviderCatalog, resetModelProviderCatalog } from '@oneworks/utils/model-providers'

export interface ActiveModelProviderCatalogInfo {
  schemaVersion: 1
  source: 'bundled' | 'managed'
  version?: string
}

const CATALOG_PACKAGE_NAME = '@oneworks/model-provider-catalog'

let activeCatalogInfo: ActiveModelProviderCatalogInfo = {
  schemaVersion: 1,
  source: 'bundled'
}

const readPackageManifest = async (packageDir: string) => {
  const parsed = JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8')) as {
    name?: unknown
    version?: unknown
  }
  if (parsed.name !== CATALOG_PACKAGE_NAME || typeof parsed.version !== 'string' || parsed.version.trim() === '') {
    throw new Error('Managed model provider catalog package manifest is invalid.')
  }
  return { version: parsed.version }
}

export const initializeModelProviderCatalog = async (
  env: NodeJS.ProcessEnv = process.env
): Promise<ActiveModelProviderCatalogInfo> => {
  resetModelProviderCatalog()
  activeCatalogInfo = { schemaVersion: 1, source: 'bundled' }

  const packageDir = resolveActiveModulePackageDirSync(CATALOG_PACKAGE_NAME, env)
  if (packageDir == null) return activeCatalogInfo

  try {
    const manifest = await readPackageManifest(packageDir)
    const moduleUrl = pathToFileURL(path.join(packageDir, 'dist', 'index.mjs')).href
    const loaded = await import(moduleUrl) as {
      MODEL_PROVIDER_CATALOG?: unknown
      default?: { MODEL_PROVIDER_CATALOG?: unknown } | unknown
    }
    const defaultExport = loaded.default != null && typeof loaded.default === 'object'
      ? loaded.default as { MODEL_PROVIDER_CATALOG?: unknown }
      : undefined
    const catalog = validateModelProviderCatalog(
      loaded.MODEL_PROVIDER_CATALOG ?? defaultExport?.MODEL_PROVIDER_CATALOG ?? loaded.default
    )
    installModelProviderCatalog(catalog)
    activeCatalogInfo = {
      schemaVersion: catalog.schemaVersion,
      source: 'managed',
      version: manifest.version
    }
  } catch {
    resetModelProviderCatalog()
  }

  return activeCatalogInfo
}

export const getActiveModelProviderCatalogInfo = () => ({ ...activeCatalogInfo })
