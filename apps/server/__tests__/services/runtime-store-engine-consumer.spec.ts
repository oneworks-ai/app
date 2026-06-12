/* eslint-disable max-lines -- consumer recovery scenarios share temp store setup and fixtures */
import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { describe, expect, it, vi } from 'vitest'

import {
  buildRuntimeConsumerSpawnPlan,
  readLatestRuntimeConsumerQueuedCommand,
  readRuntimeConsumerStartCommand,
  shouldStartServerRuntimeConsumer,
  startServerRuntimeConsumer
} from '#~/services/runtime-store/engine-consumer.js'
import type { RuntimeSessionMetadata, RuntimeSessionStore } from '#~/services/runtime-store/types.js'
import { ensureServerRuntimeConsumerOnce } from '#~/services/runtime-store/watcher.js'

const nodeRequire = createRequire(__filename)

const createStore = (root: string, sessionId = 'sess-room-dev'): RuntimeSessionStore => {
  const storePath = path.join(root, 'sessions', sessionId)
  return {
    sessionId,
    root,
    storePath,
    commandsPath: path.join(storePath, 'commands.jsonl'),
    eventsPath: path.join(storePath, 'events.jsonl'),
    metaPath: path.join(storePath, 'meta.json'),
    statePath: path.join(storePath, 'state.json')
  }
}

const writeCachedAdapterPackage = async (
  rootDir: string,
  packageName: string,
  version: string,
  rootKind: 'home' | 'packageCache' = 'home'
) => {
  const cacheDir = path.join(
    rootKind === 'home' ? path.join(rootDir, '.oneworks', 'bootstrap') : rootDir,
    'adapter-packages',
    packageName.replace(/^@/, '').replace(/[\\/]/g, '__'),
    version
  )
  const packageDir = path.join(cacheDir, 'node_modules', ...packageName.split('/'))
  await mkdir(packageDir, { recursive: true })
  await writeFile(
    path.join(packageDir, 'package.json'),
    `${JSON.stringify({ name: packageName, version }, null, 2)}\n`
  )
  return cacheDir
}

const writeRuntimeAdapterPackage = async (runtimePackageDir: string, packageName: string, version: string) => {
  const packageDir = path.join(runtimePackageDir, 'node_modules', ...packageName.split('/'))
  await mkdir(packageDir, { recursive: true })
  await writeFile(
    path.join(packageDir, 'package.json'),
    `${JSON.stringify({ name: packageName, version }, null, 2)}\n`
  )
}

const waitFor = async (predicate: () => boolean) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for condition.')
}

const waitForAsync = async (predicate: () => Promise<boolean>) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await predicate()) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for condition.')
}

