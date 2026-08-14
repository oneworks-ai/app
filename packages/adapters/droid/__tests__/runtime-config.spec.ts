import '../src/adapter-config'

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PassThrough } from 'node:stream'

import { afterEach, describe, expect, it } from 'vitest'

import type { AdapterCtx, AdapterQueryOptions } from '@oneworks/types'

import {
  prepareDroidSession,
  resolveDroidAdapterConfig,
  resolveDroidSessionRoot,
  sanitizeDroidSpawnEnv
} from '../src/runtime/config'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

const createCtx = (root: string): AdapterCtx => ({
  ctxId: 'ctx-droid-config',
  cwd: root,
  env: {
    __ONEWORKS_PROJECT_ADAPTER_DROID_CLI_PATH__: '/fixture/droid',
    __ONEWORKS_PROJECT_HOME_PROJECT_DIR__: join(root, 'project-home'),
    __ONEWORKS_PROJECT_REAL_HOME__: join(root, 'real-home'),
    __ONEWORKS_PROJECT_DROID_NATIVE_HOOKS_AVAILABLE__: '1',
    __ONEWORKS_PROJECT_DROID_HOOK_COMMAND__: '/fixture/node /fixture/call-hook.js',
    FACTORY_API_KEY: 'api-key',
    FACTORY_TOKEN: 'token',
    FACTORY_REFRESH_TOKEN: 'must-not-leak',
    FACTORY_INTERNAL_COOKIE: 'must-not-leak'
  },
  cache: {
    get: async () => undefined,
    set: async () => ({ cachePath: '' })
  },
  logger: {
    stream: new PassThrough(),
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined
  },
  configs: [{
    adapters: {
      droid: {
        configContent: {
          general: { theme: 'dark' },
          mission: { enabled: true },
          plugins: { unsafe: true },
          enabledPlugins: ['unsafe'],
          worktree: true
        }
      }
    }
  }, undefined]
})

const createOptions = (skillSource: string): AdapterQueryOptions => ({
  type: 'create',
  runtime: 'cli',
  sessionId: '../../escape-attempt',
  model: 'default',
  permissionMode: 'default',
  systemPrompt: 'Follow the selected rules.',
  assetPlan: {
    adapter: 'droid',
    diagnostics: [{
      adapter: 'droid',
      assetId: 'plugin:fixture',
      origin: 'plugin',
      reason: 'native plugin candidate',
      source: 'plugin',
      status: 'native'
    }],
    mcpServers: {
      local: { command: 'node', args: ['server.mjs'], env: { TOKEN: 'fixture' } },
      remote: { type: 'http', url: 'https://mcp.example.test', headers: { Authorization: 'fixture' } }
    },
    overlays: [{
      assetId: 'skill:fixture',
      kind: 'skill',
      sourcePath: skillSource,
      targetPath: 'skills/../../escape'
    }, {
      assetId: 'plugin:fixture',
      kind: 'nativePlugin',
      sourcePath: join(skillSource, 'plugin'),
      targetPath: '../../real-home/.factory/plugins/fixture'
    }]
  },
  onEvent: () => undefined
})

