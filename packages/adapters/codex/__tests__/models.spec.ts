import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadCodexBuiltinModels, loadCodexModelServiceModels } from '#~/models.js'

const tempDirs: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('codex builtin models', () => {
  it('loads visible model metadata from the Codex models cache', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'ow-codex-models-cache-'))
    tempDirs.push(codexHome)
    await writeFile(
      join(codexHome, 'models_cache.json'),
      JSON.stringify({
        models: [
          {
            slug: 'codex-auto-review',
            display_name: 'Codex Auto Review',
            description: 'Hidden internal model',
            visibility: 'hide',
            priority: 1
          },
          {
            slug: 'gpt-later',
            display_name: 'GPT Later',
            description: 'Lower priority model',
            supported_in_api: false,
            visibility: 'list',
            priority: 20
          },
          {
            slug: 'gpt-first',
            display_name: 'GPT First',
            description: 'Higher priority model',
            default_reasoning_level: 'high',
            supported_reasoning_levels: [
              { effort: 'low', description: 'Low' },
              { effort: 'high', description: 'High' },
              { effort: 'ultra', description: 'Ultra' }
            ],
            service_tiers: [
              { id: 'priority', name: 'Fast', description: 'Faster responses' }
            ],
            visibility: 'list',
            priority: 10
          }
        ]
      }),
      'utf8'
    )
    vi.stubEnv('CODEX_HOME', codexHome)

    expect(loadCodexBuiltinModels()).toEqual([
      {
        value: 'default',
        title: 'Default',
        description: 'Use the account default model and provider selection managed by Codex',
        defaultEffort: 'high',
        supportedEfforts: ['low', 'high', 'ultra'],
        serviceTiers: [{ id: 'priority', name: 'Fast', description: 'Faster responses' }]
      },
      {
        value: 'gpt-first',
        title: 'GPT First',
        description: 'Higher priority model',
        defaultEffort: 'high',
        supportedEfforts: ['low', 'high', 'ultra'],
        serviceTiers: [{ id: 'priority', name: 'Fast', description: 'Faster responses' }]
      },
      {
        value: 'gpt-later',
        title: 'GPT Later',
        description: 'Lower priority model'
      }
    ])
  })

  it('derives display metadata when cache entries omit optional fields', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'ow-codex-models-derived-'))
    tempDirs.push(codexHome)
    await writeFile(
      join(codexHome, 'models_cache.json'),
      JSON.stringify({
        models: [
          {
            slug: 'gpt-next-codex'
          }
        ]
      }),
      'utf8'
    )
    vi.stubEnv('CODEX_HOME', codexHome)

    expect(loadCodexBuiltinModels()[1]).toEqual({
      value: 'gpt-next-codex',
      title: 'Gpt Next Codex',
      description: 'Codex model gpt-next-codex'
    })
  })

  it('falls back when a cache entry has no recognized effort levels', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'ow-codex-models-empty-efforts-'))
    tempDirs.push(codexHome)
    await writeFile(
      join(codexHome, 'models_cache.json'),
      JSON.stringify({
        models: [{
          slug: 'gpt-next-codex',
          supported_reasoning_levels: [{ effort: 'unknown' }]
        }]
      }),
      'utf8'
    )
    vi.stubEnv('CODEX_HOME', codexHome)

    expect(loadCodexBuiltinModels()[1]?.supportedEfforts).toBeUndefined()
  })

  it('prefers the configured model_catalog_json file before models_cache.json', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'ow-codex-models-catalog-'))
    tempDirs.push(codexHome)
    const catalogPath = join(codexHome, 'catalog.json')
    await writeFile(
      join(codexHome, 'config.toml'),
      `model_catalog_json = ${JSON.stringify(catalogPath)}\n[projects]\n`,
      'utf8'
    )
    await writeFile(
      catalogPath,
      JSON.stringify({
        models: [{
          slug: 'catalog-model',
          display_name: 'Catalog Model',
          description: 'Configured catalog model',
          visibility: 'list'
        }]
      }),
      'utf8'
    )
    await writeFile(
      join(codexHome, 'models_cache.json'),
      JSON.stringify({
        models: [{
          slug: 'cache-model',
          display_name: 'Cache Model',
          description: 'Cached model',
          visibility: 'list'
        }]
      }),
      'utf8'
    )
    vi.stubEnv('CODEX_HOME', codexHome)

    expect(loadCodexBuiltinModels().map(model => model.value)).toEqual([
      'default',
      'catalog-model'
    ])
  })

  it('falls back to packaged model metadata when the cache is unavailable', () => {
    const codexHome = join(tmpdir(), 'ow-codex-models-missing')
    vi.stubEnv('CODEX_HOME', codexHome)

    expect(loadCodexBuiltinModels().slice(0, 3)).toEqual([
      {
        value: 'default',
        title: 'Default',
        description: 'Use the account default model and provider selection managed by Codex'
      },
      {
        value: 'gpt-5.5',
        title: 'GPT-5.5',
        description: 'Frontier model for complex coding, research, and real-world work'
      },
      {
        value: 'gpt-5.4',
        title: 'GPT-5.4',
        description: 'Flagship frontier model for professional work with industry-leading coding capabilities'
      }
    ])
    expect(loadCodexModelServiceModels()).toEqual([])
  })

  it('keeps ChatGPT-visible catalog models even when they are not API-key models', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'ow-codex-chatgpt-models-'))
    tempDirs.push(codexHome)
    await writeFile(
      join(codexHome, 'models_cache.json'),
      JSON.stringify({
        models: [{
          slug: 'gpt-subscription-only',
          display_name: 'GPT Subscription Only',
          description: 'Available to ChatGPT-backed Codex sessions',
          supported_in_api: false,
          visibility: 'list'
        }]
      }),
      'utf8'
    )
    vi.stubEnv('CODEX_HOME', codexHome)

    expect(loadCodexModelServiceModels().map(model => model.value)).toEqual(['gpt-subscription-only'])
  })

  it('reads the real-home Codex catalog when the managed process HOME is isolated', async () => {
    const realHome = await mkdtemp(join(tmpdir(), 'ow-codex-real-home-'))
    const isolatedHome = await mkdtemp(join(tmpdir(), 'ow-codex-isolated-home-'))
    tempDirs.push(realHome, isolatedHome)
    await mkdir(join(realHome, '.codex'), { recursive: true })
    await writeFile(
      join(realHome, '.codex', 'models_cache.json'),
      JSON.stringify({
        models: [{
          slug: 'gpt-real-home',
          display_name: 'GPT Real Home',
          description: 'Account-visible model',
          visibility: 'list'
        }]
      }),
      'utf8'
    )
    vi.stubEnv('HOME', isolatedHome)
    vi.stubEnv('__ONEWORKS_PROJECT_REAL_HOME__', realHome)

    expect(loadCodexModelServiceModels().map(model => model.value)).toEqual(['gpt-real-home'])
  })
})
