import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { dirname, join, parse } from 'node:path'
import process from 'node:process'

import { afterEach, describe, expect, it } from 'vitest'

import { resolveProjectHomePath } from '@oneworks/utils/ai-path'

import {
  DEFAULT_RUNTIME_PROTOCOL_VERSION,
  DEFAULT_SUPPORTED_PROTOCOL_RANGE,
  RuntimeCommandPriority,
  RuntimeCommandSchema,
  RuntimeStoreLockError,
  acquireLockFile,
  acquireLockFiles,
  createFileRuntimeStore,
  buildProjectConfigRecoveryIdempotencyKey,
  projectConfigRecoveryGrantsFromEvents,
  isAuthenticProjectConfigRecovery,
  projectConfigRecoveryPayloadDigest,
  isRuntimeOwnerStale,
  orderRuntimeCommands,
  resolveRuntimeRoot,
  selectNextRuntimeCommand
} from '#~/index.js'
import type { RuntimeCommand, RuntimeEvent, RuntimeOwnerMetadata } from '#~/index.js'

const tempDirs: string[] = []

const createTempRoot = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ow-runtime-store-'))
  tempDirs.push(dir)
  return dir
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const command = (
  id: string,
  type: RuntimeCommand['type'],
  priority: number,
  ts: number
): RuntimeCommand => {
  const common = {
    protocolVersion: DEFAULT_RUNTIME_PROTOCOL_VERSION,
    supportedProtocolRange: DEFAULT_SUPPORTED_PROTOCOL_RANGE,
    id,
    ts,
    sessionId: 'sess_1',
    priority,
    source: 'test' as const
  }

  switch (type) {
    case 'start':
    case 'resume':
    case 'send_message':
      return RuntimeCommandSchema.parse({
        ...common,
        type,
        content: `payload for ${id}`
      })
    default:
      return RuntimeCommandSchema.parse({ ...common, type })
  }
}

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

  it('re-exports the strict protocol command schema used by CLI command writers', () => {
    const parsed = RuntimeCommandSchema.parse({
      protocolVersion: DEFAULT_RUNTIME_PROTOCOL_VERSION,
      supportedProtocolRange: DEFAULT_SUPPORTED_PROTOCOL_RANGE,
      id: 'cmd_send',
      ts: 1,
      sessionId: 'sess_1',
      type: 'send_message',
      priority: RuntimeCommandPriority.message,
      source: 'cli',
      content: 'Continue verification.'
    })

    expect(parsed.content).toBe('Continue verification.')
    expect(RuntimeCommandSchema.safeParse({
      ...parsed,
      value: 'allow_once'
    }).success).toBe(false)
    expect(RuntimeCommandSchema.safeParse({
      ...parsed,
      futureField: { rejected: true }
    }).success).toBe(false)
    expect(RuntimeCommandSchema.safeParse({
      protocolVersion: DEFAULT_RUNTIME_PROTOCOL_VERSION,
      id: 'cmd-structured-start',
      ts: 1,
      sessionId: 'sess_1',
      type: 'start',
      priority: 20,
      source: 'server',
      description: 'Structured entity launch'
    }).success).toBe(true)
    expect(RuntimeCommandSchema.safeParse({
      ...parsed,
      contentItems: [{ type: 'tool_use', id: 'tool', name: 'x', input: () => undefined }]
    }).success).toBe(false)
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
    const recentButAlive: RuntimeOwnerMetadata = {
      ...stale,
      pid: process.pid,
      createdAt: Date.now()
    }

    expect(isRuntimeOwnerStale(stale, { staleMs: 1 })).toBe(true)
    expect(isRuntimeOwnerStale(fresh, { staleMs: 60_000 })).toBe(false)
    expect(isRuntimeOwnerStale(recentButAlive, { staleMs: 1 })).toBe(false)
    expect(isRuntimeOwnerStale(
      {
        ...stale,
        host: hostname(),
        pid: process.pid,
        processStartedAt: Math.round(Date.now() - process.uptime() * 1_000)
      },
      { liveOwnerGraceMs: 10, staleMs: 1 }
    )).toBe(false)
  })

  it('renews active locks across stale and timeout boundaries without allowing theft', async () => {
    const root = await createTempRoot()
    const lockPath = join(root, 'locks', 'events.append.lock')
    const first = await acquireLockFile(lockPath, { operation: 'first' }, {
      staleMs: 30,
      timeoutMs: 100
    })
    await wait(80)

    let secondAcquired = false
    const secondPromise = acquireLockFile(lockPath, { operation: 'second' }, {
      staleMs: 30,
      timeoutMs: 5_000
    }).then((lock) => {
      secondAcquired = true
      return lock
    })
    await wait(2_100)
    expect(secondAcquired).toBe(false)

    await first.release()
    const second = await secondPromise
    expect(secondAcquired).toBe(true)
    await second.release()
  })

  it('observes only complete metadata while a cross-process owner renews beyond staleMs', async () => {
    const root = await createTempRoot()
    const lockPath = join(root, 'locks', 'cross-process.lock')
    const workerPath = join(
      process.cwd(),
      'packages/runtime-store/__tests__/fixtures/lock-owner.mjs'
    )
    const child = spawn(process.execPath, [
      '--experimental-strip-types',
      workerPath,
      lockPath,
      '30'
    ], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe']
    })
    await new Promise<void>((resolve, reject) => {
      child.stdout.once('data', chunk => {
        if (String(chunk).includes('READY')) resolve()
      })
      child.once('error', reject)
      child.once('exit', code => {
        if (code !== 0) reject(new Error(`lock owner exited early: ${code}`))
      })
    })

    const contenderPromise = acquireLockFile(lockPath, { operation: 'contender' }, {
      staleMs: 30,
      timeoutMs: 1_000
    })
    for (let index = 0; index < 20; index += 1) {
      const parsed = JSON.parse(await readFile(lockPath, 'utf8')) as { ownerId?: string }
      expect(parsed.ownerId).toEqual(expect.any(String))
      await wait(5)
    }
    child.stdin.write('release\n')
    const contender = await contenderPromise
    await contender.assertOwned()
    await contender.release()
  })

  it('cleans a crashed quarantine artifact without removing a replacement owner', async () => {
    const root = await createTempRoot()
    const lockPath = join(root, 'locks', 'events.append.lock')
    await mkdir(dirname(lockPath), { recursive: true })
    const orphanPath = `${lockPath}.999999.dead.quarantine`
    await writeFile(orphanPath, JSON.stringify({
      ownerId: 'dead-owner',
      pid: 999_999_999,
      createdAt: 1,
      updatedAt: 1
    }))
    const replacement = await acquireLockFile(lockPath, { operation: 'replacement' }, {
      autoRefresh: false
    })
    await replacement.assertOwned()
    await expect(stat(orphanPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await replacement.release()
  })

  it('cleans stale create/tmp/quarantine/reclaimer artifacts when a PID was reused', async () => {
    const root = await createTempRoot()
    const lockPath = join(root, 'locks', 'pid-reuse.lock')
    await mkdir(dirname(lockPath), { recursive: true })
    const deadGeneration = {
      ownerId: 'dead-pid-reuse',
      pid: process.pid,
      host: hostname(),
      // A real current PID with an impossible old start identity models PID reuse.
      processStartedAt: -1,
      createdAt: 1,
      updatedAt: 1
    }
    const artifacts = [
      `${lockPath}.${process.pid}.dead.create`,
      `${lockPath}.dead.tmp`,
      `${lockPath}.dead.quarantine`,
      `${lockPath}.reclaim.dead`
    ]
    await Promise.all(artifacts.map(artifact => writeFile(artifact, JSON.stringify(deadGeneration))))

    const lock = await acquireLockFile(lockPath, { operation: 'pid-reuse-cleanup' }, {
      autoRefresh: false,
      staleMs: 5,
      timeoutMs: 500
    })
    await lock.assertOwned()
    await expect(Promise.all(artifacts.map(async artifact => stat(artifact)))).rejects.toBeDefined()
    await lock.release()
  })

  it('keeps refresh and release owner-token-safe after ownership is replaced', async () => {
    const root = await createTempRoot()
    const lockPath = join(root, 'locks', 'commands.append.lock')
    const lock = await acquireLockFile(lockPath, { operation: 'original' }, {
      autoRefresh: false
    })
    const replacementPath = `${lockPath}.replacement`
    await writeFile(replacementPath, JSON.stringify({
      ownerId: 'replacement-owner',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }))
    await rename(replacementPath, lockPath)

    await expect(lock.refresh()).rejects.toBeInstanceOf(RuntimeStoreLockError)
    await lock.release()
    expect(JSON.parse(await readFile(lockPath, 'utf8')).ownerId).toBe('replacement-owner')
  })

  it('recovers an abandoned corrupt lock without treating an atomic refresh as corruption', async () => {
    const root = await createTempRoot()
    const lockPath = join(root, 'locks', 'state.write.lock')
    await mkdir(dirname(lockPath), { recursive: true })
    await writeFile(lockPath, '{"ownerId":')

    const recovered = await acquireLockFile(lockPath, { operation: 'recovered' }, {
      autoRefresh: false,
      staleMs: 1,
      timeoutMs: 200
    })
    await recovered.assertOwned()
    expect(JSON.parse(await readFile(lockPath, 'utf8'))).toEqual(expect.objectContaining({
      operation: 'recovered',
      ownerId: expect.any(String)
    }))
    await recovered.release()
  })

  it('coordinates two reclaimers behind unique barriers and cleans a crashed reclaimer', async () => {
    const root = await createTempRoot()
    const lockPath = join(root, 'locks', 'reclaim-race.lock')
    await mkdir(dirname(lockPath), { recursive: true })
    await writeFile(lockPath, JSON.stringify({
      ownerId: 'dead-generation',
      pid: 999_999_999,
      host: hostname(),
      processStartedAt: 1,
      createdAt: 1,
      updatedAt: 1
    }))
    await writeFile(`${lockPath}.reclaim.crashed`, JSON.stringify({
      ownerId: 'crashed-reclaimer',
      pid: 999_999_999,
      host: hostname(),
      processStartedAt: 1,
      createdAt: 1,
      updatedAt: 1
    }))

    const workerPath = join(
      process.cwd(),
      'packages/runtime-store/__tests__/fixtures/lock-owner.mjs'
    )
    const spawnContender = (mode?: string) => spawn(process.execPath, [
      '--experimental-strip-types',
      workerPath,
      lockPath,
      '1',
      ...(mode == null ? [] : [mode])
    ], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe']
    })
    const first = spawnContender('pause-reclaimer')
    await new Promise<void>((resolve, reject) => {
      first.stdout.on('data', (chunk) => {
        if (String(chunk).includes('BARRIER')) resolve()
      })
      first.once('error', reject)
    })
    const second = spawnContender()
    let secondReady = false
    second.stdout.on('data', (chunk) => {
      if (String(chunk).includes('READY')) secondReady = true
    })
    await wait(50)
    expect(secondReady).toBe(false)
    const firstReady = new Promise<void>((resolve) => {
      first.stdout.on('data', (chunk) => {
        if (String(chunk).includes('READY')) resolve()
      })
    })
    first.stdin.write('continue\n')
    await firstReady
    expect(secondReady).toBe(false)
    first.stdin.write('release\n')
    await once(first, 'exit')
    await vi.waitFor(() => expect(secondReady).toBe(true))
    second.stdin.write('release\n')
    await once(second, 'exit')
    expect((await readdir(dirname(lockPath))).filter(name =>
      name.startsWith(`${parse(lockPath).base}.reclaim.`)
    )).toEqual([])
  })

  it('acquires multiple append locks in one canonical order and recovers abandoned owners', async () => {
    const root = await createTempRoot()
    const commandLockPath = join(root, 'locks', 'commands.append.lock')
    const eventLockPath = join(root, 'locks', 'events.append.lock')
    await mkdir(dirname(commandLockPath), { recursive: true })
    await writeFile(commandLockPath, JSON.stringify({
      ownerId: 'crashed-owner',
      pid: process.pid,
      host: hostname(),
      processStartedAt: -1,
      createdAt: 1,
      updatedAt: 1
    }))

    const first = await acquireLockFiles([
      { path: eventLockPath, metadata: { operation: 'first' } },
      { path: commandLockPath, metadata: { operation: 'first' } }
    ], {
      liveOwnerGraceMs: 10,
      staleMs: 5,
      timeoutMs: 200
    })
    const waiter = acquireLockFiles([
      { path: commandLockPath, metadata: { operation: 'waiter' } },
      { path: eventLockPath, metadata: { operation: 'waiter' } }
    ], {
      staleMs: 5,
      timeoutMs: 300
    })
    await wait(30)
    await first.release()
    const second = await waiter
    await second.assertOwned()
    await second.release()
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

  it('appends a strict internal recovery grant through the already-held canonical event lock', async () => {
    const store = await createFileRuntimeStore(await createTempRoot())
    const session = await store.createSession({
      protocolVersion: DEFAULT_RUNTIME_PROTOCOL_VERSION,
      supportedProtocolRange: DEFAULT_SUPPORTED_PROTOCOL_RANGE,
      sessionId: 'sess_1', createdAt: 1
    })
    const lock = await acquireLockFile(session.getLockPath('events.append'), { kind: 'events.append' })
    try {
      const event = await session.appendEventAlreadyLocked({
        type: 'project_config_recovery_granted',
        source: 'server:project-config-recovery',
        recoveryGrant: {
          schemaVersion: 1, type: 'project_config_recovery_grant', recoveryCommandId: 'cmd_recovery',
          idempotencyKey: 'key', sessionId: 'sess_1', attemptCommandId: 'cmd_attempt',
          failureEventId: 'evt_failure', failureEventSeq: 1, payloadDigest: 'a'.repeat(64),
          authorizationId: '11111111-1111-4111-8111-111111111111',
          commandIndex: 0,
          workspaceFolder: '/workspace/root', adapter: 'codex', runtimeAdapter: 'codex'
        }
      }, lock)
      expect(event.seq).toBe(1)
      expect(projectConfigRecoveryGrantsFromEvents(await session.replayEvents())).toHaveLength(1)
    } finally { await lock.release() }
  })

  it('never exposes a grant-between-command snapshot to a concurrent bridge reader', async () => {
    const store = await createFileRuntimeStore(await createTempRoot())
    const session = await store.createSession({
      protocolVersion: DEFAULT_RUNTIME_PROTOCOL_VERSION,
      supportedProtocolRange: DEFAULT_SUPPORTED_PROTOCOL_RANGE,
      sessionId: 'sess_1',
      createdAt: 1
    })
    const writer = await session.acquireCommandEventSnapshot('recovery-writer')
    const eventLock = writer.getLock(session.getLockPath('events.append'))!
    const commandLock = writer.getLock(session.getLockPath('commands.append'))!
    const grantEvent = await session.appendEventAlreadyLocked({
      type: 'project_config_recovery_granted',
      source: 'server:project-config-recovery',
      recoveryGrant: {
        schemaVersion: 1,
        type: 'project_config_recovery_grant',
        recoveryCommandId: 'cmd_recovery',
        idempotencyKey: 'key',
        sessionId: 'sess_1',
        attemptCommandId: 'cmd_attempt',
        failureEventId: 'evt_failure',
        failureEventSeq: 1,
        payloadDigest: 'a'.repeat(64),
        authorizationId: '11111111-1111-4111-8111-111111111111',
        commandIndex: 0,
        workspaceFolder: '/workspace/root',
        adapter: 'codex',
        runtimeAdapter: 'codex'
      }
    }, eventLock)

    let readerSettled = false
    const reader = session.readCommandEventSnapshot('bridge-reader').then((value) => {
      readerSettled = true
      return value
    })
    await wait(30)
    expect(readerSettled).toBe(false)

    await session.appendCommandAlreadyLocked({
      protocolVersion: DEFAULT_RUNTIME_PROTOCOL_VERSION,
      id: 'cmd_recovery',
      ts: 2,
      sessionId: 'sess_1',
      type: 'resume',
      priority: 20,
      source: 'project_config_recovery',
      adapter: 'codex',
      content: 'retry',
      messageDelivery: 'bridge',
      projectConfigPolicy: 'global-only',
      recovery: {
        kind: 'codex-project-config',
        attemptCommandId: 'cmd_attempt',
        replacedActivationCommandId: 'cmd_attempt',
        failureEventId: 'evt_failure',
        failureEventSeq: 1,
        idempotencyKey: 'key',
        grantEventId: grantEvent.id,
        grantEventSeq: grantEvent.seq,
        grantAuthorizationId: grantEvent.recoveryGrant!.authorizationId,
        grantCommandIndex: grantEvent.recoveryGrant!.commandIndex
      }
    }, commandLock)
    await writer.release()

    await expect(reader).resolves.toEqual(expect.objectContaining({
      commands: [expect.objectContaining({ id: 'cmd_recovery' })],
      events: [expect.objectContaining({ type: 'project_config_recovery_granted' })]
    }))
  })

  it('reuses only the exact strict server grant after a grant-only crash and restart', () => {
    const workspaceFolder = '/workspace/root'
    const original: RuntimeCommand = {
      protocolVersion: DEFAULT_RUNTIME_PROTOCOL_VERSION,
      id: 'cmd_attempt',
      ts: 100,
      sessionId: 'sess_1',
      type: 'resume',
      priority: 20,
      source: 'web',
      content: 'retry this exact prompt'
    }
    const failure: RuntimeEvent = {
      protocolVersion: DEFAULT_RUNTIME_PROTOCOL_VERSION,
      id: 'evt_failure',
      seq: 1,
      ts: 101,
      sessionId: 'sess_1',
      type: 'session_failed',
      causedByCommandId: original.id,
      code: 'codex_project_config_invalid',
      fatal: true,
      details: {
        adapter: 'codex',
        runtimeAdapter: 'codex',
        configSource: 'project',
        configPath: '.codex/config.toml',
        workspaceSource: 'active-session-workspace',
        workspaceFolder,
        sessionId: 'sess_1',
        reason: 'Invalid wire_api.'
      }
    }
    const idempotencyKey = buildProjectConfigRecoveryIdempotencyKey(
      'sess_1',
      original.id,
      failure.id,
      failure.seq
    )
    const recovery: RuntimeCommand = {
      protocolVersion: DEFAULT_RUNTIME_PROTOCOL_VERSION,
      id: 'cmd_recovery',
      ts: 102,
      sessionId: 'sess_1',
      type: 'resume',
      priority: 20,
      source: 'project_config_recovery',
      adapter: 'codex',
      content: original.content,
      messageDelivery: 'bridge',
      projectConfigPolicy: 'global-only',
      recovery: {
        kind: 'codex-project-config',
        attemptCommandId: original.id,
        replacedActivationCommandId: original.id,
        failureEventId: failure.id,
        failureEventSeq: failure.seq,
        idempotencyKey,
        grantEventId: 'evt_grant',
        grantEventSeq: 2,
        grantAuthorizationId: '11111111-1111-4111-8111-111111111111',
        grantCommandIndex: 1
      }
    }
    const payloadDigest = projectConfigRecoveryPayloadDigest(recovery)!
    const grantEvent: RuntimeEvent = {
      protocolVersion: DEFAULT_RUNTIME_PROTOCOL_VERSION,
      id: 'evt_grant',
      seq: 2,
      ts: 102,
      sessionId: 'sess_1',
      type: 'project_config_recovery_granted',
      source: 'server:project-config-recovery',
      recoveryGrant: {
        schemaVersion: 1,
        type: 'project_config_recovery_grant',
        recoveryCommandId: recovery.id,
        idempotencyKey,
        sessionId: 'sess_1',
        attemptCommandId: original.id,
        failureEventId: failure.id,
        failureEventSeq: failure.seq,
        payloadDigest,
        authorizationId: '11111111-1111-4111-8111-111111111111',
        commandIndex: 1,
        workspaceFolder,
        adapter: 'codex',
        runtimeAdapter: 'codex'
      }
    }
    const authority = {
      workspaceFolder,
      adapter: 'codex',
      runtimeAdapter: 'codex' as const,
      sessionId: 'sess_1'
    }

    // Grant-before-command crash is durable but inert until the exact command appears.
    expect(projectConfigRecoveryGrantsFromEvents([failure, grantEvent])).toHaveLength(1)
    expect(isAuthenticProjectConfigRecovery(
      { ...recovery, id: 'different-command' },
      [original],
      [failure, grantEvent],
      authority
    )).toBe(false)

    const restartedEvents = JSON.parse(JSON.stringify([failure, grantEvent])) as RuntimeEvent[]
    const restartedCommands = JSON.parse(JSON.stringify([original, recovery])) as RuntimeCommand[]
    expect(isAuthenticProjectConfigRecovery(
      recovery,
      restartedCommands,
      restartedEvents,
      authority
    )).toBe(true)

    for (const mismatch of [
      { ...authority, workspaceFolder: '/workspace/forged' },
      { ...authority, adapter: 'claude-code' }
    ]) {
      expect(isAuthenticProjectConfigRecovery(
        recovery,
        restartedCommands,
        restartedEvents,
        mismatch
      )).toBe(false)
    }
    expect(projectConfigRecoveryGrantsFromEvents([
      failure,
      { ...grantEvent, recoveryGrant: { ...(grantEvent.recoveryGrant as object), extra: true } }
    ])).toHaveLength(0)
    expect(isAuthenticProjectConfigRecovery(
      { ...recovery, content: 'forged payload' },
      restartedCommands,
      restartedEvents,
      authority
    )).toBe(false)
    for (const detailsOverride of [
      { runtimeAdapter: 'claude-code' },
      { configSource: 'global' },
      { configPath: '../forged.toml' },
      { workspaceSource: 'client-supplied' },
      { sessionId: 'sess_forged' }
    ]) {
      const mismatchedFailure = {
        ...failure,
        details: {
          ...(failure as RuntimeEvent & { details: Record<string, unknown> }).details,
          ...detailsOverride
        }
      } as RuntimeEvent
      expect(isAuthenticProjectConfigRecovery(
        recovery,
        restartedCommands,
        [mismatchedFailure, grantEvent],
        authority
      )).toBe(false)
    }
  })

  it('uses causal grant identity plus append index for authenticity and supersession', () => {
    const original = command('cmd_attempt', 'resume', 20, 999)
    const failure = {
      protocolVersion: DEFAULT_RUNTIME_PROTOCOL_VERSION,
      id: 'evt_failure',
      seq: 1,
      ts: 1,
      sessionId: 'sess_1',
      type: 'session_failed',
      causedByCommandId: original.id,
      code: 'codex_project_config_invalid',
      fatal: true,
      details: {
        adapter: 'codex', runtimeAdapter: 'codex', configSource: 'project',
        configPath: '.codex/config.toml', workspaceSource: 'active-session-workspace',
        workspaceFolder: '/workspace/root', sessionId: 'sess_1',
        reason: 'Invalid TOML.'
      }
    } as RuntimeEvent
    const idempotencyKey = buildProjectConfigRecoveryIdempotencyKey(
      'sess_1',
      original.id,
      failure.id,
      failure.seq
    )
    const makeRecovery = (
      id: string,
      grantEventId: string,
      grantEventSeq: number,
      grantAuthorizationId: string,
      grantCommandIndex: number
    ) => ({
      ...command(id, 'resume', 20, 1),
      source: 'project_config_recovery',
      adapter: 'codex',
      content: original.content,
      messageDelivery: 'bridge',
      projectConfigPolicy: 'global-only',
      recovery: {
        kind: 'codex-project-config' as const,
        attemptCommandId: original.id,
        replacedActivationCommandId: original.id,
        failureEventId: failure.id,
        failureEventSeq: failure.seq,
        idempotencyKey,
        grantEventId,
        grantEventSeq,
        grantAuthorizationId,
        grantCommandIndex
      }
    }) as RuntimeCommand
    const makeGrant = (
      recovery: RuntimeCommand,
      id: string,
      seq: number,
      authorizationId: string,
      commandIndex: number
    ) => ({
      protocolVersion: DEFAULT_RUNTIME_PROTOCOL_VERSION,
      id,
      seq,
      ts: seq,
      sessionId: 'sess_1',
      type: 'project_config_recovery_granted',
      source: 'server:project-config-recovery',
      recoveryGrant: {
        schemaVersion: 1 as const,
        type: 'project_config_recovery_grant' as const,
        recoveryCommandId: recovery.id,
        idempotencyKey,
        sessionId: 'sess_1',
        attemptCommandId: original.id,
        failureEventId: failure.id,
        failureEventSeq: failure.seq,
        payloadDigest: projectConfigRecoveryPayloadDigest(recovery)!,
        authorizationId,
        commandIndex,
        workspaceFolder: '/workspace/root',
        adapter: 'codex',
        runtimeAdapter: 'codex' as const
      }
    }) as RuntimeEvent
    const authority = {
      workspaceFolder: '/workspace/root',
      adapter: 'codex',
      runtimeAdapter: 'codex' as const,
      sessionId: 'sess_1'
    }
    const auth1 = '11111111-1111-4111-8111-111111111111'
    const recovery = makeRecovery('cmd_recovery', 'evt_grant', 2, auth1, 1)
    const grantEvent = makeGrant(recovery, 'evt_grant', 2, auth1, 1)

    expect(isAuthenticProjectConfigRecovery(
      recovery,
      [original, recovery],
      [failure, grantEvent],
      authority
    )).toBe(true)

    // A pre-existing recovery-shaped command cannot be back-filled by a later
    // grant: it does not carry the canonical event identity returned by the
    // server append that happened afterwards.
    const authPreexisting = '22222222-2222-4222-8222-222222222222'
    const preexisting = makeRecovery(
      'cmd_preexisting',
      'evt_unissued_claim',
      2,
      authPreexisting,
      1
    )
    const laterForPreexisting = makeGrant(
      preexisting,
      'evt_later_grant',
      2,
      authPreexisting,
      1
    )
    expect(isAuthenticProjectConfigRecovery(
      preexisting,
      [original, preexisting],
      [failure, laterForPreexisting],
      authority
    )).toBe(false)

    for (const forged of [
      {
        ...recovery,
        recovery: { ...recovery.recovery!, grantEventId: 'evt_wrong' }
      },
      {
        ...recovery,
        recovery: { ...recovery.recovery!, grantEventSeq: 3 }
      },
      {
        ...recovery,
        recovery: {
          ...recovery.recovery!,
          grantAuthorizationId: '33333333-3333-4333-8333-333333333333'
        }
      }
    ] as RuntimeCommand[]) {
      expect(isAuthenticProjectConfigRecovery(
        forged,
        [original, forged],
        [failure, grantEvent],
        authority
      )).toBe(false)
    }

    const inertShape = makeRecovery(
      'cmd_inert',
      'evt_missing',
      2,
      '44444444-4444-4444-8444-444444444444',
      1
    )
    const authWithInert = '55555555-5555-4555-8555-555555555555'
    const afterInert = makeRecovery('cmd_after_inert', 'evt_after_inert', 2, authWithInert, 2)
    const afterInertGrant = makeGrant(afterInert, 'evt_after_inert', 2, authWithInert, 2)
    expect(isAuthenticProjectConfigRecovery(
      afterInert,
      [original, inertShape, afterInert],
      [failure, afterInertGrant],
      authority
    )).toBe(true)

    const ordinary = command('cmd_ordinary_before', 'send_message', 20, 0)
    const afterOrdinary = makeRecovery(
      'cmd_after_ordinary',
      'evt_after_ordinary',
      2,
      '66666666-6666-4666-8666-666666666666',
      2
    )
    const afterOrdinaryGrant = makeGrant(
      afterOrdinary,
      'evt_after_ordinary',
      2,
      '66666666-6666-4666-8666-666666666666',
      2
    )
    expect(isAuthenticProjectConfigRecovery(
      afterOrdinary,
      [original, ordinary, afterOrdinary],
      [failure, afterOrdinaryGrant],
      authority
    )).toBe(false)
    expect(isAuthenticProjectConfigRecovery(
      recovery,
      [original, recovery, command('cmd_ordinary_after', 'send_message', 20, 0)],
      [failure, grantEvent],
      authority
    )).toBe(true)

    const auth2 = '77777777-7777-4777-8777-777777777777'
    const secondRecovery = makeRecovery('cmd_recovery_2', 'evt_grant_2', 3, auth2, 2)
    const secondGrant = makeGrant(secondRecovery, 'evt_grant_2', 3, auth2, 2)
    expect(isAuthenticProjectConfigRecovery(
      recovery,
      [original, recovery, secondRecovery],
      [failure, grantEvent, secondGrant],
      authority
    )).toBe(true)
    expect(isAuthenticProjectConfigRecovery(
      secondRecovery,
      [original, recovery, secondRecovery],
      [failure, grantEvent, secondGrant],
      authority
    )).toBe(false)

    for (const lifecycle of [
      { id: 'evt_running', type: 'status_changed', status: 'running' },
      { id: 'evt_started', type: 'session_started' },
      { id: 'evt_resumed', type: 'session_resumed' }
    ]) {
      const lifecycleEvent = {
        protocolVersion: DEFAULT_RUNTIME_PROTOCOL_VERSION,
        seq: 2,
        ts: 0,
        sessionId: 'sess_1',
        ...lifecycle
      } as RuntimeEvent
      const afterLifecycle = makeRecovery(
        'cmd_after_lifecycle',
        'evt_grant_after_lifecycle',
        3,
        '88888888-8888-4888-8888-888888888888',
        1
      )
      const grantAfterLifecycle = makeGrant(
        afterLifecycle,
        'evt_grant_after_lifecycle',
        3,
        '88888888-8888-4888-8888-888888888888',
        1
      )
      expect(isAuthenticProjectConfigRecovery(
        afterLifecycle,
        [original, afterLifecycle],
        [failure, lifecycleEvent, grantAfterLifecycle],
        authority
      )).toBe(false)
    }
  })
})
