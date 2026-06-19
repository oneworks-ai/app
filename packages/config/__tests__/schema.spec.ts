/* eslint-disable max-lines -- schema fixture coverage stays in one place */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  composeBaseConfigSchemaBundle,
  composeWorkspaceConfigSchemaBundle,
  validateConfigSection,
  writeWorkspaceConfigSchemaFile
} from '#~/schema.js'

const testRequire = createRequire(import.meta.url)
const zodPath = testRequire.resolve('zod')
const zodUrl = pathToFileURL(zodPath).href

const writePackage = async (
  workspaceDir: string,
  packageName: string,
  files: Record<string, string>,
  exportsMap: Record<string, unknown>
) => {
  const packageDir = path.join(workspaceDir, 'node_modules', ...packageName.split('/'))
  await mkdir(packageDir, { recursive: true })
  await writeFile(
    path.join(packageDir, 'package.json'),
    JSON.stringify(
      {
        name: packageName,
        private: true,
        version: '1.0.0',
        exports: exportsMap
      },
      null,
      2
    )
  )

  await Promise.all(
    Object.entries(files).map(async ([fileName, content]) => {
      const filePath = path.join(packageDir, fileName)
      await mkdir(path.dirname(filePath), { recursive: true })
      await writeFile(filePath, content)
    })
  )
}

