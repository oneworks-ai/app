import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, parse } from 'node:path'
import process from 'node:process'

import { afterEach, describe, expect, it } from 'vitest'

import { resolveProjectHomePath } from '@oneworks/utils/ai-path'

import {
  DEFAULT_RUNTIME_PROTOCOL_VERSION,
  DEFAULT_SUPPORTED_PROTOCOL_RANGE,
  RuntimeCommandPriority,
  RuntimeCommandSchema,
  createFileRuntimeStore,
  isRuntimeOwnerStale,
  orderRuntimeCommands,
  resolveRuntimeRoot,
  selectNextRuntimeCommand
} from '#~/index.js'
import type { RuntimeCommand, RuntimeOwnerMetadata } from '#~/index.js'

const tempDirs: string[] = []

const createTempRoot = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ow-runtime-store-'))
  tempDirs.push(dir)
  return dir
}

const command = (
  id: string,
  type: RuntimeCommand['type'],
  priority: number,
  ts: number
): RuntimeCommand => ({
  protocolVersion: DEFAULT_RUNTIME_PROTOCOL_VERSION,
  supportedProtocolRange: DEFAULT_SUPPORTED_PROTOCOL_RANGE,
  id,
  ts,
  sessionId: 'sess_1',
  type,
  priority,
  source: 'test'
})

