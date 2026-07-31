import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  getActiveModelProviderCatalogInfo,
  initializeModelProviderCatalog
} from '#~/services/model-providers/catalog-loader.js'
import { getModelProviderDefinition } from '@oneworks/utils/model-providers'

const tempDirs: string[] = []

const createManagedCatalog = async (catalogSource: string) => {
  const realHome = await mkdtemp(path.join(os.tmpdir(), 'oneworks-catalog-loader-'))
  tempDirs.push(realHome)
  const packageDir = path.join(realHome, 'catalog-package')
  await mkdir(path.join(packageDir, 'dist'), { recursive: true })
  await writeFile(
    path.join(packageDir, 'package.json'),
    JSON.stringify({
      name: '@oneworks/model-provider-catalog',
      version: '9.9.9'
    }),
    'utf8'
  )
  await writeFile(path.join(packageDir, 'dist', 'index.mjs'), catalogSource, 'utf8')
  const metadataDir = path.join(realHome, '.oneworks', 'bootstrap', 'module-updates')
  await mkdir(metadataDir, { recursive: true })
  await writeFile(
    path.join(metadataDir, 'oneworks__model-provider-catalog.json'),
    JSON.stringify({
      packageDir,
      packageName: '@oneworks/model-provider-catalog',
      version: '9.9.9'
    }),
    'utf8'
  )
  return { __ONEWORKS_PROJECT_REAL_HOME__: realHome }
}

afterEach(async () => {
  await initializeModelProviderCatalog({})
  await Promise.all(tempDirs.splice(0).map(tempDir => rm(tempDir, { force: true, recursive: true })))
})

describe('model provider catalog loader', () => {
  it('activates a compatible managed catalog package', async () => {
    const env = await createManagedCatalog(`
      export const MODEL_PROVIDER_CATALOG = {
        schemaVersion: 1,
        providers: [{ id: 'managed-provider', title: 'Managed', category: 'official' }],
        hostMatchers: [{ provider: 'managed-provider', hosts: ['managed.example.com'] }]
      }
    `)

    await expect(initializeModelProviderCatalog(env)).resolves.toEqual({
      schemaVersion: 1,
      source: 'managed',
      version: '9.9.9'
    })
    expect(getActiveModelProviderCatalogInfo().source).toBe('managed')
    expect(getModelProviderDefinition('managed-provider')?.title).toBe('Managed')
  })

  it('falls back to the bundled catalog when the managed schema is incompatible', async () => {
    const env = await createManagedCatalog(`
      export const MODEL_PROVIDER_CATALOG = { schemaVersion: 2, providers: [], hostMatchers: [] }
    `)

    await expect(initializeModelProviderCatalog(env)).resolves.toEqual({
      schemaVersion: 1,
      source: 'bundled'
    })
    expect(getModelProviderDefinition('deepseek')?.title).toBe('DeepSeek')
  })
})