describe('factory Droid runtime preparation', () => {
  it('resolves layered Droid config with contribution deep-merge semantics without mutating sources', () => {
    const effectiveProjectConfig = {
      adapters: {
        droid: {
          cli: {
            source: 'managed' as const,
            package: '@fixture/project-droid',
            version: '0.195.1'
          },
          configContent: {
            nested: { project: true, tombstone: 'remove-me' },
            projectOnly: true
          },
          accounts: {
            team: { title: 'Project Team', description: 'Project description' },
            retired: { title: 'Retired' }
          },
          defaultAccount: 'team',
          disableBuiltinSkills: true
        },
        cursor: { cli: { source: 'system' as const } }
      }
    }
    const userConfig = {
      adapters: {
        droid: {
          cli: { version: '0.195.7', autoInstall: false },
          configContent: {
            nested: { user: true, tombstone: null }
          },
          accounts: {
            team: { description: 'User description' },
            retired: null
          },
          effort: 'xhigh' as const
        }
      }
    }
    const originalProject = structuredClone(effectiveProjectConfig)
    const originalUser = structuredClone(userConfig)

    const resolved = resolveDroidAdapterConfig(
      {
        configs: [effectiveProjectConfig, userConfig],
        configState: {
          effectiveProjectConfig,
          projectConfig: {
            adapters: { droid: { cli: { package: '@fixture/raw-source-only' } } }
          },
          projectSource: {
            configPath: '/fixture/project/.oo.config.json',
            extendPaths: [],
            resolvedExtendPaths: []
          },
          userConfig,
          userSource: {
            configPath: '/fixture/home/.oo.dev.config.json',
            extendPaths: [],
            resolvedExtendPaths: []
          },
          mergedConfig: {
            adapters: {
              droid: {
                cli: { version: 'shallow-merge-would-lose-package' }
              }
            }
          }
        }
      } as unknown as Parameters<typeof resolveDroidAdapterConfig>[0]
    )

    expect(resolved).toEqual({
      entry: {
        cli: {
          source: 'managed',
          package: '@fixture/project-droid',
          version: '0.195.7',
          autoInstall: false
        },
        configContent: {
          nested: { project: true, tombstone: null, user: true },
          projectOnly: true
        },
        accounts: {
          team: { title: 'Project Team', description: 'User description' },
          retired: null
        },
        defaultAccount: 'team',
        disableBuiltinSkills: true,
        effort: 'xhigh'
      },
      common: {
        accounts: {
          team: { title: 'Project Team', description: 'User description' },
          retired: null
        },
        defaultAccount: 'team',
        effort: 'xhigh'
      },
      native: {
        cli: {
          source: 'managed',
          package: '@fixture/project-droid',
          version: '0.195.7',
          autoInstall: false
        },
        configContent: {
          nested: { project: true, tombstone: null, user: true },
          projectOnly: true
        },
        disableBuiltinSkills: true
      }
    })
    expect(effectiveProjectConfig).toEqual(originalProject)
    expect(userConfig).toEqual(originalUser)
    expect(effectiveProjectConfig.adapters.cursor).toEqual({ cli: { source: 'system' } })
  })

  it('projects contribution-layered config into the real query settings without changing source layers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-droid-query-layers-'))
    tempDirs.push(root)
    const skillSource = join(root, 'source-skill')
    await mkdir(skillSource, { recursive: true })
    const ctx = createCtx(root)
    const effectiveProjectConfig = {
      adapters: {
        droid: {
          configContent: {
            general: { theme: 'dark', telemetry: 'off' },
            projectOnly: true
          }
        }
      }
    }
    const userConfig = {
      adapters: {
        droid: {
          configContent: {
            general: { theme: 'light' },
            userOnly: true
          },
          disableBuiltinSkills: true
        }
      }
    }
    ctx.configs = [effectiveProjectConfig, userConfig]
    ctx.configState = {
      effectiveProjectConfig,
      projectConfig: { adapters: { droid: { configContent: { rawOnly: true } } } },
      userConfig,
      mergedConfig: { adapters: { droid: { disableBuiltinSkills: true } } }
    }
    const sourceSnapshot = structuredClone({ effectiveProjectConfig, userConfig })

    const prepared = await prepareDroidSession(ctx, createOptions(skillSource))
    const settingsPath = prepared.args[prepared.args.indexOf('--settings') + 1]
    const settings = JSON.parse(await readFile(settingsPath, 'utf8'))

    expect(settings.general).toEqual({ theme: 'light', telemetry: 'off' })
    expect(settings.projectOnly).toBe(true)
    expect(settings.userOnly).toBe(true)
    expect(settings.rawOnly).toBeUndefined()
    expect(prepared.initParams.disableBuiltinSkills).toBe(true)
    expect({ effectiveProjectConfig, userConfig }).toEqual(sourceSnapshot)
  })

  it('isolates HOME, preserves only explicit auth env, maps MCP/skills, and skips plugins', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-droid-config-'))
    tempDirs.push(root)
    const skillSource = join(root, 'source-skill')
    await mkdir(skillSource, { recursive: true })
    await writeFile(join(skillSource, 'SKILL.md'), '# Fixture skill\n')
    const ctx = createCtx(root)
    const options = createOptions(skillSource)
    const prepared = await prepareDroidSession(ctx, options)

    expect(prepared.sessionRoot.startsWith(resolve(root, 'project-home'))).toBe(true)
    expect(prepared.sessionRoot).not.toContain('escape-attempt')
    expect(prepared.spawnEnv.HOME).toBe(join(prepared.sessionRoot, 'home'))
    expect(prepared.spawnEnv.FACTORY_API_KEY).toBe('api-key')
    expect(prepared.spawnEnv.FACTORY_TOKEN).toBe('token')
    expect(prepared.spawnEnv.FACTORY_REFRESH_TOKEN).toBeUndefined()
    expect(prepared.spawnEnv.FACTORY_INTERNAL_COOKIE).toBeUndefined()
    expect(prepared.spawnEnv.__ONEWORKS_DROID_HOOK_RUNTIME__).toBe('cli')
    expect(prepared.spawnEnv.__ONEWORKS_DROID_TASK_SESSION_ID__).toBe('../../escape-attempt')
    expect(JSON.stringify(prepared.assetDiagnostics)).not.toContain('api-key')
    expect(JSON.stringify(prepared.assetDiagnostics)).not.toContain('token')
    expect(JSON.stringify(prepared.assetDiagnostics)).not.toContain('must-not-leak')
    expect(prepared.initParams).not.toHaveProperty('worktree')
    expect(Object.keys(prepared.initParams)).not.toEqual(expect.arrayContaining([
      'mission',
      'missions',
      'worktree'
    ]))
    expect(prepared.initParams.mcpServers).toEqual([
      { name: 'local', command: 'node', args: ['server.mjs'], env: { TOKEN: 'fixture' } },
      {
        name: 'remote',
        type: 'http',
        url: 'https://mcp.example.test',
        headers: [{ name: 'Authorization', value: 'fixture' }]
      }
    ])

    const settingsPath = prepared.args[prepared.args.indexOf('--settings') + 1]
    const settings = JSON.parse(await readFile(settingsPath, 'utf8'))
    expect(JSON.stringify(settings)).not.toContain('api-key')
    expect(JSON.stringify(settings)).not.toContain('must-not-leak')
    expect(settings.general).toEqual({ theme: 'dark' })
    expect(settings.plugins).toBeUndefined()
    expect(settings.enabledPlugins).toBeUndefined()
    expect(settings.mission).toBeUndefined()
    expect(settings.worktree).toBeUndefined()
    expect(Object.keys(settings.hooks)).toEqual([
      'PreToolUse',
      'PostToolUse',
      'Notification',
      'UserPromptSubmit',
      'Stop',
      'SubagentStop',
      'PreCompact',
      'SessionStart',
      'SessionEnd'
    ])
    expect(prepared.assetDiagnostics).toContainEqual(expect.objectContaining({
      assetId: 'plugin:fixture',
      status: 'skipped'
    }))
    await expect(stat(join(root, 'real-home', '.factory', 'plugins', 'fixture'))).rejects.toMatchObject({
      code: 'ENOENT'
    })

    const skillsRoot = join(prepared.sessionRoot, 'home', '.factory', 'skills')
    const entries = await import('node:fs/promises').then(fs => fs.readdir(skillsRoot))
    expect(entries).toHaveLength(1)
    expect(await readFile(join(skillsRoot, entries[0], 'SKILL.md'), 'utf8')).toContain('Fixture skill')
  })

  it('removes partial isolated state when reserved orchestration options fail validation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-droid-cleanup-'))
    tempDirs.push(root)
    const skillSource = join(root, 'source-skill')
    await mkdir(skillSource, { recursive: true })
    const ctx = createCtx(root)
    const options = { ...createOptions(skillSource), extraOptions: ['--worktree'] }
    const sessionRoot = resolveDroidSessionRoot({ ctx, sessionId: options.sessionId })
    await expect(prepareDroidSession(ctx, options)).rejects.toThrow('reserved by One Works')
    await expect(stat(sessionRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not inherit unapproved Factory environment variables', () => {
    const env = sanitizeDroidSpawnEnv({
      cwd: '/fixture/workspace',
      home: '/fixture/isolated-home',
      env: {
        PATH: '/bin',
        FACTORY_API_KEY: 'allowed',
        FACTORY_TOKEN: null,
        FACTORY_CREDENTIALS: 'blocked'
      }
    })
    expect(env).toEqual(expect.objectContaining({
      HOME: '/fixture/isolated-home',
      FACTORY_API_KEY: 'allowed'
    }))
    expect(env.FACTORY_CREDENTIALS).toBeUndefined()
    expect(env.FACTORY_TOKEN).toBeUndefined()
  })

  it('forwards the pinned Factory effort set and rejects ultra before session state is created', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-droid-effort-'))
    tempDirs.push(root)
    const skillSource = join(root, 'source-skill')
    await mkdir(skillSource, { recursive: true })
    const ctx = createCtx(root)
    const supported = await prepareDroidSession(ctx, {
      ...createOptions(skillSource),
      effort: 'xhigh'
    })
    expect(supported.initParams.reasoningEffort).toBe('xhigh')
    await supported.cleanup()

    const unsupported = {
      ...createOptions(skillSource),
      effort: 'ultra' as const
    }
    const sessionRoot = resolveDroidSessionRoot({ ctx, sessionId: unsupported.sessionId })
    await expect(prepareDroidSession(ctx, unsupported)).rejects.toThrow('does not support reasoning effort "ultra"')
    await expect(stat(sessionRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