describe('runtime store', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  })

  it('appends concurrent commands from multiple writers without requiring owner lock', async () => {
    const store = await createFileRuntimeStore(await createTempRoot())
    const session = await store.createSession({
      protocolVersion: DEFAULT_RUNTIME_PROTOCOL_VERSION,
      supportedProtocolRange: DEFAULT_SUPPORTED_PROTOCOL_RANGE,
      sessionId: 'sess_1',
      title: 'Concurrent commands',
      createdAt: Date.now()
    })
    const owner = await session.acquireOwnerLock('runtime_1')

    try {
      await Promise.all([
        session.appendCommand(command('cmd_a', 'send_message', RuntimeCommandPriority.message, 1)),
        session.appendCommand(command('cmd_b', 'send_message', RuntimeCommandPriority.message, 2))
      ])
    } finally {
      await owner.release()
    }

    const commands = await session.readCommands()
    expect(commands.map(item => item.id).sort()).toEqual(['cmd_a', 'cmd_b'])
    expect(await session.readOwnerLock()).toBeUndefined()
  })

  it('serializes command appends as complete jsonl lines', async () => {
    const store = await createFileRuntimeStore(await createTempRoot())
    const session = await store.createSession({
      protocolVersion: DEFAULT_RUNTIME_PROTOCOL_VERSION,
      supportedProtocolRange: DEFAULT_SUPPORTED_PROTOCOL_RANGE,
      sessionId: 'sess_1',
      createdAt: Date.now()
    })

    await Promise.all(Array.from({ length: 20 }, (_, index) => {
      return session.appendCommand(command(`cmd_${index}`, 'send_message', 20, index))
    }))

    const raw = await readFile(join(session.sessionPath, 'commands.jsonl'), 'utf8')
    const lines = raw.trimEnd().split('\n')
    expect(lines).toHaveLength(20)
    expect(lines.every(line => JSON.parse(line).id.startsWith('cmd_'))).toBe(true)
  })

  it('re-exports the protocol command schema used by CLI command writers', () => {
    const parsed = RuntimeCommandSchema.parse({
      protocolVersion: DEFAULT_RUNTIME_PROTOCOL_VERSION,
      supportedProtocolRange: DEFAULT_SUPPORTED_PROTOCOL_RANGE,
      id: 'cmd_send',
      ts: 1,
      sessionId: 'sess_1',
      type: 'send_message',
      priority: RuntimeCommandPriority.message,
      source: 'cli',
      content: 'Continue verification.',
      value: 'allow_once',
      futureField: {
        preserved: true
      }
    })

    expect(parsed.content).toBe('Continue verification.')
    expect(parsed.value).toBe('allow_once')
    expect(parsed.futureField).toEqual({ preserved: true })
  })

  it('orders scheduler commands by priority, timestamp, and append order', () => {
    const commands = [
      command('message_2', 'send_message', 20, 2),
      command('message_1', 'send_message', 20, 1),
      command('stop', 'stop', 0, 3),
      command('approve', 'submit_input', 10, 4)
    ]

    expect(orderRuntimeCommands(commands).map(item => item.id)).toEqual([
      'stop',
      'approve',
      'message_1',
      'message_2'
    ])
    expect(selectNextRuntimeCommand(commands, { activeCommandId: 'message_1' })?.id).toBe('stop')
    expect(selectNextRuntimeCommand(commands.filter(item => item.id !== 'stop'), {
      activeCommandId: 'message_1'
    })).toBeUndefined()
  })

  it('detects stale owner metadata only after age and dead pid checks pass', () => {
    const stale: RuntimeOwnerMetadata = {
      runtimeId: 'runtime_stale',
      pid: 999_999_999,
      host: 'localhost',
      createdAt: 1,
      updatedAt: 1
    }
    const fresh: RuntimeOwnerMetadata = {
      ...stale,
      updatedAt: Date.now()
    }
    const oldButAlive: RuntimeOwnerMetadata = {
      ...stale,
      pid: process.pid
    }

    expect(isRuntimeOwnerStale(stale, { staleMs: 1 })).toBe(true)
    expect(isRuntimeOwnerStale(fresh, { staleMs: 60_000 })).toBe(false)
    expect(isRuntimeOwnerStale(oldButAlive, { staleMs: 1 })).toBe(false)
  })

  it('replays events with stable monotonic seq and tails by byte offset', async () => {
    const store = await createFileRuntimeStore(await createTempRoot())
    const session = await store.createSession({
      protocolVersion: DEFAULT_RUNTIME_PROTOCOL_VERSION,
      supportedProtocolRange: DEFAULT_SUPPORTED_PROTOCOL_RANGE,
      sessionId: 'sess_1',
      createdAt: Date.now()
    })

    await session.appendEvent({
      protocolVersion: DEFAULT_RUNTIME_PROTOCOL_VERSION,
      id: 'evt_1',
      ts: 1,
      sessionId: 'sess_1',
      type: 'session_started'
    })
    await session.appendEvent({
      protocolVersion: DEFAULT_RUNTIME_PROTOCOL_VERSION,
      id: 'evt_2',
      ts: 2,
      sessionId: 'sess_1',
      type: 'message'
    })

    expect((await session.replayEvents()).map(event => event.seq)).toEqual([1, 2])
    const firstTail = await session.tailEvents()
    expect(firstTail.records.map(event => event.id)).toEqual(['evt_1', 'evt_2'])
    expect(await session.tailEvents(firstTail.nextOffset)).toEqual({
      nextOffset: firstTail.nextOffset,
      records: []
    })
  })

  it('updates and reads index entries', async () => {
    const root = await createTempRoot()
    const store = await createFileRuntimeStore(root)
    await Promise.all([
      store.updateIndex('sess_1', {
        storePath: 'sessions/sess_1',
        cwd: '/repo',
        status: 'running',
        updatedAt: 1
      }),
      store.updateIndex('sess_2', {
        storePath: 'sessions/sess_2',
        cwd: '/repo',
        status: 'starting',
        updatedAt: 2
      })
    ])

    expect(await store.readIndex()).toMatchObject({
      sessions: {
        sess_1: {
          storePath: 'sessions/sess_1',
          status: 'running'
        },
        sess_2: {
          storePath: 'sessions/sess_2',
          status: 'starting'
        }
      }
    })
  })

  it('deletes a session directory and removes it from the index', async () => {
    const root = await createTempRoot()
    const store = await createFileRuntimeStore(root)
    const session = await store.createSession({
      protocolVersion: DEFAULT_RUNTIME_PROTOCOL_VERSION,
      supportedProtocolRange: DEFAULT_SUPPORTED_PROTOCOL_RANGE,
      sessionId: 'sess_1',
      title: 'Delete me',
      createdAt: 1
    })
    await session.appendEvent({
      protocolVersion: DEFAULT_RUNTIME_PROTOCOL_VERSION,
      id: 'evt_1',
      ts: 1,
      sessionId: 'sess_1',
      type: 'session_started'
    })

    await store.deleteSession('sess_1')

    await expect(readFile(join(session.sessionPath, 'events.jsonl'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
    expect((await store.readIndex()).sessions.sess_1).toBeUndefined()
  })

  it('reads and writes session metadata, state, and heartbeat', async () => {
    const store = await createFileRuntimeStore(await createTempRoot())
    const session = await store.createSession({
      protocolVersion: DEFAULT_RUNTIME_PROTOCOL_VERSION,
      supportedProtocolRange: DEFAULT_SUPPORTED_PROTOCOL_RANGE,
      sessionId: 'sess_1',
      title: 'Stateful session',
      createdAt: 1
    })

    await session.writeState({
      protocolVersion: DEFAULT_RUNTIME_PROTOCOL_VERSION,
      supportedProtocolRange: DEFAULT_SUPPORTED_PROTOCOL_RANGE,
      sessionId: 'sess_1',
      status: 'running',
      lastSeq: 2,
      updatedAt: 3
    })
    await session.writeHeartbeat({
      protocolVersion: DEFAULT_RUNTIME_PROTOCOL_VERSION,
      supportedProtocolRange: DEFAULT_SUPPORTED_PROTOCOL_RANGE,
      sessionId: 'sess_1',
      runtimeId: 'runtime_1',
      status: 'running',
      updatedAt: 4
    })

    expect(await session.readMeta()).toMatchObject({ sessionId: 'sess_1', title: 'Stateful session' })
    expect(await session.readState()).toMatchObject({ status: 'running', lastSeq: 2 })
    expect(await session.readHeartbeat()).toMatchObject({ runtimeId: 'runtime_1' })
  })

  it('discovers runtime root from project env, project, then user home', async () => {
    const project = await createTempRoot()
    const home = await createTempRoot()
    const customAiBaseDir = join(project, 'custom-ai')

    await writeFile(join(project, 'package.json'), '{"name":"project"}', 'utf8')

    await expect(resolveRuntimeRoot({
      cwd: project,
      env: { __ONEWORKS_PROJECT_BASE_DIR__: customAiBaseDir },
      homeDir: home
    })).resolves.toBe(resolveProjectHomePath(project, {
      __ONEWORKS_PROJECT_BASE_DIR__: customAiBaseDir,
      HOME: home
    }, 'runtime'))
    await expect(resolveRuntimeRoot({ cwd: project, env: {}, homeDir: home })).resolves.toBe(
      resolveProjectHomePath(project, { HOME: home }, 'runtime')
    )
    await expect(resolveRuntimeRoot({ cwd: parse(project).root, env: {}, homeDir: home })).resolves.toBe(
      join(home, '.oneworks', 'runtime')
    )
  })

  it('follows the project AI base dir env when resolving runtime root', async () => {
    const project = await createTempRoot()
    const launchCwd = join(project, 'business_modules', 'Miniapp')
    const home = await createTempRoot()

    await mkdir(launchCwd, { recursive: true })
    await writeFile(join(project, 'package.json'), '{"name":"project"}', 'utf8')

    await expect(resolveRuntimeRoot({
      cwd: project,
      env: {
        __ONEWORKS_PROJECT_BASE_DIR__: '.iac/ai',
        __ONEWORKS_PROJECT_BASE_DIR_RESOLVE_CWD__: launchCwd
      },
      homeDir: home
    })).resolves.toBe(resolveProjectHomePath(project, {
      __ONEWORKS_PROJECT_BASE_DIR__: '.iac/ai',
      __ONEWORKS_PROJECT_BASE_DIR_RESOLVE_CWD__: launchCwd,
      HOME: home
    }, 'runtime'))
  })

  it('uses the primary workspace for project runtime roots across worktrees', async () => {
    const primary = await createTempRoot()
    const worktree = await createTempRoot()
    const home = await createTempRoot()

    await expect(resolveRuntimeRoot({
      cwd: worktree,
      env: {
        __ONEWORKS_PROJECT_LAUNCH_CWD__: worktree,
        __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: worktree,
        __ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__: primary
      },
      homeDir: home
    })).resolves.toBe(resolveProjectHomePath(worktree, {
      __ONEWORKS_PROJECT_LAUNCH_CWD__: worktree,
      __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: worktree,
      __ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__: primary,
      HOME: home
    }, 'runtime'))
  })

  it('scopes inherited project env to the requested runtime cwd', async () => {
    const workspaceA = await createTempRoot()
    const workspaceB = await createTempRoot()
    const home = await createTempRoot()
    const env = {
      __ONEWORKS_PROJECT_LAUNCH_CWD__: workspaceA,
      __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: workspaceA,
      __ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__: workspaceA
    }

    await expect(resolveRuntimeRoot({ cwd: workspaceB, env, homeDir: home })).resolves.toBe(
      resolveProjectHomePath(workspaceB, {
        __ONEWORKS_PROJECT_LAUNCH_CWD__: workspaceB,
        __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: workspaceB,
        __ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__: workspaceB,
        HOME: home
      }, 'runtime')
    )
  })

  it('drops inherited exact project-home dirs when scoping to another runtime cwd', async () => {
    const workspaceA = await createTempRoot()
    const workspaceB = await createTempRoot()
    const home = await createTempRoot()
    const env = {
      __ONEWORKS_PROJECT_LAUNCH_CWD__: workspaceA,
      __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: workspaceA,
      __ONEWORKS_PROJECT_HOME_PROJECT_DIR__: 'workspace-a-home'
    }

    await expect(resolveRuntimeRoot({ cwd: workspaceB, env, homeDir: home })).resolves.toBe(
      resolveProjectHomePath(workspaceB, {
        __ONEWORKS_PROJECT_LAUNCH_CWD__: workspaceB,
        __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: workspaceB,
        __ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__: workspaceB,
        HOME: home
      }, 'runtime')
    )
  })

  it('uses the home project runtime root when only a legacy .oneworks marker exists', async () => {
    const project = await createTempRoot()
    const home = await createTempRoot()

    await mkdir(join(project, '.oneworks'), { recursive: true })

    await expect(resolveRuntimeRoot({ cwd: project, env: {}, homeDir: home })).resolves.toBe(
      resolveProjectHomePath(project, { HOME: home }, 'runtime')
    )
  })

  it('does not backfill stale .oneworks runtime data into the home project runtime root', async () => {
    const project = await createTempRoot()
    const home = await createTempRoot()
    const legacyEventPath = join(project, '.oneworks', 'runtime', 'sessions', 'sess_legacy', 'events.jsonl')

    await mkdir(join(project, '.oneworks'), { recursive: true })
    await mkdir(dirname(legacyEventPath), { recursive: true })
    await writeFile(legacyEventPath, '{"type":"legacy"}\n', 'utf8')

    const runtimeRoot = await resolveRuntimeRoot({ cwd: project, env: {}, homeDir: home })

    expect(runtimeRoot).toBe(resolveProjectHomePath(project, { HOME: home }, 'runtime'))
    await expect(readFile(join(runtimeRoot, 'sessions', 'sess_legacy', 'events.jsonl'), 'utf8')).rejects
      .toMatchObject({ code: 'ENOENT' })
    await expect(readFile(legacyEventPath, 'utf8')).resolves.toBe('{"type":"legacy"}\n')
  })

  it('ignores a malformed trailing partial jsonl line during replay', async () => {
    const store = await createFileRuntimeStore(await createTempRoot())
    const session = await store.createSession({
      protocolVersion: DEFAULT_RUNTIME_PROTOCOL_VERSION,
      supportedProtocolRange: DEFAULT_SUPPORTED_PROTOCOL_RANGE,
      sessionId: 'sess_1',
      createdAt: Date.now()
    })
    await writeFile(
      join(session.sessionPath, 'events.jsonl'),
      '{"protocolVersion":"1.0.0","id":"evt_1","seq":1,"ts":1,"sessionId":"sess_1","type":"ok"}\n{"broken":',
      'utf8'
    )

    expect((await session.replayEvents()).map(event => event.id)).toEqual(['evt_1'])
  })
})