describe('runtime store engine consumer', () => {
  it('only starts server consumers for pending room sessions that need an engine', () => {
    const metadata = {
      sessionId: 'sess-room-dev',
      hostSessionId: 'host-session',
      needsEngineConsumer: true,
      createdAt: 100
    } as RuntimeSessionMetadata

    expect(shouldStartServerRuntimeConsumer({
      heartbeat: { protocolVersion: '1.0.0', runtimeId: 'pending_engine_consumer', status: 'starting', updatedAt: 100 },
      metadata,
      state: { sessionId: 'sess-room-dev', status: 'starting', lastSeq: 0, updatedAt: 100 }
    })).toBe(true)
    expect(shouldStartServerRuntimeConsumer({
      heartbeat: { protocolVersion: '1.0.0', runtimeId: 'ow-run-123', status: 'running', updatedAt: 100 },
      metadata,
      state: { sessionId: 'sess-room-dev', status: 'running', lastSeq: 1, updatedAt: 100 }
    })).toBe(false)
    expect(shouldStartServerRuntimeConsumer({
      metadata: { ...metadata, hostSessionId: undefined },
      state: { sessionId: 'sess-room-dev', status: 'starting', lastSeq: 0, updatedAt: 100 }
    })).toBe(true)
    expect(shouldStartServerRuntimeConsumer({
      heartbeat: { protocolVersion: '1.0.0', runtimeId: 'ow-run-old', status: 'completed', updatedAt: 100 },
      metadata,
      queuedCommand: { ts: 200, type: 'submit_input' },
      state: { sessionId: 'sess-room-dev', status: 'completed', lastSeq: 10, updatedAt: 100 }
    })).toBe(true)
    expect(shouldStartServerRuntimeConsumer({
      heartbeat: { protocolVersion: '1.0.0', runtimeId: 'ow-run-old', status: 'completed', updatedAt: 300 },
      metadata,
      queuedCommand: { ts: 200, type: 'submit_input' },
      state: { sessionId: 'sess-room-dev', status: 'completed', lastSeq: 10, updatedAt: 300 }
    })).toBe(false)
  })

  it('builds a server-side consumer spawn plan for ordinary web sessions', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ow-runtime-consumer-web-'))
    const store = createStore(root, 'sess-web')
    await mkdir(store.storePath, { recursive: true })
    await writeFile(path.join(store.storePath, 'system-prompt.txt'), '历史上下文')
    const metadata = {
      sessionId: 'sess-web',
      cwd: '/workspace',
      title: 'Web task',
      account: 'work',
      adapter: 'codex',
      model: 'default',
      promptType: 'workspace',
      promptName: 'client',
      systemPrompt: '历史上下文',
      needsEngineConsumer: true,
      createdAt: 100,
      updateConfiguredSkills: true
    } as RuntimeSessionMetadata

    const plan = buildRuntimeConsumerSpawnPlan({
      baseEnv: {
        __ONEWORKS_RUNTIME_PROTOCOL_CONSUMER_CLI_PATH__: '/tmp/fake-ow.js'
      } as NodeJS.ProcessEnv,
      command: {
        message: 'Continue from web',
        messageDelivery: 'bridge'
      },
      cwd: '/workspace',
      metadata,
      store
    })

    expect(plan.args).toEqual([
      '/tmp/fake-ow.js',
      '__run',
      '--print',
      '--output-format',
      'stream-json',
      '--session-id',
      'sess-web',
      '--workspace',
      'client',
      '--adapter',
      'codex',
      '--account',
      'work',
      '--update-skills',
      '--model',
      'default'
    ])
    expect(plan.env.__ONEWORKS_PROJECT_BASE_DIR__).toBe(path.join('/workspace', '.oo'))
    expect(plan.env.__ONEWORKS_RUNTIME_PROTOCOL_SYSTEM_PROMPT_FILE__).toBe(
      path.join(store.storePath, 'system-prompt.txt')
    )
    expect(plan.env.__ONEWORKS_PROJECT_CTX_ID__).toBe('sess-web')
    expect(plan.env.__ONEWORKS_RUNTIME_PROTOCOL_CONSUMER_ADAPTER__).toBe('codex')
    expect(plan.env.__ONEWORKS_AGENT_ROOM_HOST_SESSION_ID__).toBe('')
  })

  it('passes the initial message as prompt text without prefixing the run command', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ow-runtime-consumer-prompt-'))
    const store = createStore(root, 'sess-web')
    const plan = buildRuntimeConsumerSpawnPlan({
      baseEnv: {
        __ONEWORKS_RUNTIME_PROTOCOL_CONSUMER_CLI_PATH__: '/tmp/fake-ow.js'
      } as NodeJS.ProcessEnv,
      command: {
        message: 'hi'
      },
      cwd: '/workspace',
      metadata: {
        sessionId: 'sess-web',
        cwd: '/workspace',
        needsEngineConsumer: true,
        createdAt: 100
      } as RuntimeSessionMetadata,
      store
    })

    expect(plan.args).toEqual([
      '/tmp/fake-ow.js',
      '__run',
      '--print',
      '--output-format',
      'stream-json',
      '--session-id',
      'sess-web',
      'hi'
    ])
  })

  it('does not inherit exact project-home dirs from another workspace when spawning consumers', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ow-runtime-consumer-env-'))
    const store = createStore(root, 'sess-web')
    const plan = buildRuntimeConsumerSpawnPlan({
      baseEnv: {
        __ONEWORKS_RUNTIME_PROTOCOL_CONSUMER_CLI_PATH__: '/tmp/fake-ow.js',
        __ONEWORKS_PROJECT_LAUNCH_CWD__: '/workspace-a',
        __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: '/workspace-a',
        __ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__: '/workspace-a',
        __ONEWORKS_PROJECT_HOME_PROJECT_DIR__: 'workspace-a-home'
      } as NodeJS.ProcessEnv,
      command: {
        message: 'Run in workspace B'
      },
      cwd: '/workspace-b',
      metadata: {
        sessionId: 'sess-web',
        cwd: '/workspace-b',
        needsEngineConsumer: true,
        createdAt: 100
      } as RuntimeSessionMetadata,
      store
    })

    expect(plan.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__).toBe('/workspace-b')
    expect(plan.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__).toBe('/workspace-b')
    expect(plan.env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__).not.toBe('/workspace-a')
    expect(plan.env.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__).toBeUndefined()
  })

  it('passes channel context env through server-side consumer spawn plans', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ow-runtime-consumer-channel-'))
    const store = createStore(root, 'sess-channel')
    const plan = buildRuntimeConsumerSpawnPlan({
      baseEnv: {
        __ONEWORKS_RUNTIME_PROTOCOL_CONSUMER_CLI_PATH__: '/tmp/fake-ow.js',
        __ONEWORKS_PROJECT_HOME_PROJECTS_DIR__: path.join(root, 'home-projects')
      } as NodeJS.ProcessEnv,
      command: {
        message: 'Reply to group',
        messageDelivery: 'bridge'
      },
      cwd: '/workspace',
      metadata: {
        sessionId: 'sess-channel',
        cwd: '/workspace',
        needsEngineConsumer: true,
        channelContext: {
          channelId: 'group-1@chatroom',
          channelKey: 'erjie',
          channelType: 'wechat',
          senderId: 'wxid-user',
          sessionType: 'group'
        },
        createdAt: 100
      } as RuntimeSessionMetadata,
      store
    })

    expect(plan.env).toEqual(expect.objectContaining({
      __ONEWORKS_PROJECT_CHANNEL_TYPE__: 'wechat',
      __ONEWORKS_PROJECT_CHANNEL_KEY__: 'erjie',
      __ONEWORKS_PROJECT_CHANNEL_SESSION_TYPE__: 'group',
      __ONEWORKS_PROJECT_CHANNEL_ID__: 'group-1@chatroom',
      __ONEWORKS_PROJECT_CHANNEL_SENDER_ID__: 'wxid-user'
    }))
    expect(plan.env.__ONEWORKS_PROJECT_CHANNEL_MEMORY_ROOT__).toContain('channel-memory')
    expect(plan.env.__ONEWORKS_PROJECT_CHANNEL_CONTEXT_PATH__).toContain('runtime-context')
  })

  it('builds a clean server-side consumer spawn plan for room child sessions', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ow-runtime-consumer-'))
    const store = createStore(root)
    const metadata = {
      sessionId: 'sess-room-dev',
      cwd: '/workspace',
      hostSessionId: 'host-session',
      roomId: 'room-host-session',
      roomTitle: 'Host room',
      entity: 'room-smoke-dev',
      adapter: 'codex',
      model: 'default',
      effort: 'high',
      permissionMode: 'bypassPermissions',
      needsEngineConsumer: true,
      createdAt: 100
    } as RuntimeSessionMetadata

    const plan = buildRuntimeConsumerSpawnPlan({
      baseEnv: {
        __ONEWORKS_RUNTIME_PROTOCOL_CONSUMER_CLI_PATH__: '/tmp/fake-ow.js',
        CODEX_SANDBOX: 'seatbelt',
        CODEX_SANDBOX_NETWORK_DISABLED: '1',
        CODEX_THREAD_ID: 'parent-thread',
        __ONEWORKS_CODEX_TASK_SESSION_ID__: 'host-session'
      } as NodeJS.ProcessEnv,
      command: {
        entity: 'room-smoke-dev',
        message: 'Run room child',
        model: 'mock,codex',
        permissionMode: 'dontAsk'
      },
      cwd: '/workspace',
      metadata,
      store
    })

    expect(plan.command).toBe(process.execPath)
    expect(plan.args).toEqual([
      '/tmp/fake-ow.js',
      '__run',
      '--print',
      '--output-format',
      'stream-json',
      '--session-id',
      'sess-room-dev',
      '--entity',
      'room-smoke-dev',
      '--adapter',
      'codex',
      '--model',
      'mock,codex',
      '--effort',
      'high',
      '--permission-mode',
      'dontAsk',
      'Run room child'
    ])
    expect(plan.env.__ONEWORKS_PROJECT_BASE_DIR__).toBe(path.join('/workspace', '.oo'))
    expect(plan.env.__ONEWORKS_PROJECT_CTX_ID__).toBe('host-session')
    expect(plan.env.__ONEWORKS_RUNTIME_PROTOCOL_CONSUMER_ADAPTER__).toBe('codex')
    expect(plan.env.__ONEWORKS_AGENT_ROOM_ID__).toBe('room-host-session')
    expect(plan.env.CODEX_SANDBOX).toBeUndefined()
    expect(plan.env.CODEX_SANDBOX_NETWORK_DISABLED).toBeUndefined()
    expect(plan.env.CODEX_THREAD_ID).toBeUndefined()
    expect(plan.env.__ONEWORKS_CODEX_TASK_SESSION_ID__).toBeUndefined()
  })

  it('uses forwarded non-js cli aliases as direct consumer commands', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ow-runtime-consumer-alias-'))
    const store = createStore(root)
    const metadata = {
      sessionId: 'sess-room-dev',
      cwd: '/workspace',
      hostSessionId: 'host-session',
      entity: 'room-smoke-dev',
      needsEngineConsumer: true,
      createdAt: 100
    } as RuntimeSessionMetadata

    const plan = buildRuntimeConsumerSpawnPlan({
      baseEnv: {
        __ONEWORKS_RUNTIME_PROTOCOL_CONSUMER_CLI_PATH__: '/workspace/node_modules/.bin/dyai'
      } as NodeJS.ProcessEnv,
      command: {
        entity: 'room-smoke-dev',
        message: 'Run room child'
      },
      cwd: '/workspace',
      metadata,
      store
    })

    expect(plan.command).toBe('/workspace/node_modules/.bin/dyai')
    expect(plan.args.slice(0, 7)).toEqual([
      '__run',
      '--print',
      '--output-format',
      'stream-json',
      '--session-id',
      'sess-room-dev',
      '--entity'
    ])
  })

  it('uses a matching workspace cli when available', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ow-runtime-consumer-matching-cli-'))
    const workspace = path.join(root, 'workspace')
    const workspaceBin = path.join(workspace, 'node_modules', '.bin', 'oneworks')
    const workspaceCliPackage = path.join(workspace, 'node_modules', '@oneworks', 'cli')
    const store = createStore(root)
    const bundledVersion = JSON.parse(
      await readFile(path.join(process.cwd(), 'apps', 'cli', 'package.json'), 'utf8')
    ).version as string
    await mkdir(path.dirname(workspaceBin), { recursive: true })
    await mkdir(workspaceCliPackage, { recursive: true })
    await writeFile(workspaceBin, '#!/bin/sh\nexit 0\n')
    await writeFile(
      path.join(workspaceCliPackage, 'package.json'),
      `${JSON.stringify({ name: '@oneworks/cli', version: bundledVersion }, null, 2)}\n`
    )

    const plan = buildRuntimeConsumerSpawnPlan({
      baseEnv: {
        PATH: ''
      } as NodeJS.ProcessEnv,
      command: {
        message: 'Run web task'
      },
      cwd: workspace,
      metadata: {
        sessionId: 'sess-web',
        cwd: workspace,
        needsEngineConsumer: true,
        createdAt: 100
      } as RuntimeSessionMetadata,
      store
    })

    expect(plan.command).toBe(workspaceBin)
  })

  it('prefers a matching workspace cli over a bootstrap command on PATH', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ow-runtime-consumer-workspace-before-bootstrap-'))
    const workspace = path.join(root, 'workspace')
    const workspaceBin = path.join(workspace, 'node_modules', '.bin', 'oneworks')
    const workspaceCliPackage = path.join(workspace, 'node_modules', '@oneworks', 'cli')
    const pathBin = path.join(root, 'bin')
    const pathBootstrap = path.join(pathBin, 'oneworks')
    const store = createStore(root)
    const bundledVersion = JSON.parse(
      await readFile(path.join(process.cwd(), 'apps', 'cli', 'package.json'), 'utf8')
    ).version as string
    await mkdir(path.dirname(workspaceBin), { recursive: true })
    await mkdir(workspaceCliPackage, { recursive: true })
    await mkdir(pathBin, { recursive: true })
    await writeFile(workspaceBin, '#!/bin/sh\nexit 0\n')
    await writeFile(pathBootstrap, '#!/bin/sh\nexit 0\n')
    await writeFile(
      path.join(workspaceCliPackage, 'package.json'),
      `${JSON.stringify({ name: '@oneworks/cli', version: bundledVersion }, null, 2)}\n`
    )

    const plan = buildRuntimeConsumerSpawnPlan({
      baseEnv: {
        PATH: pathBin
      } as NodeJS.ProcessEnv,
      command: {
        message: 'Run web task'
      },
      cwd: workspace,
      metadata: {
        sessionId: 'sess-web',
        cwd: workspace,
        needsEngineConsumer: true,
        createdAt: 100
      } as RuntimeSessionMetadata,
      store
    })

    expect(plan.command).toBe(workspaceBin)
  })

  it('uses the bundled cli when the workspace cli version is stale', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ow-runtime-consumer-stale-cli-'))
    const workspace = path.join(root, 'workspace')
    const workspaceBin = path.join(workspace, 'node_modules', '.bin', 'oneworks')
    const workspaceCliPackage = path.join(workspace, 'node_modules', '@oneworks', 'cli')
    const store = createStore(root)
    await mkdir(path.dirname(workspaceBin), { recursive: true })
    await mkdir(workspaceCliPackage, { recursive: true })
    await writeFile(workspaceBin, '#!/bin/sh\nexit 0\n')
    await writeFile(
      path.join(workspaceCliPackage, 'package.json'),
      `${JSON.stringify({ name: '@oneworks/cli', version: '0.0.1-stale' }, null, 2)}\n`
    )

    const plan = buildRuntimeConsumerSpawnPlan({
      baseEnv: {
        PATH: ''
      } as NodeJS.ProcessEnv,
      command: {
        message: 'Run web task'
      },
      cwd: workspace,
      metadata: {
        sessionId: 'sess-web',
        cwd: workspace,
        needsEngineConsumer: true,
        createdAt: 100
      } as RuntimeSessionMetadata,
      store
    })

    expect(plan.command).toBe(process.execPath)
    expect(plan.args[0]).toBe(path.join(
      path.dirname(nodeRequire.resolve('@oneworks/cli/package.json')),
      'cli.js'
    ))
  })

  it('uses a user PATH ow command before the bundled fallback bootstrap', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ow-runtime-consumer-user-path-'))
    const store = createStore(root)
    const userBinDir = path.join(root, 'user-bin')
    const userVfPath = path.join(userBinDir, 'ow')
    await mkdir(userBinDir, { recursive: true })
    await writeFile(userVfPath, '#!/bin/sh\nexit 0\n')
    const metadata = {
      sessionId: 'sess-web',
      cwd: '/workspace',
      needsEngineConsumer: true,
      createdAt: 100
    } as RuntimeSessionMetadata

    const plan = buildRuntimeConsumerSpawnPlan({
      baseEnv: {
        PATH: userBinDir,
        __ONEWORKS_RUNTIME_PROTOCOL_FALLBACK_BOOTSTRAP_PATH__: '/opt/oneworks/bootstrap.js'
      } as NodeJS.ProcessEnv,
      command: {
        message: 'Run web task'
      },
      cwd: '/workspace',
      metadata,
      store
    })

    expect(plan.command).toBe(userVfPath)
    expect(plan.args.slice(0, 4)).toEqual([
      '__run',
      '--print',
      '--output-format',
      'stream-json'
    ])
  })

  it('prefers a user PATH bootstrap over a plain user PATH ow', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ow-runtime-consumer-user-bootstrap-'))
    const store = createStore(root)
    const userBinDir = path.join(root, 'user-bin')
    const userBootstrapPath = path.join(userBinDir, 'oneworks')
    const userVfPath = path.join(userBinDir, 'ow')
    await mkdir(userBinDir, { recursive: true })
    await writeFile(userBootstrapPath, '#!/bin/sh\nexit 0\n')
    await writeFile(userVfPath, '#!/bin/sh\nexit 0\n')
    const metadata = {
      sessionId: 'sess-web',
      cwd: '/workspace',
      needsEngineConsumer: true,
      createdAt: 100
    } as RuntimeSessionMetadata

    const plan = buildRuntimeConsumerSpawnPlan({
      baseEnv: {
        PATH: userBinDir,
        __ONEWORKS_RUNTIME_PROTOCOL_FALLBACK_BOOTSTRAP_PATH__: '/opt/oneworks/bootstrap.js'
      } as NodeJS.ProcessEnv,
      command: {
        message: 'Run web task'
      },
      cwd: '/workspace',
      metadata,
      store
    })

    expect(plan.command).toBe(userBootstrapPath)
    expect(plan.args.slice(0, 4)).toEqual([
      '__run',
      '--print',
      '--output-format',
      'stream-json'
    ])
  })

  it('injects an existing user-home adapter package cache into runtime consumer env', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ow-runtime-consumer-adapter-cache-'))
    const homeDir = path.join(root, 'home')
    const appPackageDir = path.join(root, 'app-package')
    const store = createStore(root)
    await mkdir(appPackageDir, { recursive: true })
    const cacheDir = await writeCachedAdapterPackage(homeDir, '@oneworks/adapter-codex', '3.3.1')
    const metadata = {
      sessionId: 'sess-web',
      cwd: '/workspace',
      adapter: 'codex',
      needsEngineConsumer: true,
      createdAt: 100
    } as RuntimeSessionMetadata

    const plan = buildRuntimeConsumerSpawnPlan({
      baseEnv: {
        PATH: '',
        __ONEWORKS_PROJECT_CLI_PACKAGE_DIR__: appPackageDir,
        __ONEWORKS_PROJECT_PACKAGE_DIR__: appPackageDir,
        __ONEWORKS_PROJECT_REAL_HOME__: homeDir,
        __ONEWORKS_RUNTIME_PROTOCOL_FALLBACK_BOOTSTRAP_PATH__: '/opt/oneworks/bootstrap.js'
      } as NodeJS.ProcessEnv,
      command: {
        message: 'Run web task'
      },
      cwd: '/workspace',
      metadata,
      store
    })

    expect(plan.env.__ONEWORKS_PROJECT_CLI_PACKAGE_DIR__).toBe(cacheDir)
    expect(plan.env.__ONEWORKS_RUNTIME_PROTOCOL_CONSUMER_ADAPTER__).toBe('codex')
  })

  it('injects an adapter package cache from the configured package cache root', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ow-runtime-consumer-configured-adapter-cache-'))
    const packageCacheRoot = path.join(root, 'package-cache')
    const appPackageDir = path.join(root, 'app-package')
    const store = createStore(root)
    await mkdir(appPackageDir, { recursive: true })
    const cacheDir = await writeCachedAdapterPackage(
      packageCacheRoot,
      '@oneworks/adapter-codex',
      '3.3.1',
      'packageCache'
    )
    const metadata = {
      sessionId: 'sess-web',
      cwd: '/workspace',
      adapter: 'codex',
      needsEngineConsumer: true,
      createdAt: 100
    } as RuntimeSessionMetadata

    const plan = buildRuntimeConsumerSpawnPlan({
      baseEnv: {
        PATH: '',
        __ONEWORKS_PROJECT_CLI_PACKAGE_DIR__: appPackageDir,
        __ONEWORKS_PROJECT_PACKAGE_CACHE_DIR__: packageCacheRoot,
        __ONEWORKS_PROJECT_PACKAGE_DIR__: appPackageDir,
        __ONEWORKS_RUNTIME_PROTOCOL_FALLBACK_BOOTSTRAP_PATH__: '/opt/oneworks/bootstrap.js'
      } as NodeJS.ProcessEnv,
      command: {
        message: 'Run web task'
      },
      cwd: '/workspace',
      metadata,
      store
    })

    expect(plan.env.__ONEWORKS_PROJECT_CLI_PACKAGE_DIR__).toBe(cacheDir)
  })

  it('uses a compatible user-home adapter package cache over the built-in desktop adapter', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ow-runtime-consumer-compatible-adapter-cache-'))
    const homeDir = path.join(root, 'home')
    const appPackageDir = path.join(root, 'app-package')
    const store = createStore(root)
    await mkdir(appPackageDir, { recursive: true })
    const builtinCacheDir = await writeCachedAdapterPackage(homeDir, '@oneworks/adapter-codex', '3.4.0-rc')
    const compatibleCacheDir = await writeCachedAdapterPackage(homeDir, '@oneworks/adapter-codex', '3.4.1')
    const metadata = {
      sessionId: 'sess-web',
      cwd: '/workspace',
      adapter: 'codex',
      needsEngineConsumer: true,
      createdAt: 100
    } as RuntimeSessionMetadata

    const plan = buildRuntimeConsumerSpawnPlan({
      baseEnv: {
        PATH: '',
        __ONEWORKS_DESKTOP_BUILTIN_ADAPTER_PACKAGES__: JSON.stringify({
          '@oneworks/adapter-codex': {
            cacheDir: builtinCacheDir,
            version: '3.4.0-rc'
          }
        }),
        __ONEWORKS_PROJECT_CLI_PACKAGE_DIR__: appPackageDir,
        __ONEWORKS_PROJECT_PACKAGE_DIR__: appPackageDir,
        __ONEWORKS_PROJECT_REAL_HOME__: homeDir,
        __ONEWORKS_RUNTIME_PROTOCOL_FALLBACK_BOOTSTRAP_PATH__: '/opt/oneworks/bootstrap.js'
      } as NodeJS.ProcessEnv,
      command: {
        message: 'Run web task'
      },
      cwd: '/workspace',
      metadata,
      store
    })

    expect(plan.env.__ONEWORKS_PROJECT_CLI_PACKAGE_DIR__).toBe(compatibleCacheDir)
    expect(plan.env.__ONEWORKS_RUNTIME_PROTOCOL_CONSUMER_ADAPTER__).toBe('codex')
  })

  it('falls back to the built-in desktop adapter when global caches do not satisfy the built-in semver floor', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ow-runtime-consumer-builtin-adapter-cache-'))
    const homeDir = path.join(root, 'home')
    const appPackageDir = path.join(root, 'app-package')
    const store = createStore(root)
    await mkdir(appPackageDir, { recursive: true })
    await writeCachedAdapterPackage(homeDir, '@oneworks/adapter-codex', '3.3.9')
    const builtinCacheDir = await writeCachedAdapterPackage(homeDir, '@oneworks/adapter-codex', '3.4.0-rc')
    const metadata = {
      sessionId: 'sess-web',
      cwd: '/workspace',
      adapter: 'codex',
      needsEngineConsumer: true,
      createdAt: 100
    } as RuntimeSessionMetadata

    const plan = buildRuntimeConsumerSpawnPlan({
      baseEnv: {
        PATH: '',
        __ONEWORKS_DESKTOP_BUILTIN_ADAPTER_PACKAGES__: JSON.stringify({
          '@oneworks/adapter-codex': {
            cacheDir: builtinCacheDir,
            version: '3.4.0-rc'
          }
        }),
        __ONEWORKS_PROJECT_CLI_PACKAGE_DIR__: appPackageDir,
        __ONEWORKS_PROJECT_PACKAGE_DIR__: appPackageDir,
        __ONEWORKS_PROJECT_REAL_HOME__: homeDir,
        __ONEWORKS_RUNTIME_PROTOCOL_FALLBACK_BOOTSTRAP_PATH__: '/opt/oneworks/bootstrap.js'
      } as NodeJS.ProcessEnv,
      command: {
        message: 'Run web task'
      },
      cwd: '/workspace',
      metadata,
      store
    })

    expect(plan.env.__ONEWORKS_PROJECT_CLI_PACKAGE_DIR__).toBe(builtinCacheDir)
    expect(plan.env.__ONEWORKS_RUNTIME_PROTOCOL_CONSUMER_ADAPTER__).toBe('codex')
  })

  it('clears an inherited runtime package dir so bootstrap can install a missing adapter', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ow-runtime-consumer-missing-adapter-cache-'))
    const homeDir = path.join(root, 'home')
    const appPackageDir = path.join(root, 'app-package')
    const store = createStore(root)
    await mkdir(appPackageDir, { recursive: true })
    const metadata = {
      sessionId: 'sess-web',
      cwd: '/workspace',
      adapter: 'codex',
      needsEngineConsumer: true,
      createdAt: 100
    } as RuntimeSessionMetadata

    const plan = buildRuntimeConsumerSpawnPlan({
      baseEnv: {
        PATH: '',
        __ONEWORKS_PROJECT_CLI_PACKAGE_DIR__: appPackageDir,
        __ONEWORKS_PROJECT_PACKAGE_DIR__: appPackageDir,
        __ONEWORKS_PROJECT_REAL_HOME__: homeDir,
        __ONEWORKS_RUNTIME_PROTOCOL_FALLBACK_BOOTSTRAP_PATH__: '/opt/oneworks/bootstrap.js'
      } as NodeJS.ProcessEnv,
      command: {
        message: 'Run web task'
      },
      cwd: '/workspace',
      metadata,
      store
    })

    expect(plan.env.__ONEWORKS_PROJECT_CLI_PACKAGE_DIR__).toBeUndefined()
    expect(plan.env.__ONEWORKS_RUNTIME_PROTOCOL_CONSUMER_ADAPTER__).toBe('codex')
  })

  it('keeps an existing runtime package dir when it already contains the adapter', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ow-runtime-consumer-runtime-adapter-'))
    const runtimePackageDir = path.join(root, 'runtime-package')
    const store = createStore(root)
    await writeRuntimeAdapterPackage(runtimePackageDir, '@oneworks/adapter-codex', '3.3.1')
    const metadata = {
      sessionId: 'sess-web',
      cwd: '/workspace',
      adapter: 'codex',
      needsEngineConsumer: true,
      createdAt: 100
    } as RuntimeSessionMetadata

    const plan = buildRuntimeConsumerSpawnPlan({
      baseEnv: {
        PATH: '',
        __ONEWORKS_PROJECT_CLI_PACKAGE_DIR__: runtimePackageDir,
        __ONEWORKS_RUNTIME_PROTOCOL_FALLBACK_BOOTSTRAP_PATH__: '/opt/oneworks/bootstrap.js'
      } as NodeJS.ProcessEnv,
      command: {
        message: 'Run web task'
      },
      cwd: '/workspace',
      metadata,
      store
    })

    expect(plan.env.__ONEWORKS_PROJECT_CLI_PACKAGE_DIR__).toBe(runtimePackageDir)
    expect(plan.env.__ONEWORKS_RUNTIME_PROTOCOL_CONSUMER_ADAPTER__).toBe('codex')
  })

  it('uses the bundled fallback bootstrap when no user runtime command is available', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ow-runtime-consumer-fallback-bootstrap-'))
    const store = createStore(root)
    const fallbackBootstrapPath = '/opt/oneworks/bootstrap.js'
    const metadata = {
      sessionId: 'sess-web',
      cwd: '/workspace',
      needsEngineConsumer: true,
      createdAt: 100
    } as RuntimeSessionMetadata

    const plan = buildRuntimeConsumerSpawnPlan({
      baseEnv: {
        PATH: '',
        __ONEWORKS_RUNTIME_PROTOCOL_FALLBACK_BOOTSTRAP_PATH__: fallbackBootstrapPath
      } as NodeJS.ProcessEnv,
      command: {
        message: 'Run web task'
      },
      cwd: '/workspace',
      metadata,
      store
    })

    expect(plan.command).toBe(process.execPath)
    expect(plan.args.slice(0, 6)).toEqual([
      fallbackBootstrapPath,
      '__run',
      '--print',
      '--output-format',
      'stream-json',
      '--session-id'
    ])
  })

  it('reads start command runtime options for server consumers', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ow-runtime-consumer-command-'))
    const store = createStore(root)
    await mkdir(store.storePath, { recursive: true })
    await writeFile(
      store.commandsPath,
      JSON.stringify({
        protocolVersion: '1.0.0',
        id: 'cmd_start_1',
        ts: 100,
        sessionId: 'sess-room-dev',
        type: 'start',
        priority: 20,
        source: 'cli',
        entity: 'room-smoke-dev',
        account: 'work',
        adapter: 'codex',
        effort: 'high',
        model: 'mock,codex',
        permissionMode: 'dontAsk',
        messageDelivery: 'bridge',
        updateConfiguredSkills: true,
        content: 'Run room child'
      })
    )

    await expect(readRuntimeConsumerStartCommand(store.commandsPath)).resolves.toEqual({
      account: 'work',
      adapter: 'codex',
      effort: 'high',
      entity: 'room-smoke-dev',
      message: 'Run room child',
      messageDelivery: 'bridge',
      model: 'mock,codex',
      permissionMode: 'dontAsk',
      ts: 100,
      type: 'start',
      updateConfiguredSkills: true
    })
  })

  it('reads the newest queued non-start command for terminal consumer recovery', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ow-runtime-consumer-queued-command-'))
    const store = createStore(root)
    await mkdir(store.storePath, { recursive: true })
    await writeFile(
      store.commandsPath,
      [
        JSON.stringify({
          id: 'cmd_start_1',
          ts: 100,
          sessionId: 'sess-room-dev',
          type: 'start'
        }),
        JSON.stringify({
          id: 'cmd_message_1',
          ts: 200,
          sessionId: 'sess-room-dev',
          type: 'send_message'
        }),
        JSON.stringify({
          id: 'cmd_submit_1',
          ts: 300,
          sessionId: 'sess-room-dev',
          type: 'submit_input'
        })
      ].join('\n')
    )

    await expect(readLatestRuntimeConsumerQueuedCommand(store.commandsPath)).resolves.toEqual({
      ts: 300,
      type: 'submit_input'
    })
  })

  it('starts terminal web follow-ups with CLI resume instead of replaying the start command', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ow-runtime-consumer-terminal-resume-'))
    const store = createStore(root, 'sess-web')
    const consumerCli = path.join(root, 'dyai')
    const argsPath = path.join(root, 'args.txt')
    await mkdir(store.storePath, { recursive: true })
    await writeFile(consumerCli, `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(argsPath)}\nexit 0\n`)
    await chmod(consumerCli, 0o755)
    await writeFile(
      store.commandsPath,
      [
        JSON.stringify({
          id: 'cmd_start_1',
          ts: 100,
          sessionId: store.sessionId,
          type: 'start',
          priority: 20,
          source: 'web',
          content: 'Initial web task',
          messageDelivery: 'bridge'
        }),
        JSON.stringify({
          id: 'cmd_resume_1',
          ts: 300,
          sessionId: store.sessionId,
          type: 'resume',
          priority: 20,
          source: 'cli',
          content: 'Follow up from CLI'
        })
      ].join('\n')
    )
    await writeFile(
      store.statePath,
      JSON.stringify({
        protocolVersion: '1.0.0',
        sessionId: store.sessionId,
        status: 'completed',
        lastSeq: 10,
        updatedAt: 200
      })
    )
    await writeFile(
      path.join(store.storePath, 'heartbeat.json'),
      JSON.stringify({
        protocolVersion: '1.0.0',
        sessionId: store.sessionId,
        runtimeId: 'ow-run-old',
        status: 'completed',
        updatedAt: 200
      })
    )

    const child = await startServerRuntimeConsumer({
      baseEnv: {
        __ONEWORKS_RUNTIME_PROTOCOL_CONSUMER_CLI_PATH__: consumerCli
      },
      metadata: {
        protocolVersion: '1.0.0',
        sessionId: store.sessionId,
        title: 'Web session',
        cwd: root,
        needsEngineConsumer: true,
        createdAt: 100
      },
      store
    })

    expect(child).toBeDefined()
    await new Promise<void>(resolve => child?.once('exit', () => resolve()))
    const args = (await readFile(argsPath, 'utf8')).trim().split('\n')
    expect(args).toEqual([
      '__run',
      '--print',
      '--output-format',
      'stream-json',
      '--resume',
      'sess-web'
    ])
  })

  it('deduplicates concurrent server consumer starts for the same runtime store', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ow-runtime-consumer-dedupe-'))
    const store = createStore(root)
    await mkdir(store.storePath, { recursive: true })
    await writeFile(
      store.metaPath,
      JSON.stringify({
        protocolVersion: '1.0.0',
        sessionId: store.sessionId,
        title: 'Room child',
        entity: 'room-smoke-dev',
        cwd: root,
        hostSessionId: 'host-session',
        needsEngineConsumer: true,
        createdAt: 100
      })
    )
    await writeFile(
      store.statePath,
      JSON.stringify({
        protocolVersion: '1.0.0',
        sessionId: store.sessionId,
        status: 'starting',
        lastSeq: 0,
        updatedAt: 100
      })
    )
    await writeFile(
      path.join(store.storePath, 'heartbeat.json'),
      JSON.stringify({
        protocolVersion: '1.0.0',
        sessionId: store.sessionId,
        runtimeId: 'pending_engine_consumer',
        status: 'starting',
        updatedAt: 100
      })
    )

    let releaseStart: (() => void) | undefined
    const child = Object.assign(new EventEmitter(), {
      exitCode: null,
      signalCode: null,
      unref: vi.fn()
    }) as unknown as ChildProcess
    const startConsumer = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        releaseStart = resolve
      })
      return child
    })
    const registry = {
      consumers: new Map<string, ChildProcess>(),
      starting: new Set<string>()
    }

    const first = ensureServerRuntimeConsumerOnce(store, registry, startConsumer)
    const second = ensureServerRuntimeConsumerOnce(store, registry, startConsumer)
    await waitFor(() => startConsumer.mock.calls.length > 0)

    expect(startConsumer).toHaveBeenCalledTimes(1)
    expect(registry.starting.has(store.storePath)).toBe(true)

    releaseStart?.()
    await Promise.all([first, second])

    expect(registry.consumers.get(store.storePath)).toBe(child)
    expect(child.unref).toHaveBeenCalledTimes(1)

    child.emit('exit')
    expect(registry.consumers.has(store.storePath)).toBe(false)
  })

  it('marks sessions failed when the configured consumer cli path is missing', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ow-runtime-consumer-missing-cli-'))
    const store = createStore(root)
    await mkdir(store.storePath, { recursive: true })
    await writeFile(
      store.commandsPath,
      JSON.stringify({
        protocolVersion: '1.0.0',
        id: 'cmd_start_1',
        ts: 100,
        sessionId: store.sessionId,
        type: 'start',
        priority: 20,
        source: 'cli',
        entity: 'room-smoke-dev',
        content: 'Run room child'
      })
    )

    const child = await startServerRuntimeConsumer({
      baseEnv: {
        __ONEWORKS_RUNTIME_PROTOCOL_CONSUMER_CLI_PATH__: path.join(root, 'missing-dyai')
      },
      metadata: {
        protocolVersion: '1.0.0',
        sessionId: store.sessionId,
        title: 'Room child',
        entity: 'room-smoke-dev',
        cwd: root,
        hostSessionId: 'host-session',
        needsEngineConsumer: true,
        createdAt: 100
      },
      store
    })

    expect(child).toBeUndefined()

    await waitForAsync(async () => {
      const state = JSON.parse(await readFile(store.statePath, 'utf8')) as { status?: string }
      return state.status === 'failed'
    })

    const state = JSON.parse(await readFile(store.statePath, 'utf8')) as { error?: string; status?: string }
    const heartbeat = JSON.parse(
      await readFile(path.join(store.storePath, 'heartbeat.json'), 'utf8')
    ) as { error?: string; status?: string }

    expect(state.status).toBe('failed')
    expect(heartbeat.status).toBe('failed')
    expect(state.error).toContain('Runtime consumer CLI path does not exist')
    expect(heartbeat.error).toBe(state.error)
  })

  it('marks sessions failed when the consumer exits before writing a runtime id', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ow-runtime-consumer-exit-'))
    const store = createStore(root)
    const consumerCli = path.join(root, 'dyai')
    await mkdir(store.storePath, { recursive: true })
    await writeFile(consumerCli, '#!/bin/sh\nexit 7\n')
    await chmod(consumerCli, 0o755)
    await writeFile(
      store.commandsPath,
      JSON.stringify({
        protocolVersion: '1.0.0',
        id: 'cmd_start_1',
        ts: 100,
        sessionId: store.sessionId,
        type: 'start',
        priority: 20,
        source: 'cli',
        entity: 'room-smoke-dev',
        content: 'Run room child'
      })
    )
    await writeFile(
      path.join(store.storePath, 'heartbeat.json'),
      JSON.stringify({
        protocolVersion: '1.0.0',
        sessionId: store.sessionId,
        runtimeId: 'pending_engine_consumer',
        status: 'starting',
        updatedAt: 100
      })
    )
    await writeFile(
      store.statePath,
      JSON.stringify({
        protocolVersion: '1.0.0',
        sessionId: store.sessionId,
        status: 'starting',
        lastSeq: 0,
        updatedAt: 100
      })
    )

    const child = await startServerRuntimeConsumer({
      baseEnv: {
        __ONEWORKS_RUNTIME_PROTOCOL_CONSUMER_CLI_PATH__: consumerCli
      },
      metadata: {
        protocolVersion: '1.0.0',
        sessionId: store.sessionId,
        title: 'Room child',
        entity: 'room-smoke-dev',
        cwd: root,
        hostSessionId: 'host-session',
        needsEngineConsumer: true,
        createdAt: 100
      },
      store
    })

    expect(child).toBeDefined()
    await new Promise<void>(resolve => child?.once('exit', () => resolve()))

    await waitForAsync(async () => {
      const state = JSON.parse(await readFile(store.statePath, 'utf8')) as { status?: string }
      return state.status === 'failed'
    })

    const state = JSON.parse(await readFile(store.statePath, 'utf8')) as { error?: string; status?: string }
    const heartbeat = JSON.parse(
      await readFile(path.join(store.storePath, 'heartbeat.json'), 'utf8')
    ) as { error?: string; status?: string }

    expect(state.status).toBe('failed')
    expect(heartbeat.status).toBe('failed')
    expect(state.error).toContain('Runtime consumer exited before startup completed with code 7')
    expect(heartbeat.error).toBe(state.error)
  })

  it('marks clean early exits failed when the consumer never writes runtime state', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ow-runtime-consumer-clean-exit-'))
    const store = createStore(root, 'sess-web')
    const consumerCli = path.join(root, 'dyai')
    await mkdir(store.storePath, { recursive: true })
    await writeFile(consumerCli, '#!/bin/sh\nexit 0\n')
    await chmod(consumerCli, 0o755)
    await writeFile(
      store.commandsPath,
      JSON.stringify({
        protocolVersion: '1.0.0',
        id: 'cmd_start_1',
        ts: 100,
        sessionId: store.sessionId,
        type: 'start',
        priority: 20,
        source: 'web',
        content: 'Run web session'
      })
    )
    await writeFile(
      path.join(store.storePath, 'heartbeat.json'),
      JSON.stringify({
        protocolVersion: '1.0.0',
        sessionId: store.sessionId,
        runtimeId: 'pending_engine_consumer',
        status: 'starting',
        updatedAt: 100
      })
    )
    await writeFile(
      store.statePath,
      JSON.stringify({
        protocolVersion: '1.0.0',
        sessionId: store.sessionId,
        status: 'starting',
        lastSeq: 0,
        updatedAt: 100
      })
    )

    const child = await startServerRuntimeConsumer({
      baseEnv: {
        __ONEWORKS_RUNTIME_PROTOCOL_CONSUMER_CLI_PATH__: consumerCli
      },
      metadata: {
        protocolVersion: '1.0.0',
        sessionId: store.sessionId,
        title: 'Web session',
        cwd: root,
        needsEngineConsumer: true,
        createdAt: 100
      },
      store
    })

    expect(child).toBeDefined()
    await new Promise<void>(resolve => child?.once('exit', () => resolve()))

    await waitForAsync(async () => {
      const state = JSON.parse(await readFile(store.statePath, 'utf8')) as { status?: string }
      return state.status === 'failed'
    })

    const state = JSON.parse(await readFile(store.statePath, 'utf8')) as { error?: string; status?: string }
    expect(state.status).toBe('failed')
    expect(state.error).toContain('Runtime consumer exited before startup completed with code 0')
  })
})
