/* eslint-disable max-lines -- projection scenarios share one in-memory runtime store fixture */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveProjectHomePath } from '@oneworks/utils'

import { SqliteDb } from '#~/db/index.js'
import { createSqliteDatabase } from '#~/db/sqlite.js'
import { isAgentRoomExperimentEnabled } from '#~/services/config/index.js'
import { discoverRuntimeSessionStores, resolveRuntimeRoots } from '#~/services/runtime-store/discovery.js'
import { projectRuntimeMetadata, shouldProjectRuntimeMetadata } from '#~/services/runtime-store/metadata-projection.js'
import { projectRuntimeEvent } from '#~/services/runtime-store/projection.js'
import type { RuntimeSessionStore } from '#~/services/runtime-store/types.js'
import { replayRuntimeStore } from '#~/services/runtime-store/watcher.js'
import { createWorkspaceRuntimeEnv } from '#~/services/runtime-store/workspace-env.js'

describe('runtime store room projection', () => {
  let db: SqliteDb
  let tempRoot: string | undefined

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-29T00:00:00.000Z'))
    db = new SqliteDb({ db: createSqliteDatabase(':memory:') })
  })

  afterEach(async () => {
    db.close()
    vi.useRealTimers()
    if (tempRoot != null) {
      await rm(tempRoot, { force: true, recursive: true })
      tempRoot = undefined
    }
  })

  it('reads the agent room experiment from experiments.agentRoom only', () => {
    expect(isAgentRoomExperimentEnabled({ experiments: { agentRoom: true } })).toBe(true)
    expect(isAgentRoomExperimentEnabled({ experiments: { agentRoom: false } })).toBe(false)
    expect(isAgentRoomExperimentEnabled({ experiments: { agentRoom: 'true' } })).toBe(false)
    expect(isAgentRoomExperimentEnabled({})).toBe(false)
  })

  it('resolves default runtime roots from the shared primary workspace, not real home', async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'ow-runtime-root-'))
    const primary = path.join(tempRoot, 'primary')
    const worktree = path.join(tempRoot, 'worktree')
    const homeDir = path.join(tempRoot, 'home')
    const env = {
      __ONEWORKS_PROJECT_LAUNCH_CWD__: worktree,
      __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: worktree,
      __ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__: primary,
      HOME: homeDir
    } as NodeJS.ProcessEnv
    const roots = resolveRuntimeRoots({
      cwd: worktree,
      env,
      homeDir
    })

    expect(roots[0]).toBe(resolveProjectHomePath(worktree, env, 'runtime'))
    expect(roots).not.toContain(path.join(homeDir, '.oneworks/runtime'))
  })

  it('resolves runtime roots for the requested cwd even when process env points at another workspace', async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'ow-runtime-root-'))
    const workspaceA = path.join(tempRoot, 'workspace-a')
    const workspaceB = path.join(tempRoot, 'workspace-b')
    const homeDir = path.join(tempRoot, 'home')
    const env = {
      __ONEWORKS_PROJECT_LAUNCH_CWD__: workspaceA,
      __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: workspaceA,
      __ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__: workspaceA,
      __ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__: workspaceA,
      HOME: homeDir
    } as NodeJS.ProcessEnv
    const scopedEnv = createWorkspaceRuntimeEnv(workspaceB, env)

    const roots = resolveRuntimeRoots({
      cwd: workspaceB,
      env
    })

    expect(roots[0]).toBe(resolveProjectHomePath(workspaceB, scopedEnv, 'runtime'))
    expect(roots).not.toContain(resolveProjectHomePath(workspaceB, env, 'runtime'))
  })

  it('reprojects metadata when an existing assignment is missing the member joined event', () => {
    db.createSession('Dev runtime', 'sess-existing', 'running')
    db.createAgentRoom({
      id: 'room-existing',
      title: 'Existing room',
      hostSessionId: 'host-session'
    })
    db.appendAgentRoomMessage({
      id: 'runtime-meta:sess-existing',
      roomId: 'room-existing',
      role: 'agent',
      content: 'Existing assignment.',
      eventType: 'assignment_sent',
      createdAt: Date.now()
    })

    const metadata = {
      sessionId: 'sess-existing',
      roomId: 'room-existing',
      hostSessionId: 'host-session',
      memberKey: 'dev',
      memberLabel: 'Developer'
    }
    const options = {
      db,
      broadcast: false,
      agentRoomProjectionEnabled: true,
      checkpoint: { offset: 1 }
    }

    expect(shouldProjectRuntimeMetadata(metadata, options, 'Existing assignment.')).toBe(true)

    db.appendAgentRoomMessage({
      id: 'runtime-member:room-existing:dev',
      roomId: 'room-existing',
      role: 'system',
      memberKey: 'dev',
      content: 'Developer joined the room',
      eventType: 'member_joined',
      createdAt: Date.now()
    })

    expect(shouldProjectRuntimeMetadata(metadata, options, 'Existing assignment.')).toBe(false)
  })

  it('does not create a host session room when agent room projection is disabled by default', () => {
    db.createSession('Host task', 'host-session', 'running')
    projectRuntimeMetadata({
      sessionId: 'sess-dev',
      title: 'Dev run',
      hostSessionId: 'host-session',
      parentSessionId: 'host-session',
      memberKey: 'dev',
      memberLabel: 'dev',
      runId: 'sess-dev',
      runTitle: 'Dev run'
    }, {
      db,
      broadcast: false
    }, 'Start dev run.')

    expect(db.getSession('sess-dev')).toEqual(expect.objectContaining({
      id: 'sess-dev',
      title: 'Dev run'
    }))
    expect(db.listAgentRooms()).toEqual([])
  })

  it('creates a host session room when agent room projection is enabled', () => {
    db.createSession('Host task', 'host-session', 'running')
    projectRuntimeEvent({
      id: 'evt-start-with-host',
      seq: 1,
      sessionId: 'sess-dev',
      type: 'session_started',
      status: 'starting',
      title: 'Dev run'
    }, {
      db,
      broadcast: false,
      agentRoomProjectionEnabled: true,
      metadata: {
        sessionId: 'sess-dev',
        title: 'Dev run',
        hostSessionId: 'host-session',
        parentSessionId: 'host-session',
        effort: 'medium',
        permissionMode: 'bypassPermissions',
        memberKey: 'dev',
        memberLabel: 'dev',
        runId: 'sess-dev',
        runTitle: 'Dev run'
      }
    })

    const room = db.listAgentRooms()[0]
    expect(room).toEqual(expect.objectContaining({
      hostSessionId: 'host-session',
      title: 'Host task'
    }))
    expect(db.getSession('sess-dev')).toEqual(expect.objectContaining({
      effort: 'medium',
      permissionMode: 'bypassPermissions'
    }))
    expect(db.getAgentRoomDetail(room!.id)).toEqual(expect.objectContaining({
      members: [
        expect.objectContaining({
          key: 'dev',
          label: 'dev'
        })
      ],
      runs: [
        expect.objectContaining({
          key: 'sess-dev',
          sessionId: 'sess-dev',
          title: 'Dev run'
        })
      ]
    }))
  })

  it('binds an existing explicit room to host session metadata', () => {
    db.createSession('Host task', 'host-session', 'running')
    db.createAgentRoom({
      id: 'room-existing',
      title: 'Existing room'
    })

    projectRuntimeEvent({
      id: 'evt-start-with-room-and-host',
      seq: 1,
      sessionId: 'sess-dev',
      type: 'session_started',
      status: 'starting',
      title: 'Dev run'
    }, {
      db,
      broadcast: false,
      agentRoomProjectionEnabled: true,
      metadata: {
        sessionId: 'sess-dev',
        title: 'Dev run',
        roomId: 'room-existing',
        hostSessionId: 'host-session',
        parentSessionId: 'host-session',
        memberKey: 'dev',
        memberLabel: 'dev',
        runId: 'sess-dev',
        runTitle: 'Dev run'
      }
    })

    expect(db.getAgentRoom('room-existing')).toEqual(expect.objectContaining({
      hostSessionId: 'host-session',
      title: 'Existing room'
    }))
    expect(db.getAgentRoomByHostSessionId('host-session')).toEqual(expect.objectContaining({
      id: 'room-existing'
    }))
  })

  it('rejects conflicting host session metadata for an existing room', () => {
    db.createAgentRoom({
      id: 'room-existing',
      title: 'Existing room',
      hostSessionId: 'host-a'
    })

    expect(() =>
      projectRuntimeEvent({
        id: 'evt-conflicting-room-host',
        seq: 1,
        sessionId: 'sess-dev',
        type: 'session_started',
        status: 'starting',
        title: 'Dev run'
      }, {
        db,
        broadcast: false,
        agentRoomProjectionEnabled: true,
        metadata: {
          sessionId: 'sess-dev',
          title: 'Dev run',
          roomId: 'room-existing',
          hostSessionId: 'host-b'
        }
      })
    ).toThrow('Agent room room-existing is already bound to host session host-a.')
  })

  it('projects ow agent start metadata before engine events exist', async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'ow-runtime-store-'))
    const workspace = path.join(tempRoot, 'unwatched-workspace')
    const homeDir = path.join(tempRoot, 'home')
    const env = { HOME: homeDir } as NodeJS.ProcessEnv
    const root = resolveProjectHomePath(workspace, env, 'runtime')
    const storePath = path.join(root, 'sessions/sess-cli-dev')
    await mkdir(storePath, { recursive: true })
    await writeFile(
      path.join(root, 'index.json'),
      JSON.stringify({
        protocolVersion: '1.0.0',
        sessions: {
          'sess-cli-dev': {
            storePath: 'sessions/sess-cli-dev',
            status: 'starting'
          }
        }
      })
    )
    await writeFile(
      path.join(storePath, 'meta.json'),
      JSON.stringify({
        protocolVersion: '1.0.0',
        supportedProtocolRange: '^1.0.0',
        sessionId: 'sess-cli-dev',
        title: 'Dev runtime',
        entity: 'dev',
        cwd: '/workspace/demo',
        roomId: 'room-cli',
        roomTitle: 'CLI runtime room',
        hostSessionId: 'host-session',
        memberKey: 'dev',
        memberKind: 'entity',
        memberLabel: 'Developer',
        runId: 'run-dev',
        runTitle: 'Developer run',
        needsEngineConsumer: true,
        createdAt: Date.now()
      })
    )
    await writeFile(
      path.join(storePath, 'state.json'),
      JSON.stringify({
        protocolVersion: '1.0.0',
        supportedProtocolRange: '^1.0.0',
        sessionId: 'sess-cli-dev',
        status: 'starting',
        title: 'Dev runtime',
        lastSeq: 0,
        updatedAt: Date.now(),
        needsEngineConsumer: true
      })
    )
    await writeFile(
      path.join(storePath, 'commands.jsonl'),
      `${
        JSON.stringify({
          protocolVersion: '1.0.0',
          supportedProtocolRange: '^1.0.0',
          id: 'cmd-start',
          ts: Date.now(),
          sessionId: 'sess-cli-dev',
          type: 'start',
          priority: 20,
          source: 'ow-agent-cli',
          entity: 'dev',
          title: 'Dev runtime',
          content: 'Implement runtime projection smoke.'
        })
      }\n`
    )

    const stores = await discoverRuntimeSessionStores([root])
    const replay = await replayRuntimeStore(stores[0] as RuntimeSessionStore, {
      db,
      broadcast: false,
      agentRoomProjectionEnabled: true
    })

    expect(replay.projectedCount).toBe(0)
    expect(db.getSession('sess-cli-dev')).toEqual(expect.objectContaining({
      id: 'sess-cli-dev',
      status: 'running',
      title: 'Dev runtime'
    }))
    expect(db.getSessionRuntimeState('sess-cli-dev')).toEqual(expect.objectContaining({
      runtimeKind: 'external'
    }))
    expect(db.getAgentRoomDetail('room-cli')).toEqual(expect.objectContaining({
      room: expect.objectContaining({
        hostSessionId: 'host-session',
        title: 'CLI runtime room'
      }),
      members: [
        expect.objectContaining({
          key: 'dev',
          label: 'Developer'
        })
      ],
      runs: [
        expect.objectContaining({
          key: 'run-dev',
          sessionId: 'sess-cli-dev',
          status: 'running',
          title: 'Developer run'
        })
      ],
      messages: [
        expect.objectContaining({
          content: 'Developer joined the room',
          eventType: 'member_joined',
          id: 'runtime-member:room-cli:dev',
          memberKey: 'dev'
        }),
        expect.objectContaining({
          content: 'Implement runtime projection smoke.',
          eventType: 'assignment_sent',
          id: 'runtime-meta:sess-cli-dev',
          memberKey: 'host:host-session',
          runKey: 'run-dev'
        })
      ]
    }))
  })

  it('creates a host-bound room from metadata without explicit room id or events', async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'ow-runtime-store-'))
    const root = path.join(tempRoot, '.oneworks/runtime')
    const storePath = path.join(root, 'sessions/sess-host-dev')
    db.createSession('Host request', 'host-session', 'running')
    await mkdir(storePath, { recursive: true })
    await writeFile(
      path.join(root, 'index.json'),
      JSON.stringify({
        protocolVersion: '1.0.0',
        sessions: {
          'sess-host-dev': {
            storePath: 'sessions/sess-host-dev',
            status: 'starting'
          }
        }
      })
    )
    await writeFile(
      path.join(storePath, 'meta.json'),
      JSON.stringify({
        protocolVersion: '1.0.0',
        supportedProtocolRange: '^1.0.0',
        sessionId: 'sess-host-dev',
        title: 'Dev runtime',
        entity: 'dev',
        cwd: '/workspace/demo',
        hostSessionId: 'host-session',
        parentSessionId: 'host-session',
        memberKey: 'dev',
        memberKind: 'entity',
        memberLabel: 'Developer',
        runId: 'sess-host-dev',
        runTitle: 'Developer run',
        needsEngineConsumer: true,
        createdAt: Date.now()
      })
    )

    const stores = await discoverRuntimeSessionStores([root])
    const store = stores.find(entry => entry.root === root)
    const replay = await replayRuntimeStore(store as RuntimeSessionStore, {
      db,
      broadcast: false,
      agentRoomProjectionEnabled: true
    })
    const room = db.getAgentRoomByHostSessionId('host-session')

    expect(store?.root).toBe(root)
    expect(replay.projectedCount).toBe(0)
    expect(room).toEqual(expect.objectContaining({
      hostSessionId: 'host-session',
      title: 'Host request'
    }))
    expect(db.getAgentRoomDetail(room!.id)).toEqual(expect.objectContaining({
      members: [
        expect.objectContaining({
          key: 'dev',
          label: 'Developer'
        })
      ],
      runs: [
        expect.objectContaining({
          key: 'sess-host-dev',
          sessionId: 'sess-host-dev',
          status: 'running',
          title: 'Developer run'
        })
      ],
      messages: [
        expect.objectContaining({
          content: 'Developer joined the room',
          eventType: 'member_joined',
          id: `runtime-member:${room!.id}:dev`,
          memberKey: 'dev'
        })
      ]
    }))
  })

  it('projects a stable generated room id from host session runtime metadata', async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'ow-runtime-store-'))
    const root = path.join(tempRoot, '.oneworks/runtime')
    const storePath = path.join(root, 'sessions/sess-generated-room')
    db.createSession('Host request', 'host-session', 'running')
    await mkdir(storePath, { recursive: true })
    await writeFile(
      path.join(root, 'index.json'),
      JSON.stringify({
        protocolVersion: '1.0.0',
        sessions: {
          'sess-generated-room': {
            storePath: 'sessions/sess-generated-room',
            status: 'starting'
          }
        }
      })
    )
    await writeFile(
      path.join(storePath, 'meta.json'),
      JSON.stringify({
        protocolVersion: '1.0.0',
        supportedProtocolRange: '^1.0.0',
        sessionId: 'sess-generated-room',
        title: 'Dev runtime',
        entity: 'dev',
        cwd: '/workspace/demo',
        roomId: 'room_host-session',
        hostSessionId: 'host-session',
        parentSessionId: 'host-session',
        memberKey: 'dev',
        memberKind: 'entity',
        memberLabel: 'Developer',
        runId: 'sess-generated-room',
        runTitle: 'Developer run',
        needsEngineConsumer: true,
        createdAt: Date.now()
      })
    )

    const stores = await discoverRuntimeSessionStores([root])
    await replayRuntimeStore(stores[0] as RuntimeSessionStore, {
      db,
      broadcast: false,
      agentRoomProjectionEnabled: true
    })

    expect(db.getAgentRoom('room_host-session')).toEqual(expect.objectContaining({
      id: 'room_host-session',
      hostSessionId: 'host-session',
      title: 'Host request'
    }))
    expect(db.getAgentRoomDetail('room_host-session')).toEqual(expect.objectContaining({
      runs: [
        expect.objectContaining({
          key: 'sess-generated-room',
          sessionId: 'sess-generated-room',
          status: 'running'
        })
      ]
    }))
  })

  it('projects a late ow agent start command as the room assignment message', async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'ow-runtime-store-'))
    const root = path.join(tempRoot, '.oneworks/runtime')
    const storePath = path.join(root, 'sessions/sess-late-command')
    db.createSession('Host request', 'host-session', 'running')
    await mkdir(storePath, { recursive: true })
    await writeFile(
      path.join(root, 'index.json'),
      JSON.stringify({
        protocolVersion: '1.0.0',
        sessions: {
          'sess-late-command': {
            storePath: 'sessions/sess-late-command',
            status: 'starting'
          }
        }
      })
    )
    await writeFile(
      path.join(storePath, 'meta.json'),
      JSON.stringify({
        protocolVersion: '1.0.0',
        supportedProtocolRange: '^1.0.0',
        sessionId: 'sess-late-command',
        title: 'Dev runtime',
        entity: 'dev',
        cwd: '/workspace/demo',
        hostSessionId: 'host-session',
        parentSessionId: 'host-session',
        memberKey: 'dev',
        memberKind: 'entity',
        memberLabel: 'Developer',
        runId: 'sess-late-command',
        runTitle: 'Developer run',
        needsEngineConsumer: true,
        createdAt: Date.now()
      })
    )

    const stores = await discoverRuntimeSessionStores([root])
    const first = await replayRuntimeStore(stores[0] as RuntimeSessionStore, {
      db,
      broadcast: false,
      agentRoomProjectionEnabled: true
    })
    const room = db.getAgentRoomByHostSessionId('host-session')
    expect(db.getAgentRoomDetail(room!.id)?.messages).toEqual([
      expect.objectContaining({
        content: 'Developer joined the room',
        eventType: 'member_joined',
        id: `runtime-member:${room!.id}:dev`,
        memberKey: 'dev'
      })
    ])

    await writeFile(
      path.join(storePath, 'commands.jsonl'),
      `${
        JSON.stringify({
          protocolVersion: '1.0.0',
          supportedProtocolRange: '^1.0.0',
          id: 'cmd-start-late',
          ts: Date.now(),
          sessionId: 'sess-late-command',
          type: 'start',
          priority: 20,
          source: 'cli',
          entity: 'dev',
          content: 'Implement the late command projection.'
        })
      }\n`
    )

    await replayRuntimeStore(stores[0] as RuntimeSessionStore, {
      db,
      broadcast: false,
      agentRoomProjectionEnabled: true,
      checkpoint: first.checkpoint
    })

    expect(db.getAgentRoomDetail(room!.id)?.messages).toEqual([
      expect.objectContaining({
        content: 'Developer joined the room',
        eventType: 'member_joined',
        id: `runtime-member:${room!.id}:dev`,
        memberKey: 'dev'
      }),
      expect.objectContaining({
        content: 'Implement the late command projection.',
        eventType: 'assignment_sent',
        memberKey: `host:${room!.hostSessionId}`,
        runKey: 'sess-late-command'
      })
    ])
  })

  it('keeps failed room runs from being overwritten by later completion events', () => {
    const metadata = {
      sessionId: 'sess-runtime-failed',
      title: 'Failing runtime',
      roomId: 'room-runtime-failed',
      hostSessionId: 'host-session',
      memberKey: 'dev',
      memberLabel: 'Developer',
      runId: 'run-dev',
      runTitle: 'Developer run'
    }

    projectRuntimeEvent({
      id: 'evt-start',
      seq: 1,
      sessionId: 'sess-runtime-failed',
      type: 'session_started',
      status: 'running',
      visibility: 'room',
      summary: 'Start developer run.'
    }, {
      db,
      broadcast: false,
      agentRoomProjectionEnabled: true,
      metadata
    })
    projectRuntimeEvent({
      id: 'evt-failed',
      seq: 2,
      sessionId: 'sess-runtime-failed',
      type: 'session_failed',
      status: 'failed',
      visibility: 'room',
      summary: 'Developer run failed.'
    }, {
      db,
      broadcast: false,
      agentRoomProjectionEnabled: true,
      metadata
    })
    projectRuntimeEvent({
      id: 'evt-completed',
      seq: 3,
      sessionId: 'sess-runtime-failed',
      type: 'session_completed',
      status: 'completed',
      visibility: 'room',
      summary: 'Developer run completed.'
    }, {
      db,
      broadcast: false,
      agentRoomProjectionEnabled: true,
      metadata
    })

    const detail = db.getAgentRoomDetail('room-runtime-failed')
    expect(detail?.runs).toEqual([
      expect.objectContaining({
        key: 'run-dev',
        status: 'failed',
        latestSummary: 'Developer run failed.'
      })
    ])
    expect(detail?.messages.map(message => message.eventType)).toEqual([
      'member_joined',
      'assignment_sent',
      'run_failed'
    ])
    expect(detail?.messages).toEqual([
      expect.objectContaining({ content: 'Developer joined the room' }),
      expect.objectContaining({ content: 'Start developer run.' }),
      expect.objectContaining({ content: 'Developer run failed.' })
    ])
  })
})