describe('config schema bundle', () => {
  it('pins config-schema consumers to a core package that exports the subpath', async () => {
    const readPackageJson = async (relativePath: string) => (
      JSON.parse(await readFile(path.resolve(process.cwd(), relativePath), 'utf8')) as {
        dependencies?: Record<string, string>
        exports?: Record<string, unknown>
        version?: string
      }
    )
    const corePackage = await readPackageJson('packages/core/package.json')
    const configPackage = await readPackageJson('packages/config/package.json')
    const expectedCoreRange = 'workspace:*'
    const expectedConfigRange = 'workspace:*'

    expect(corePackage.exports).toHaveProperty('./config-schema')
    expect(configPackage.dependencies?.['@oneworks/core']).toBe(expectedCoreRange)

    for (
      const relativePath of [
        'packages/adapters/claude-code/package.json',
        'packages/adapters/codex/package.json',
        'packages/adapters/copilot/package.json',
        'packages/adapters/gemini/package.json',
        'packages/adapters/kimi/package.json',
        'packages/adapters/opencode/package.json'
      ]
    ) {
      const packageJson = await readPackageJson(relativePath)
      expect(packageJson.dependencies?.['@oneworks/core']).toBe(expectedCoreRange)
    }

    for (
      const relativePath of [
        'apps/cli/package.json',
        'apps/server/package.json',
        'packages/adapters/claude-code/package.json',
        'packages/adapters/codex/package.json',
        'packages/adapters/opencode/package.json',
        'packages/hooks/package.json',
        'packages/task/package.json',
        'packages/workspace-assets/package.json'
      ]
    ) {
      const packageJson = await readPackageJson(relativePath)
      expect(packageJson.dependencies?.['@oneworks/config']).toBe(expectedConfigRange)
    }
  })

  it('keeps the base schema adapter slot generic', () => {
    const bundle = composeBaseConfigSchemaBundle()
    const adapters = (bundle.jsonSchema.properties as Record<string, unknown>).adapters as Record<string, unknown>

    expect(bundle.extensions.adapters).toEqual([])
    expect(adapters).toMatchObject({
      type: 'object',
      properties: {}
    })
    expect((adapters.additionalProperties as Record<string, unknown>).properties).toMatchObject({
      packageId: { type: 'string' },
      defaultModel: { type: 'string' },
      includeModels: { type: 'array' },
      excludeModels: { type: 'array' }
    })
  })

  it('exposes and validates message link settings', async () => {
    const bundle = composeBaseConfigSchemaBundle()
    const properties = bundle.jsonSchema.properties as Record<string, unknown>
    expect(properties.disableGlobalConfig).toMatchObject({
      type: 'boolean'
    })

    const messageLinks = (bundle.jsonSchema.properties as Record<string, unknown>).messageLinks as Record<
      string,
      unknown
    >
    const messageLinkProperties = messageLinks.properties as Record<string, unknown>

    expect(messageLinkProperties.externalLinkTarget).toMatchObject({
      enum: ['newTab', 'currentTab']
    })
    expect(messageLinkProperties.workspaceFileTarget).toMatchObject({
      enum: ['fileTab', 'externalIde', 'defaultLink']
    })
    expect(messageLinkProperties.workspaceFileOpener).toMatchObject({
      enum: ['auto', 'vscode', 'cursor', 'windsurf', 'zed', 'intellij', 'webstorm', 'pycharm', 'goland', 'textedit']
    })
    expect(messageLinkProperties.imageLinkMode).toMatchObject({
      enum: ['inlinePreview', 'link']
    })
    expect(messageLinkProperties.plainWorkspacePathMode).toMatchObject({
      enum: ['link', 'text']
    })

    const parsed = await validateConfigSection('general', {
      disableGlobalConfig: true,
      messageLinks: {
        externalLinkTarget: 'currentTab',
        workspaceFileTarget: 'externalIde',
        workspaceFileOpener: 'vscode',
        imageLinkMode: 'link',
        plainWorkspacePathMode: 'text'
      }
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.disableGlobalConfig).toBe(true)
      expect(parsed.data.messageLinks).toEqual({
        externalLinkTarget: 'currentTab',
        workspaceFileTarget: 'externalIde',
        workspaceFileOpener: 'vscode',
        imageLinkMode: 'link',
        plainWorkspacePathMode: 'text'
      })
    }
  })

  it('validates server public endpoint and extra public path settings', async () => {
    const bundle = composeBaseConfigSchemaBundle()
    const server = (bundle.jsonSchema.properties as Record<string, unknown>).server as Record<string, unknown>
    const properties = server.properties as Record<string, unknown>
    const publicEndpoint = properties.public as Record<string, unknown>

    expect((publicEndpoint.properties as Record<string, unknown>).schema).toMatchObject({
      enum: ['http', 'https']
    })
    expect(properties.publicPaths).toMatchObject({
      type: 'array'
    })

    const parsed = await validateConfigSection('server', {
      public: {
        schema: 'https',
        domain: 'bot.example.com',
        port: 443
      },
      publicPaths: ['/status/*']
    })

    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data).toEqual({
        public: {
          schema: 'https',
          domain: 'bot.example.com',
          port: 443
        },
        publicPaths: ['/status/*']
      })
    }
  })

  it('validates voice speech-to-text services', async () => {
    const bundle = composeBaseConfigSchemaBundle()
    const voice = (bundle.jsonSchema.properties as Record<string, unknown>).voice as Record<string, unknown>
    const speechToText = (voice.properties as Record<string, unknown>).speechToText as Record<string, unknown>
    const speechToTextProperties = speechToText.properties as Record<string, unknown>

    expect(speechToTextProperties.defaultServiceId).toMatchObject({
      type: 'string'
    })
    expect(speechToTextProperties.services).toMatchObject({
      type: 'object'
    })

    const parsed = await validateConfigSection('voice', {
      speechToText: {
        defaultServiceId: 'local-asr',
        services: {
          openai: {
            provider: 'openai-transcriptions',
            model: 'gpt-4o-mini-transcribe',
            apiKeyEnv: 'OPENAI_API_KEY'
          },
          'local-asr': {
            provider: 'custom-http',
            request: {
              url: 'http://127.0.0.1:7000/transcribe',
              headers: {
                Authorization: 'Bearer $' + '{env:LOCAL_ASR_TOKEN}'
              },
              body: {
                kind: 'json',
                audioBase64Field: 'audio'
              }
            },
            response: {
              textPath: 'data.text'
            }
          }
        }
      }
    })

    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.speechToText?.defaultServiceId).toBe('local-asr')
      expect(parsed.data.speechToText?.services?.openai.provider).toBe('openai-transcriptions')
    }

    const invalid = await validateConfigSection('voice', {
      speechToText: {
        services: {
          broken: {
            provider: 'custom-http'
          }
        }
      }
    })
    expect(invalid.success).toBe(false)
  })

  it('validates appearance primary color settings', async () => {
    const bundle = composeBaseConfigSchemaBundle()
    const appearance = (bundle.jsonSchema.properties as Record<string, unknown>).appearance as Record<string, unknown>
    const properties = appearance.properties as Record<string, unknown>

    expect(properties.primaryColor).toMatchObject({
      enum: ['#E23F12', '#3F7E8F', '#00B454', '#8B9493']
    })
    expect(properties.themeMode).toMatchObject({
      enum: ['system', 'light', 'dark']
    })
    expect(properties.iconBackground).toBeUndefined()

    const parsed = await validateConfigSection('appearance', {
      primaryColor: '#3F7E8F',
      themeMode: 'dark'
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data).toEqual({
        primaryColor: '#3F7E8F',
        themeMode: 'dark'
      })
    }

    const legacyMetal = await validateConfigSection('appearance', {
      primaryColor: '#8B9493'
    })
    expect(legacyMetal.success).toBe(true)

    const legacyIconBackground = await validateConfigSection('appearance', {
      iconBackground: 'solid',
      primaryColor: '#00B454'
    })
    expect(legacyIconBackground.success).toBe(true)
    if (legacyIconBackground.success) {
      expect(legacyIconBackground.data).toEqual({
        primaryColor: '#00B454'
      })
    }

    const invalid = await validateConfigSection('appearance', {
      primaryColor: '#14B8A6'
    })
    expect(invalid.success).toBe(false)

    const invalidThemeMode = await validateConfigSection('appearance', {
      themeMode: 'auto'
    })
    expect(invalidThemeMode.success).toBe(false)
  })

  it('validates global desktop settings', async () => {
    const bundle = composeBaseConfigSchemaBundle()
    const desktop = (bundle.jsonSchema.properties as Record<string, unknown>).desktop as Record<string, unknown>
    const properties = desktop.properties as Record<string, unknown>

    expect(properties.iconAppearance).toMatchObject({
      enum: ['system', 'light', 'dark']
    })
    expect(properties.iconBackground).toMatchObject({
      enum: ['transparent', 'solid', 'textured']
    })
    expect(properties.iconTheme).toMatchObject({
      enum: ['industrial', 'metal', 'matrix']
    })
    expect(properties.openLastWorkspaceOnStartup).toMatchObject({
      type: 'boolean'
    })
    expect(properties.autoUpdate).toMatchObject({
      type: 'boolean'
    })
    expect(properties.updateChannel).toMatchObject({
      enum: ['stable', 'rc', 'beta', 'alpha']
    })

    const parsed = await validateConfigSection('desktop', {
      launcherShortcut: 'option+space',
      openLastWorkspaceOnStartup: true,
      syncAppIcon: true,
      iconAppearance: 'system',
      iconBackground: 'solid',
      iconTheme: 'metal',
      autoUpdate: false,
      updateChannel: 'beta'
    })
    expect(parsed.success).toBe(true)
  })

  it('exposes the Agent Room experiment as disabled by default', async () => {
    const bundle = composeBaseConfigSchemaBundle()
    const experiments = (bundle.jsonSchema.properties as Record<string, unknown>).experiments as Record<string, unknown>
    const properties = experiments.properties as Record<string, unknown>

    expect(properties.agentRoom).toMatchObject({
      type: 'boolean'
    })
    expect(properties.automation).toMatchObject({
      type: 'boolean'
    })
    expect(properties.benchmark).toMatchObject({
      type: 'boolean'
    })
    expect(properties.sessionTimeline).toMatchObject({
      type: 'boolean'
    })

    const emptySection = await validateConfigSection('experiments', {})
    expect(emptySection.success).toBe(true)
    if (emptySection.success) {
      expect(emptySection.data).toEqual({
        agentRoom: false,
        automation: false,
        benchmark: false,
        sessionTimeline: false
      })
    }

    const enabledSection = await validateConfigSection('experiments', {
      agentRoom: true,
      automation: true,
      benchmark: true,
      sessionTimeline: true
    })
    expect(enabledSection.success).toBe(true)
  })

  it('validates conversation worktree startup settings', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-schema-'))

    try {
      const parsed = await validateConfigSection('conversation', {
        createSessionWorktree: true,
        worktreeEnvironment: 'default.local',
        runCommands: [
          {
            id: 'dev',
            name: 'Dev',
            icon: 'terminal',
            script: 'pnpm dev',
            cwd: 'apps/client',
            env: [
              {
                key: 'NODE_ENV',
                value: 'development'
              }
            ],
            isFavorite: true
          }
        ]
      }, { cwd: tempDir })

      expect(parsed.success).toBe(true)
      if (parsed.success) {
        expect(parsed.data).toEqual({
          createSessionWorktree: true,
          worktreeEnvironment: 'default.local',
          runCommands: [
            {
              id: 'dev',
              name: 'Dev',
              icon: 'terminal',
              script: 'pnpm dev',
              cwd: 'apps/client',
              env: [
                {
                  key: 'NODE_ENV',
                  value: 'development'
                }
              ],
              isFavorite: true
            }
          ]
        })
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('composes workspace adapter and channel contributions from installed packages', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-schema-'))

    try {
      await writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify(
          {
            name: 'schema-test-workspace',
            private: true,
            dependencies: {
              '@oneworks/adapter-codex': 'workspace:*',
              '@oneworks/channel-lark': 'workspace:*'
            }
          },
          null,
          2
        )
      )

      const bundle = await composeWorkspaceConfigSchemaBundle({ cwd: tempDir })
      const adapters = (bundle.jsonSchema.properties as Record<string, unknown>).adapters as Record<string, unknown>
      const adapterProperties = adapters.properties as Record<string, unknown>
      const codexSchema = adapterProperties.codex as Record<string, unknown>
      const channels = (bundle.uiSchema.sections.channels.recordMap.schemas.lark?.fields ?? [])
        .map(field => field.path.join('.'))

      expect(bundle.extensions.adapters).toContain('codex')
      expect(bundle.extensions.channels).toContain('lark')
      expect(codexSchema.properties).toMatchObject({
        model: { type: 'string' },
        sandboxPolicy: { type: 'object' },
        experimentalApi: { type: 'boolean' },
        effort: { type: 'string' }
      })
      expect(channels).toContain('appId')
      expect(channels).toContain('appSecret')
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('validates known adapter fields while keeping unknown adapters permissive', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-schema-'))

    try {
      await writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify(
          {
            name: 'schema-test-workspace',
            private: true,
            dependencies: {
              '@oneworks/adapter-codex': 'workspace:*'
            }
          },
          null,
          2
        )
      )

      const knownValid = await validateConfigSection('adapters', {
        codex: {
          sandboxPolicy: {
            type: 'workspaceWrite'
          }
        }
      }, { cwd: tempDir })

      const knownInvalid = await validateConfigSection('adapters', {
        codex: {
          sandboxPolicy: {
            type: 'not-a-real-mode'
          }
        }
      }, { cwd: tempDir })

      const unknownAdapter = await validateConfigSection('adapters', {
        'custom-adapter': {
          defaultModel: 'gpt-5.4',
          customFlag: true
        }
      }, { cwd: tempDir })

      const knownWithUnknownKey = await validateConfigSection('adapters', {
        codex: {
          sandboxPolicy: {
            type: 'workspaceWrite'
          },
          customFlag: true
        }
      }, { cwd: tempDir })

      expect(knownValid.success).toBe(true)
      expect(knownInvalid.success).toBe(false)
      expect(knownWithUnknownKey.success).toBe(false)
      expect(unknownAdapter.success).toBe(true)
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('uses a configured adapter packageId path as the schema source for that adapter instance', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-schema-'))

    try {
      await writeFile(
        path.join(tempDir, '.oo.config.json'),
        JSON.stringify(
          {
            adapters: {
              fast: {
                packageId: './node_modules/@oneworks/adapter-codex'
              }
            }
          },
          null,
          2
        )
      )
      await writePackage(tempDir, '@oneworks/adapter-codex', {
        'config-schema.js': `
const { z } = require(${JSON.stringify(zodPath)})

module.exports.adapterConfigContribution = {
  adapterKey: 'codex',
  title: 'Codex',
  schema: z.object({
    localOnlyFlag: z.boolean().optional().describe('Local-only flag')
  })
}
`
      }, {
        './config-schema': './config-schema.js'
      })

      const bundle = await composeWorkspaceConfigSchemaBundle({ cwd: tempDir })
      const adapters = (bundle.jsonSchema.properties as Record<string, unknown>).adapters as Record<string, unknown>
      const adapterProperties = adapters.properties as Record<string, unknown>
      const fastSchema = adapterProperties.fast as Record<string, unknown>
      const knownValid = await validateConfigSection('adapters', {
        fast: {
          packageId: './node_modules/@oneworks/adapter-codex',
          localOnlyFlag: true
        }
      }, { cwd: tempDir })
      const knownWithUnknownKey = await validateConfigSection('adapters', {
        fast: {
          packageId: './node_modules/@oneworks/adapter-codex',
          customFlag: true
        }
      }, { cwd: tempDir })

      expect(bundle.extensions.adapters).toContain('fast')
      expect(fastSchema.properties).toMatchObject({
        packageId: { type: 'string' },
        localOnlyFlag: { type: 'boolean' }
      })
      expect(knownValid.success).toBe(true)
      expect(knownWithUnknownKey.success).toBe(false)
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('preserves the legacy model alias for known adapters', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-schema-'))

    try {
      await writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify(
          {
            name: 'schema-test-workspace',
            private: true,
            dependencies: {
              '@oneworks/adapter-codex': 'workspace:*'
            }
          },
          null,
          2
        )
      )

      const parsed = await validateConfigSection('adapters', {
        codex: {
          model: 'gpt-5.4'
        }
      }, { cwd: tempDir })

      expect(parsed.success).toBe(true)
      if (parsed.success) {
        expect(parsed.data).toEqual({
          codex: {
            model: 'gpt-5.4'
          }
        })
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('treats configured built-in adapter aliases as known schema entries', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-schema-'))

    try {
      await writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify(
          {
            name: 'schema-test-workspace',
            private: true,
            dependencies: {
              '@oneworks/adapter-claude-code': 'workspace:*'
            }
          },
          null,
          2
        )
      )
      await writeFile(
        path.join(tempDir, '.oo.config.json'),
        JSON.stringify(
          {
            adapters: {
              claude: {
                effort: 'medium'
              }
            }
          },
          null,
          2
        )
      )

      const bundle = await composeWorkspaceConfigSchemaBundle({ cwd: tempDir })
      const adapterFields = bundle.uiSchema.sections.adapters.recordMap.schemas.claude?.fields ?? []
      const entryKinds = bundle.uiSchema.sections.adapters.recordMap.entryKinds ?? []
      const parsed = await validateConfigSection('adapters', {
        claude: {
          customFlag: true
        }
      }, { cwd: tempDir })

      expect(bundle.extensions.adapters).toContain('claude-code')
      expect(adapterFields.map(field => field.path.join('.'))).toContain('effort')
      expect(entryKinds.map(entry => entry.key)).toContain('claude-code')
      expect(entryKinds.map(entry => entry.key)).not.toContain('claude')
      expect(parsed.success).toBe(false)
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('rejects malformed known channels while keeping unknown channel types permissive', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-schema-'))

    try {
      await writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify(
          {
            name: 'schema-test-workspace',
            private: true,
            dependencies: {
              '@oneworks/channel-lark': 'workspace:*'
            }
          },
          null,
          2
        )
      )

      const knownInvalid = await validateConfigSection('channels', {
        teamChat: {
          type: 'lark'
        }
      }, { cwd: tempDir })

      const unknownChannel = await validateConfigSection('channels', {
        customChannel: {
          type: 'custom-channel',
          customFlag: true
        }
      }, { cwd: tempDir })

      const knownWithUnknownKey = await validateConfigSection('channels', {
        teamChat: {
          type: 'lark',
          appId: 'cli_123',
          appSecret: 'secret',
          customFlag: true
        }
      }, { cwd: tempDir })

      expect(knownInvalid.success).toBe(false)
      expect(knownInvalid.success ? [] : knownInvalid.error.issues.map(issue => issue.path.join('.'))).toEqual(
        expect.arrayContaining(['teamChat.appId', 'teamChat.appSecret'])
      )
      expect(knownWithUnknownKey.success).toBe(false)
      expect(knownWithUnknownKey.success ? [] : knownWithUnknownKey.error.issues.map(issue => issue.path.join('.')))
        .toContain(
          'teamChat'
        )
      expect(unknownChannel.success).toBe(true)
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('loads contributions from workspace-local node_modules packages', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-schema-'))

    try {
      await writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify(
          {
            name: 'schema-test-workspace',
            private: true,
            dependencies: {
              '@scope/adapter-external': '1.0.0',
              '@scope/channel-external': '1.0.0'
            }
          },
          null,
          2
        )
      )

      await writePackage(tempDir, '@scope/adapter-external', {
        'config-schema.js': `
const { z } = require(${JSON.stringify(zodPath)})

module.exports.adapterConfigContribution = {
  adapterKey: 'external',
  title: 'External',
  schema: z.object({
    workspaceOnlyFlag: z.boolean().optional().describe('Workspace-only flag')
  })
}
`
      }, {
        './config-schema': './config-schema.js'
      })

      await writePackage(tempDir, '@scope/channel-external', {
        'index.js': `
const { z } = require(${JSON.stringify(zodPath)})

module.exports.channelDefinition = {
  type: 'external-channel',
  label: 'External Channel',
  configSchema: z.object({
    type: z.literal('external-channel'),
    workspaceToken: z.string().min(1).describe('Workspace token')
  }),
  messageSchema: z.object({})
}
`
      }, {
        '.': './index.js'
      })

      const bundle = await composeWorkspaceConfigSchemaBundle({ cwd: tempDir })
      const adapters = (bundle.jsonSchema.properties as Record<string, unknown>).adapters as Record<string, unknown>
      const adapterProperties = adapters.properties as Record<string, unknown>
      const externalSchema = adapterProperties['@scope/adapter-external'] as Record<string, unknown>
      const channelFields = bundle.uiSchema.sections.channels.recordMap.schemas['external-channel']?.fields ?? []

      expect(bundle.extensions.adapters).toContain('@scope/adapter-external')
      expect(bundle.extensions.channels).toContain('external-channel')
      expect(externalSchema.properties).toMatchObject({
        workspaceOnlyFlag: { type: 'boolean' }
      })
      expect(channelFields.map(field => field.path.join('.'))).toContain('workspaceToken')
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('prefers adapter config-schema contributions from the bootstrap cache over workspace packages', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-schema-'))
    const previousRealHome = process.env.__ONEWORKS_PROJECT_REAL_HOME__

    try {
      const adapterPackageName = '@acme/adapter-cached-schema'
      const homeDir = path.join(tempDir, 'home')
      const cacheDir = path.join(
        homeDir,
        '.oneworks',
        'bootstrap',
        'adapter-packages',
        adapterPackageName.replace(/^@/, '').replace(/[\\/]/g, '__'),
        '1.0.0'
      )
      await writeFile(
        path.join(tempDir, '.oo.config.json'),
        JSON.stringify({
          adapters: {
            [adapterPackageName]: {}
          }
        })
      )
      await writePackage(tempDir, adapterPackageName, {
        'config-schema.js': `
const { z } = require(${JSON.stringify(zodPath)})

module.exports.adapterConfigContribution = {
  adapterKey: 'workspace-cached-schema',
  title: 'Workspace Cached Schema',
  schema: z.object({
    workspaceOnlyFlag: z.boolean().optional().describe('Workspace-only flag')
  })
}
`
      }, {
        './config-schema': './config-schema.js'
      })
      await writePackage(cacheDir, adapterPackageName, {
        'config-schema.mjs': `
import { z } from ${JSON.stringify(zodUrl)}

export const adapterConfigContribution = {
  adapterKey: 'cached-schema',
  title: 'Cached Schema',
  schema: z.object({
    cachedOnlyFlag: z.boolean().optional().describe('Cached-only flag')
  })
}
`
      }, {
        './config-schema': {
          import: './config-schema.mjs'
        }
      })

      process.env.__ONEWORKS_PROJECT_REAL_HOME__ = homeDir
      const bundle = await composeWorkspaceConfigSchemaBundle({ cwd: tempDir })
      const adapters = (bundle.jsonSchema.properties as Record<string, unknown>).adapters as Record<string, unknown>
      const adapterProperties = adapters.properties as Record<string, unknown>
      const cachedSchema = adapterProperties[adapterPackageName] as Record<string, unknown>

      expect(cachedSchema.properties).toMatchObject({
        cachedOnlyFlag: { type: 'boolean' }
      })
      expect(cachedSchema.properties).not.toHaveProperty('workspaceOnlyFlag')
    } finally {
      if (previousRealHome == null) {
        delete process.env.__ONEWORKS_PROJECT_REAL_HOME__
      } else {
        process.env.__ONEWORKS_PROJECT_REAL_HOME__ = previousRealHome
      }
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('loads contributions from workspace-local ESM packages', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-schema-'))

    try {
      await writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify(
          {
            name: 'schema-test-workspace',
            private: true,
            dependencies: {
              '@scope/adapter-esm': '1.0.0',
              '@scope/channel-esm': '1.0.0'
            }
          },
          null,
          2
        )
      )

      await writePackage(tempDir, '@scope/adapter-esm', {
        'config-schema.mjs': `
import { z } from ${JSON.stringify(zodUrl)}

export const adapterConfigContribution = {
  adapterKey: 'esm-adapter',
  title: 'ESM Adapter',
  schema: z.object({
    esmFlag: z.boolean().optional().describe('ESM-only flag')
  })
}
`
      }, {
        './config-schema': {
          import: './config-schema.mjs'
        }
      })

      await writePackage(tempDir, '@scope/channel-esm', {
        'index.mjs': `
import { z } from ${JSON.stringify(zodUrl)}

export const channelDefinition = {
  type: 'esm-channel',
  label: 'ESM Channel',
  configSchema: z.object({
    type: z.literal('esm-channel'),
    channelToken: z.string().min(1).describe('Channel token')
  }),
  messageSchema: z.object({})
}
`
      }, {
        '.': {
          import: './index.mjs'
        }
      })

      const bundle = await composeWorkspaceConfigSchemaBundle({ cwd: tempDir })
      const adapters = (bundle.jsonSchema.properties as Record<string, unknown>).adapters as Record<string, unknown>
      const adapterProperties = adapters.properties as Record<string, unknown>
      const externalSchema = adapterProperties['@scope/adapter-esm'] as Record<string, unknown>
      const channelFields = bundle.uiSchema.sections.channels.recordMap.schemas['esm-channel']?.fields ?? []

      expect(bundle.extensions.adapters).toContain('@scope/adapter-esm')
      expect(bundle.extensions.channels).toContain('esm-channel')
      expect(externalSchema.properties).toMatchObject({
        esmFlag: { type: 'boolean' }
      })
      expect(channelFields.map(field => field.path.join('.'))).toContain('channelToken')
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('loads adapter contributions from pattern exports', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-schema-'))

    try {
      await writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify(
          {
            name: 'schema-test-workspace',
            private: true,
            dependencies: {
              '@scope/adapter-pattern': '1.0.0'
            }
          },
          null,
          2
        )
      )

      await writePackage(tempDir, '@scope/adapter-pattern', {
        'dist/config-schema.mjs': `
import { z } from ${JSON.stringify(zodUrl)}

export const adapterConfigContribution = {
  adapterKey: 'pattern-adapter',
  title: 'Pattern Adapter',
  schema: z.object({
    patternFlag: z.boolean().optional().describe('Pattern export flag')
  })
}
`
      }, {
        './*': {
          import: './dist/*.mjs'
        }
      })

      const bundle = await composeWorkspaceConfigSchemaBundle({ cwd: tempDir })
      const adapters = (bundle.jsonSchema.properties as Record<string, unknown>).adapters as Record<string, unknown>
      const adapterProperties = adapters.properties as Record<string, unknown>
      const patternSchema = adapterProperties['@scope/adapter-pattern'] as Record<string, unknown>

      expect(bundle.extensions.adapters).toContain('@scope/adapter-pattern')
      expect(patternSchema.properties).toMatchObject({
        patternFlag: { type: 'boolean' }
      })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('returns normalized known channel values from section parsing', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-schema-'))

    try {
      await writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify(
          {
            name: 'schema-test-workspace',
            private: true,
            dependencies: {
              '@scope/channel-normalized': '1.0.0'
            }
          },
          null,
          2
        )
      )

      await writePackage(tempDir, '@scope/channel-normalized', {
        'index.js': `
const { z } = require(${JSON.stringify(zodPath)})

module.exports.channelDefinition = {
  type: 'normalized-channel',
  label: 'Normalized Channel',
  configSchema: z.object({
    type: z.literal('normalized-channel'),
    channelToken: z.string().default('default-token')
  }),
  messageSchema: z.object({})
}
`
      }, {
        '.': './index.js'
      })

      const parsed = await validateConfigSection('channels', {
        teamChat: {
          type: 'normalized-channel'
        }
      }, { cwd: tempDir })

      expect(parsed.success).toBe(true)
      if (parsed.success) {
        expect(parsed.data).toEqual({
          teamChat: {
            type: 'normalized-channel',
            channelToken: 'default-token'
          }
        })
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('normalizes known channels with a single schema parse pass', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-schema-'))

    try {
      await writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify(
          {
            name: 'schema-test-workspace',
            private: true,
            dependencies: {
              '@scope/channel-transform-count': '1.0.0'
            }
          },
          null,
          2
        )
      )

      await writePackage(tempDir, '@scope/channel-transform-count', {
        'index.js': `
const { z } = require(${JSON.stringify(zodPath)})

let parseCount = 0

module.exports.channelDefinition = {
  type: 'counted-channel',
  label: 'Counted Channel',
  configSchema: z.object({
    type: z.literal('counted-channel')
  }).transform((value) => ({
    ...value,
    parseCount: ++parseCount
  })),
  messageSchema: z.object({})
}
`
      }, {
        '.': './index.js'
      })

      const parsed = await validateConfigSection('channels', {
        teamChat: {
          type: 'counted-channel'
        }
      }, { cwd: tempDir })

      expect(parsed.success).toBe(true)
      if (parsed.success) {
        expect(parsed.data).toEqual({
          teamChat: {
            type: 'counted-channel',
            parseCount: 1
          }
        })
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('writes the workspace composite schema to .oo/schema/config.schema.json', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-schema-'))

    try {
      await writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify(
          {
            name: 'schema-test-workspace',
            private: true,
            dependencies: {
              '@oneworks/adapter-codex': 'workspace:*'
            }
          },
          null,
          2
        )
      )

      const { outputPath } = await writeWorkspaceConfigSchemaFile({ cwd: tempDir })
      const written = JSON.parse(await readFile(outputPath, 'utf8')) as Record<string, unknown>

      expect(outputPath).toBe(path.join(tempDir, '.oo/schema/config.schema.json'))
      expect(written.$schema).toBe('http://json-schema.org/draft-07/schema#')
      expect((written.properties as Record<string, unknown>).adapters).toBeDefined()
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})
