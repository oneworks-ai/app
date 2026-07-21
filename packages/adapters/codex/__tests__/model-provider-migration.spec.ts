/* eslint-disable max-lines -- migration coverage keeps native parsing and source-boundary scenarios together. */
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  buildCodexModelProviderMigrationPlan,
  discoverCodexModelServicesFromConfig
} from '../src/runtime/model-provider-import'
import { readCodexProjectModelProviderConfig } from '../src/runtime/model-provider-project-config-read'

const tempDirs: string[] = []
const envReference = (name: string) => ['${', name, '}'].join('')

const createWorkspace = async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'codex-provider-migration-'))
  tempDirs.push(workspace)
  return workspace
}

const writeProjectConfigFakeCodex = async (fakeCodexPath: string) => {
  await writeFile(
    fakeCodexPath,
    [
      '#!/usr/bin/env node',
      "import { readFileSync } from 'node:fs'",
      "import { join } from 'node:path'",
      "import readline from 'node:readline'",
      'const lines = readline.createInterface({ input: process.stdin })',
      'const parseIsolatedConfig = (source) => {',
      "  if (source.includes('model-only-marker')) return { model: 'closest-model' }",
      "  if (source.includes('nested-marker')) return {",
      "    model: 'nested-model',",
      "    model_providers: { shared: { base_url: 'https://nested.example.com/v1', http_headers: { Nested: 'yes' } } }",
      '  }',
      "  if (source.includes('root-marker')) return {",
      "    model: 'root-model',",
      "    model_provider: 'shared',",
      "    model_providers: { shared: { name: 'Shared', base_url: 'https://root.example.com/v1', env_key: 'SHARED_KEY', http_headers: { Root: 'yes' } } }",
      '  }',
      '  return {',
      "    model: 'project-model',",
      "    model_provider: 'project-provider',",
      '    model_providers: {',
      "      'project-provider': { name: 'Project Provider', base_url: 'https://project.example.com/v1', env_key: 'PROJECT_PROVIDER_KEY' }",
      '    }',
      '  }',
      '}',
      "lines.on('line', (line) => {",
      '  const request = JSON.parse(line)',
      "  if (request.method === 'initialize') {",
      "    process.stdout.write(JSON.stringify({ id: request.id, result: {} }) + '\\n')",
      "  } else if (request.method === 'config/read') {",
      "    const configPath = join(process.env.CODEX_HOME, 'config.toml')",
      '    const projectFolders = JSON.parse(process.env.FAKE_CODEX_PROJECT_FOLDERS ?? "[]")',
      '    const isDiscovery = request.params?.cwd != null',
      '    const layers = isDiscovery',
      '      ? projectFolders.map((dotCodexFolder) => ({',
      "        name: { type: 'project', dotCodexFolder },",
      '        config: {},',
      "        ...(process.env.FAKE_CODEX_PROJECT_DISABLED === '1' ? { disabledReason: 'untrusted' } : {})",
      '      }))',
      '      : [{',
      "        name: { type: 'user', file: configPath, profile: null },",
      '        config: parseIsolatedConfig(readFileSync(configPath, "utf8"))',
      '      }]',
      '    process.stdout.write(JSON.stringify({ id: request.id, result: { config: {}, layers } }) + "\\n")',
      '  }',
      '})',
      ''
    ].join('\n')
  )
  await chmod(fakeCodexPath, 0o755)
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('codex model provider migration', () => {
  it('maps native provider fields into a Codex-compatible model service', () => {
    const plan = buildCodexModelProviderMigrationPlan({
      model: 'gpt-5.4',
      model_provider: 'azure',
      model_providers: {
        azure: {
          name: 'Azure',
          base_url: 'https://example.openai.azure.com/openai',
          env_key: 'AZURE_OPENAI_API_KEY',
          env_key_instructions: 'Set the Azure key',
          wire_api: 'responses',
          query_params: { 'api-version': '2025-04-01-preview' },
          http_headers: { 'X.Provider.Id': 'tenant-1' },
          env_http_headers: { 'X-Project': 'AZURE_PROJECT' },
          request_max_retries: 0,
          stream_max_retries: 10,
          stream_idle_timeout_ms: 0,
          websocket_connect_timeout_ms: 0,
          requires_openai_auth: false,
          supports_websockets: true
        },
        proxy: {
          name: 'Command proxy',
          base_url: 'https://proxy.example.com/v1',
          auth: {
            command: '/usr/local/bin/fetch-token',
            args: ['--audience', 'codex'],
            timeout_ms: 5_000,
            refresh_interval_ms: 0
          }
        }
      }
    })

    expect(plan).toMatchObject({
      defaultModel: 'azure,gpt-5.4',
      selectedProviderId: 'azure',
      selectedServiceKey: 'azure',
      skippedProviderIds: [],
      modelServices: {
        azure: {
          title: 'Azure',
          provider: 'azure',
          apiBaseUrl: 'https://example.openai.azure.com/openai',
          apiKey: envReference('AZURE_OPENAI_API_KEY'),
          models: ['gpt-5.4'],
          supportedAdapters: ['codex'],
          extra: {
            codex: {
              nativeProvider: true,
              providerId: 'azure',
              envKey: 'AZURE_OPENAI_API_KEY',
              envKeyInstructions: 'Set the Azure key',
              wireApi: 'responses',
              queryParams: { 'api-version': '2025-04-01-preview' },
              headers: { 'X.Provider.Id': 'tenant-1' },
              envHeaders: { 'X-Project': 'AZURE_PROJECT' },
              requestMaxRetries: 0,
              streamIdleTimeoutMs: 0,
              streamMaxRetries: 10,
              websocketConnectTimeoutMs: 0,
              requiresOpenAIAuth: false,
              supportsWebsockets: true
            }
          }
        },
        proxy: {
          extra: {
            codex: {
              auth: {
                command: '/usr/local/bin/fetch-token',
                args: ['--audience', 'codex'],
                timeout_ms: 5_000,
                refresh_interval_ms: 0
              }
            }
          }
        }
      }
    })
  })

  it('maps openai_base_url onto the built-in OpenAI provider path', () => {
    const plan = buildCodexModelProviderMigrationPlan({
      model: 'gpt-5.4',
      openai_base_url: 'https://us.api.openai.com/v1'
    })

    expect(plan.defaultModel).toBe('openai,gpt-5.4')
    expect(plan.modelServices.openai).toMatchObject({
      provider: 'openai',
      apiBaseUrl: 'https://us.api.openai.com/v1',
      models: ['gpt-5.4'],
      extra: {
        codex: {
          nativeProvider: true,
          providerId: 'openai',
          useOpenAIBaseUrl: true
        }
      }
    })
  })

  it('maps a selected built-in provider without inventing a custom provider definition', () => {
    const plan = buildCodexModelProviderMigrationPlan({
      model_provider: 'ollama'
    })

    expect(plan).toMatchObject({
      selectedProviderId: 'ollama',
      selectedServiceKey: 'ollama',
      modelServices: {
        ollama: {
          title: 'Ollama',
          provider: 'ollama',
          extra: {
            codex: {
              nativeProvider: true,
              providerId: 'ollama',
              useBuiltinProvider: true
            }
          }
        }
      }
    })
    expect(plan.defaultModel).toBeUndefined()
  })

  it('reads and merges enabled project provider layers with the closest layer winning', async () => {
    const workspace = await createWorkspace()
    const nestedWorkspace = join(workspace, 'packages', 'demo')
    const realHome = join(workspace, 'real-home')
    const codexHome = join(realHome, '.codex')
    const rootCodexFolder = join(workspace, '.codex')
    const nestedCodexFolder = join(nestedWorkspace, '.codex')
    const fakeCodexPath = join(workspace, 'fake-project-codex.mjs')
    await Promise.all([
      mkdir(codexHome, { recursive: true }),
      mkdir(rootCodexFolder, { recursive: true }),
      mkdir(nestedCodexFolder, { recursive: true })
    ])
    await Promise.all([
      writeFile(join(codexHome, 'config.toml'), 'model = "user-model"\n'),
      writeFile(
        join(rootCodexFolder, 'config.toml'),
        'model_provider = "shared"\n[model_providers.shared]\nname = "root-marker"\n'
      ),
      writeFile(
        join(nestedCodexFolder, 'config.toml'),
        '[model_providers.shared]\nname = "nested-marker"\n'
      ),
      writeProjectConfigFakeCodex(fakeCodexPath)
    ])

    const nativeConfig = await readCodexProjectModelProviderConfig({
      cwd: nestedWorkspace,
      env: {
        CODEX_HOME: codexHome,
        FAKE_CODEX_PROJECT_FOLDERS: JSON.stringify([nestedCodexFolder, rootCodexFolder]),
        __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: fakeCodexPath,
        __ONEWORKS_PROJECT_REAL_HOME__: realHome,
        __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: workspace
      }
    })

    expect(nativeConfig).toEqual({
      model: 'nested-model',
      model_provider: 'shared',
      model_providers: {
        shared: {
          name: 'Shared',
          base_url: 'https://nested.example.com/v1',
          env_key: 'SHARED_KEY',
          http_headers: { Root: 'yes', Nested: 'yes' }
        }
      }
    })
  })

  it('applies a closer model-only project layer when importing an ancestor provider', async () => {
    const workspace = await createWorkspace()
    const nestedWorkspace = join(workspace, 'packages', 'demo')
    const realHome = join(workspace, 'real-home')
    const codexHome = join(realHome, '.codex')
    const rootCodexFolder = join(workspace, '.codex')
    const nestedCodexFolder = join(nestedWorkspace, '.codex')
    const fakeCodexPath = join(workspace, 'fake-project-codex.mjs')
    await Promise.all([
      mkdir(codexHome, { recursive: true }),
      mkdir(rootCodexFolder, { recursive: true }),
      mkdir(nestedCodexFolder, { recursive: true })
    ])
    await Promise.all([
      writeFile(join(codexHome, 'config.toml'), 'model = "user-model"\n'),
      writeFile(
        join(rootCodexFolder, 'config.toml'),
        'model_provider = "shared"\n[model_providers.shared]\nname = "root-marker"\n'
      ),
      writeFile(join(nestedCodexFolder, 'config.toml'), 'model = "model-only-marker"\n'),
      writeProjectConfigFakeCodex(fakeCodexPath)
    ])

    const nativeConfig = await readCodexProjectModelProviderConfig({
      cwd: nestedWorkspace,
      env: {
        CODEX_HOME: codexHome,
        FAKE_CODEX_PROJECT_FOLDERS: JSON.stringify([nestedCodexFolder, rootCodexFolder]),
        __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: fakeCodexPath,
        __ONEWORKS_PROJECT_REAL_HOME__: realHome,
        __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: workspace
      }
    })

    expect(nativeConfig).toMatchObject({
      model: 'closest-model',
      model_provider: 'shared',
      model_providers: {
        shared: {
          base_url: 'https://root.example.com/v1'
        }
      }
    })
  })

  it('does not import a project config whose .codex directory resolves outside the workspace', async () => {
    const workspace = await createWorkspace()
    const externalWorkspace = await createWorkspace()
    const externalCodexFolder = join(externalWorkspace, '.codex')
    const realHome = join(workspace, 'real-home')
    await Promise.all([
      mkdir(externalCodexFolder, { recursive: true }),
      mkdir(join(realHome, '.codex'), { recursive: true })
    ])
    await writeFile(
      join(externalCodexFolder, 'config.toml'),
      'model_provider = "leaked"\n[model_providers.leaked]\nexperimental_bearer_token = "secret"\n'
    )
    await symlink(externalCodexFolder, join(workspace, '.codex'), 'dir')

    await expect(readCodexProjectModelProviderConfig({
      cwd: workspace,
      env: {
        CODEX_HOME: join(realHome, '.codex'),
        __ONEWORKS_PROJECT_REAL_HOME__: realHome,
        __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: workspace
      }
    })).resolves.toBeUndefined()
  })

  it('does not import provider config from an untrusted project layer', async () => {
    const workspace = await createWorkspace()
    const realHome = join(workspace, 'real-home')
    const codexHome = join(realHome, '.codex')
    const projectCodexFolder = join(workspace, '.codex')
    const fakeCodexPath = join(workspace, 'fake-untrusted-project-codex.mjs')
    await Promise.all([
      mkdir(codexHome, { recursive: true }),
      mkdir(projectCodexFolder, { recursive: true })
    ])
    await Promise.all([
      writeFile(join(codexHome, 'config.toml'), 'model = "user-model"\n'),
      writeFile(
        join(projectCodexFolder, 'config.toml'),
        'model_provider = "project-provider"\n[model_providers.project-provider]\nname = "Project"\n'
      ),
      writeProjectConfigFakeCodex(fakeCodexPath)
    ])

    await expect(readCodexProjectModelProviderConfig({
      cwd: workspace,
      env: {
        CODEX_HOME: codexHome,
        FAKE_CODEX_PROJECT_DISABLED: '1',
        FAKE_CODEX_PROJECT_FOLDERS: JSON.stringify([projectCodexFolder]),
        __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: fakeCodexPath,
        __ONEWORKS_PROJECT_REAL_HOME__: realHome
      }
    })).resolves.toBeUndefined()
  })

  it('discovers quoted project provider keys without writing One Works config', async () => {
    const workspace = await createWorkspace()
    const realHome = join(workspace, 'real-home')
    const codexHome = join(realHome, '.codex')
    const projectCodexFolder = join(workspace, '.codex')
    const fakeCodexPath = join(workspace, 'fake-project-codex.mjs')
    await Promise.all([
      mkdir(codexHome, { recursive: true }),
      mkdir(projectCodexFolder, { recursive: true })
    ])
    await Promise.all([
      writeFile(join(codexHome, 'config.toml'), 'model = "user-model"\n'),
      writeFile(
        join(projectCodexFolder, 'config.toml'),
        'model = "project-model"\n"model_provider" = "project-provider"\n["model_providers".project-provider]\nname = "Project Provider"\n'
      ),
      writeProjectConfigFakeCodex(fakeCodexPath)
    ])
    const result = await discoverCodexModelServicesFromConfig({
      cwd: workspace,
      env: {
        CODEX_HOME: codexHome,
        FAKE_CODEX_PROJECT_FOLDERS: JSON.stringify([projectCodexFolder]),
        __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: fakeCodexPath,
        __ONEWORKS_PROJECT_REAL_HOME__: realHome
      },
      source: 'project'
    })
    expect(result).toMatchObject({
      found: true,
      skippedProviderIds: [],
      modelServices: {
        'project-provider': {
          apiBaseUrl: 'https://project.example.com/v1',
          apiKey: envReference('PROJECT_PROVIDER_KEY')
        }
      }
    })
    await expect(readFile(join(workspace, '.oo.config.json'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(readFile(join(realHome, '.oneworks', '.oo.config.json'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('reads quoted user provider keys through Codex app-server without including managed layers', async () => {
    const workspace = await createWorkspace()
    const realHome = join(workspace, 'real-home')
    const codexHome = join(realHome, '.codex')
    const fakeCodexPath = join(workspace, 'fake-codex.mjs')
    await mkdir(codexHome, { recursive: true })
    await writeFile(
      join(codexHome, 'config.toml'),
      [
        'model = "gpt-5.4"',
        '"model_provider" = "proxy"',
        '',
        '["model_providers".proxy]',
        'name = "Proxy"',
        'base_url = "https://proxy.example.com/v1"',
        'env_key = "PROXY_API_KEY"',
        ''
      ].join('\n')
    )
    await writeFile(
      fakeCodexPath,
      [
        '#!/usr/bin/env node',
        "import { readFileSync } from 'node:fs'",
        "import { join } from 'node:path'",
        "import readline from 'node:readline'",
        'const lines = readline.createInterface({ input: process.stdin })',
        "lines.on('line', (line) => {",
        '  const request = JSON.parse(line)',
        "  if (request.method === 'initialize') {",
        "    process.stdout.write(JSON.stringify({ id: request.id, result: {} }) + '\\n')",
        "  } else if (request.method === 'config/read') {",
        "    const configPath = join(process.env.CODEX_HOME, 'config.toml')",
        '    const userConfig = {',
        "      model: 'gpt-5.4',",
        "      model_provider: 'proxy',",
        '      model_providers: {',
        "        proxy: { name: 'Proxy', base_url: 'https://proxy.example.com/v1', env_key: 'PROXY_API_KEY' }",
        '      }',
        '    }',
        '    const managedConfig = {',
        "      model_provider: 'managed',",
        '      model_providers: {',
        "        managed: { name: 'Managed', base_url: 'https://managed.example.com/v1', experimental_bearer_token: 'managed-secret' }",
        '      }',
        '    }',
        '    process.stdout.write(JSON.stringify({ id: request.id, result: {',
        '      config: { ...userConfig, ...managedConfig },',
        '      layers: [',
        "        { name: { type: 'user', file: configPath }, config: userConfig },",
        "        { name: { type: 'system' }, config: managedConfig }",
        '      ]',
        "    } }) + '\\n')",
        "  } else if (request.method === 'thread/start') {",
        "    const config = readFileSync(join(process.env.CODEX_HOME, 'config.toml'), 'utf8')",
        '    if (!config.includes(\'model_provider=\\"proxy\\"\')) {',
        "      process.stdout.write(JSON.stringify({ id: request.id, error: { code: -32000, message: 'missing provider' } }) + '\\n')",
        '      return',
        '    }',
        "    process.stdout.write(JSON.stringify({ id: request.id, result: { thread: { id: 'thread-1' } } }) + '\\n')",
        "  } else if (request.method === 'turn/start') {",
        "    process.stdout.write(JSON.stringify({ id: request.id, result: { turn: { id: 'turn-1' } } }) + '\\n')",
        '  }',
        '})',
        ''
      ].join('\n')
    )
    await chmod(fakeCodexPath, 0o755)

    const result = await discoverCodexModelServicesFromConfig({
      cwd: workspace,
      env: {
        CODEX_HOME: codexHome,
        __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: fakeCodexPath,
        __ONEWORKS_PROJECT_REAL_HOME__: realHome
      },
      source: 'global'
    })
    expect(result).toMatchObject({
      found: true,
      skippedProviderIds: [],
      modelServices: {
        proxy: {
          apiBaseUrl: 'https://proxy.example.com/v1',
          apiKey: envReference('PROXY_API_KEY')
        }
      }
    })
    expect(JSON.stringify(result)).not.toContain('managed-secret')
    expect(result.modelServices.managed).toBeUndefined()
    await expect(readFile(join(realHome, '.oneworks', '.oo.config.json'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })
})
