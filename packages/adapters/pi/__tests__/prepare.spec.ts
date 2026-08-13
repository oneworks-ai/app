import '../src/adapter-config'

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { PassThrough } from 'node:stream'

import { afterEach, describe, expect, it } from 'vitest'

import type { AdapterCtx, AdapterQueryOptions } from '@oneworks/types'
import { resolvePermissionMirrorPath } from '@oneworks/utils'

import { preparePiSession } from '#~/runtime/session/prepare.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

describe('pi session preparation', () => {
  it('shares a durable native auth profile and explicitly enables native extensions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-pi-prepare-'))
    tempDirs.push(root)
    const cwd = join(root, 'workspace')
    const projectHome = join(root, 'project-home')
    const realHome = join(root, 'real-home')
    const realAgentDir = join(realHome, '.pi', 'agent')
    const nativeExtensions = join(realAgentDir, 'extensions')
    await mkdir(cwd, { recursive: true })
    await mkdir(nativeExtensions, { recursive: true })
    await writeFile(join(realAgentDir, 'auth.json'), '{"anthropic":{"token":"initial"}}\n')

    const ctx = {
      ctxId: 'ctx-pi-prepare',
      cwd,
      env: {
        __ONEWORKS_PROJECT_ADAPTER_PI_CLI_PATH__: join(root, 'pi'),
        __ONEWORKS_PROJECT_HOME_PROJECT_DIR__: projectHome,
        __ONEWORKS_PROJECT_REAL_HOME__: realHome
      },
      cache: { get: async () => undefined, set: async () => ({ cachePath: '' }) },
      logger: {
        stream: new PassThrough(),
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        debug: () => undefined
      },
      configs: [{
        adapters: { pi: { enableNativeExtensions: true } },
        permissions: { allow: ['review_changes'] }
      }, undefined]
    } as AdapterCtx
    const options = (sessionId: string, type: 'create' | 'resume' = 'create'): AdapterQueryOptions => ({
      type,
      runtime: 'cli',
      sessionId,
      model: 'default',
      permissionMode: 'dontAsk',
      tools: { include: ['review_changes'] },
      onEvent: () => undefined
    })
    const mirrorPath = resolvePermissionMirrorPath(cwd, 'pi', 'session-a', ctx.env)
    await mkdir(dirname(mirrorPath), { recursive: true })
    await writeFile(
      mirrorPath,
      JSON.stringify({
        adapter: 'pi',
        sessionId: 'session-a',
        permissionState: {
          allow: [],
          deny: ['review_changes'],
          onceAllow: ['review_changes'],
          onceDeny: ['review_changes']
        }
      })
    )

    const first = await preparePiSession(ctx, options('session-a'), 'stream')
    const sharedAgentDir = join(projectHome, 'caches', 'adapter-pi', 'native-agent')
    expect(first.spawnEnv.PI_CODING_AGENT_DIR).toBe(sharedAgentDir)
    expect(first.args).toContain(nativeExtensions)
    expect(first.args).toContain('review_changes')
    expect(await readFile(join(sharedAgentDir, 'auth.json'), 'utf8')).toContain('initial')
    expect(
      await readFile(
        join(projectHome, 'caches', 'ctx-pi-prepare', 'session-a', 'adapter-pi', 'oneworks-permissions.mjs'),
        'utf8'
      )
    ).toContain('"review_changes":"deny"')
    expect(
      await readFile(
        join(projectHome, 'caches', 'ctx-pi-prepare', 'session-a', 'adapter-pi', 'oneworks-permissions.mjs'),
        'utf8'
      )
    ).toContain('ONE_TIME = new Map(Object.entries({"review_changes":{"decision":"deny","key":"reviewchanges"}}))')

    await writeFile(join(sharedAgentDir, 'auth.json'), '{"anthropic":{"token":"refreshed"}}\n')
    const second = await preparePiSession(ctx, options('session-a', 'resume'), 'stream')

    expect(second.spawnEnv.PI_CODING_AGENT_DIR).toBe(sharedAgentDir)
    expect(await readFile(join(sharedAgentDir, 'auth.json'), 'utf8')).toContain('refreshed')
    expect(
      await readFile(
        join(projectHome, 'caches', 'ctx-pi-prepare', 'session-a', 'adapter-pi', 'oneworks-permissions.mjs'),
        'utf8'
      )
    ).toContain('"review_changes":"deny"')
  })

  it('atomically claims a serverless allow_once for only one concurrent Pi process', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-pi-prepare-once-'))
    tempDirs.push(root)
    const cwd = join(root, 'workspace')
    const projectHome = join(root, 'project-home')
    await mkdir(cwd, { recursive: true })
    const createCtx = (ctxId: string): AdapterCtx => ({
      ctxId,
      cwd,
      env: {
        __ONEWORKS_PROJECT_ADAPTER_PI_CLI_PATH__: join(root, 'pi'),
        __ONEWORKS_PROJECT_HOME_PROJECT_DIR__: projectHome,
        __ONEWORKS_PROJECT_REAL_HOME__: join(root, 'real-home')
      },
      cache: { get: async () => undefined, set: async () => ({ cachePath: '' }) },
      logger: {
        stream: new PassThrough(),
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        debug: () => undefined
      },
      configs: [{ adapters: { pi: {} } }, undefined]
    } as AdapterCtx)
    const sessionId = 'session-claim'
    const mirrorPath = resolvePermissionMirrorPath(cwd, 'pi', sessionId, createCtx('first').env)
    await mkdir(dirname(mirrorPath), { recursive: true })
    await writeFile(
      mirrorPath,
      JSON.stringify({
        adapter: 'pi',
        sessionId,
        permissionState: { allow: ['Read'], deny: ['Write'], onceAllow: ['Bash', 'Read'], onceDeny: ['Edit'] },
        projectPermissions: { allow: ['Read'], deny: [], ask: [] }
      })
    )
    const options: AdapterQueryOptions = {
      type: 'create',
      runtime: 'cli',
      sessionId,
      model: 'default',
      permissionMode: 'dontAsk',
      tools: { include: ['bash', 'read', 'edit'] },
      onEvent: () => undefined
    }

    await Promise.all([
      preparePiSession(createCtx('first'), options, 'stream'),
      preparePiSession(createCtx('second'), options, 'direct')
    ])

    const sources = await Promise.all(['first', 'second'].map(ctxId =>
      readFile(
        join(projectHome, 'caches', ctxId, sessionId, 'adapter-pi', 'oneworks-permissions.mjs'),
        'utf8'
      )
    ))
    expect(sources.filter(source => source.includes('"bash":{"decision":"allow","key":"Bash"}'))).toHaveLength(1)
    expect(sources.filter(source => source.includes('"edit":{"decision":"deny","key":"Edit"}'))).toHaveLength(2)
    const mirror = JSON.parse(await readFile(mirrorPath, 'utf8'))
    expect(mirror.permissionState).toEqual({
      allow: ['Read'],
      deny: ['Write'],
      onceAllow: [],
      onceDeny: ['Edit']
    })
    expect(mirror.projectPermissions).toEqual({ allow: ['Read'], deny: [], ask: [] })
    expect((await stat(dirname(mirrorPath))).mode & 0o777).toBe(0o700)
    expect((await stat(mirrorPath)).mode & 0o777).toBe(0o600)
    await expect(stat(`${mirrorPath}.lock`)).rejects.toMatchObject({ code: 'ENOENT' })

    // A process that claimed allow_once but crashed before spawn cannot authorize it after restart.
    await preparePiSession(createCtx('restarted'), options, 'stream')
    await expect(readFile(
      join(projectHome, 'caches', 'restarted', sessionId, 'adapter-pi', 'oneworks-permissions.mjs'),
      'utf8'
    )).resolves.not.toContain('"bash":{"decision":"allow","key":"Bash"}')
  })

  it('does not read a corrupt permission mirror when a live server is configured', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-pi-prepare-server-'))
    tempDirs.push(root)
    const cwd = join(root, 'workspace')
    const projectHome = join(root, 'project-home')
    await mkdir(cwd, { recursive: true })
    const ctx = {
      ctxId: 'ctx-server',
      cwd,
      env: {
        __ONEWORKS_PROJECT_ADAPTER_PI_CLI_PATH__: join(root, 'pi'),
        __ONEWORKS_PROJECT_HOME_PROJECT_DIR__: projectHome,
        __ONEWORKS_PROJECT_REAL_HOME__: join(root, 'real-home'),
        __ONEWORKS_PROJECT_SERVER_HOST__: '127.0.0.1',
        __ONEWORKS_PROJECT_SERVER_PORT__: '8787'
      },
      cache: { get: async () => undefined, set: async () => ({ cachePath: '' }) },
      logger: {
        stream: new PassThrough(),
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        debug: () => undefined
      },
      configs: [{ adapters: { pi: {} } }, undefined]
    } as AdapterCtx
    const mirrorPath = resolvePermissionMirrorPath(cwd, 'pi', 'session-server', ctx.env)
    await mkdir(dirname(mirrorPath), { recursive: true })
    await writeFile(mirrorPath, '{corrupt')

    await expect(preparePiSession(ctx, {
      type: 'create',
      runtime: 'cli',
      sessionId: 'session-server',
      model: 'default',
      permissionMode: 'dontAsk',
      onEvent: () => undefined
    }, 'stream')).resolves.toBeDefined()
    await expect(readFile(mirrorPath, 'utf8')).resolves.toBe('{corrupt')
    await expect(
      readFile(
        join(projectHome, 'caches', 'ctx-server', 'session-server', 'adapter-pi', 'oneworks-permissions.mjs'),
        'utf8'
      )
    )
      .resolves.not.toContain('"decision"')
  })

  it('inherits auth only from the exact whitespace-bearing native agent directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-pi-agent-path-'))
    tempDirs.push(root)
    const cwd = join(root, 'workspace')
    const projectHome = join(root, 'project-home')
    const exactAgentDir = join(root, 'agent ')
    const adjacentAgentDir = join(root, 'agent')
    await mkdir(cwd, { recursive: true })
    await mkdir(exactAgentDir, { recursive: true })
    await mkdir(adjacentAgentDir, { recursive: true })
    await writeFile(join(exactAgentDir, 'auth.json'), '{"owner":"exact"}\n')
    await writeFile(join(adjacentAgentDir, 'auth.json'), '{"owner":"adjacent"}\n')
    const ctx = {
      ctxId: 'ctx-pi-path',
      cwd,
      env: {
        __ONEWORKS_PROJECT_ADAPTER_PI_AGENT_DIR__: exactAgentDir,
        __ONEWORKS_PROJECT_ADAPTER_PI_CLI_PATH__: join(root, 'pi'),
        __ONEWORKS_PROJECT_HOME_PROJECT_DIR__: projectHome,
        __ONEWORKS_PROJECT_REAL_HOME__: join(root, 'real-home')
      },
      cache: { get: async () => undefined, set: async () => ({ cachePath: '' }) },
      logger: {
        stream: new PassThrough(),
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        debug: () => undefined
      },
      configs: [{ adapters: { pi: {} } }, undefined]
    } as AdapterCtx

    const prepared = await preparePiSession(ctx, {
      type: 'create',
      runtime: 'cli',
      sessionId: 'path-session',
      model: 'default',
      permissionMode: 'dontAsk',
      onEvent: () => undefined
    }, 'stream')

    expect(await readFile(join(prepared.spawnEnv.PI_CODING_AGENT_DIR, 'auth.json'), 'utf8')).toContain('exact')
  })
})
