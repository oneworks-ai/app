/* eslint-disable max-lines -- native history import fixtures cover parser, matching, preview, and size-limit behavior together. */
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { resolveProjectHomePath } from '@oneworks/utils/ai-path'

import { SqliteDb } from '#~/db/index.js'
import { createSqliteDatabase } from '#~/db/sqlite.js'
import { discoverRuntimeSessionStores } from '#~/services/runtime-store/discovery.js'
import {
  importNativeProjectHistory,
  prepareNativeProjectHistoryFirstOpenImport,
  previewNativeProjectHistory
} from '#~/services/runtime-store/history-import.js'
import { replayRuntimeStore } from '#~/services/runtime-store/watcher.js'
import { createWorkspaceRuntimeEnv, resolveWorkspaceRuntimeStoreRoot } from '#~/services/runtime-store/workspace-env.js'

const tempDirs: string[] = []

const createTempRoot = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ow-native-history-'))
  tempDirs.push(dir)
  return dir
}

const writeJsonl = async (filePath: string, records: unknown[]) => {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${records.map(record => JSON.stringify(record)).join('\n')}\n`, 'utf8')
}

const writeGitOrigin = async (repoRoot: string, remoteUrl: string) => {
  await mkdir(path.join(repoRoot, '.git'), { recursive: true })
  await writeFile(
    path.join(repoRoot, '.git', 'config'),
    `[remote "origin"]\n\turl = ${remoteUrl}\n`,
    'utf8'
  )
}

const writeCodexThreadState = async (
  home: string,
  rows: Array<{
    archived?: boolean
    createdAt: number
    cwd: string
    gitOriginUrl?: string
    id: string
    rolloutPath: string
    threadSource?: string
    title: string
    updatedAt: number
  }>,
  spawnEdges: Array<{
    childThreadId: string
    parentThreadId: string
    status: string
  }> = []
) => {
  const dbPath = path.join(home, '.codex', 'state_5.sqlite')
  await mkdir(path.dirname(dbPath), { recursive: true })
  const db = createSqliteDatabase(dbPath)
  db.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      rollout_path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      cwd TEXT NOT NULL,
      title TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      git_origin_url TEXT,
      created_at_ms INTEGER,
      updated_at_ms INTEGER,
      thread_source TEXT
    )
  `)
  const insert = db.prepare(`
    INSERT INTO threads (
      id,
      rollout_path,
      created_at,
      updated_at,
      cwd,
      title,
      archived,
      git_origin_url,
      created_at_ms,
      updated_at_ms,
      thread_source
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const row of rows) {
    insert.run(
      row.id,
      row.rolloutPath,
      Math.floor(row.createdAt / 1000),
      Math.floor(row.updatedAt / 1000),
      row.cwd,
      row.title,
      row.archived === true ? 1 : 0,
      row.gitOriginUrl ?? null,
      row.createdAt,
      row.updatedAt,
      row.threadSource ?? 'user'
    )
  }
  if (spawnEdges.length > 0) {
    db.exec(`
      CREATE TABLE thread_spawn_edges (
        parent_thread_id TEXT NOT NULL,
        child_thread_id TEXT PRIMARY KEY,
        status TEXT NOT NULL
      )
    `)
    const insertSpawnEdge = db.prepare(`
      INSERT INTO thread_spawn_edges (
        parent_thread_id,
        child_thread_id,
        status
      )
      VALUES (?, ?, ?)
    `)
    for (const edge of spawnEdges) {
      insertSpawnEdge.run(edge.parentThreadId, edge.childThreadId, edge.status)
    }
  }
  db.close()
}

const writeCodexGlobalState = async (
  home: string,
  state: Record<string, unknown>
) => {
  const statePath = path.join(home, '.codex', '.codex-global-state.json')
  await mkdir(path.dirname(statePath), { recursive: true })
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

const writeCodexSessionIndex = async (
  home: string,
  rows: Array<{
    id: string
    threadName: string
    updatedAt?: string
  }>
) => {
  const indexPath = path.join(home, '.codex', 'session_index.jsonl')
  await mkdir(path.dirname(indexPath), { recursive: true })
  await writeFile(
    indexPath,
    `${
      rows.map(row =>
        JSON.stringify({
          id: row.id,
          thread_name: row.threadName,
          ...(row.updatedAt == null ? {} : { updated_at: row.updatedAt })
        })
      ).join('\n')
    }\n`,
    'utf8'
  )
}

const createTestEnv = (workspaceFolder: string, home: string, primaryWorkspaceFolder?: string): NodeJS.ProcessEnv => ({
  __ONEWORKS_PROJECT_HOME_PROJECTS_DIR__: path.join(home, 'oneworks-projects'),
  __ONEWORKS_PROJECT_REAL_HOME__: home,
  __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: workspaceFolder,
  __ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__: workspaceFolder,
  ...(primaryWorkspaceFolder != null ? { __ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__: primaryWorkspaceFolder } : {})
})

const replayImportedSessions = async (runtimeRoot: string) => {
  const db = new SqliteDb({ db: createSqliteDatabase(':memory:') })
  const stores = await discoverRuntimeSessionStores([runtimeRoot])
  for (const store of stores) {
    await replayRuntimeStore(store, {
      db,
      broadcast: false,
      agentRoomProjectionEnabled: false
    })
  }
  return db
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

describe('native project history import', () => {
  it('imports only Codex sessions whose cwd belongs to the current workspace and stays idempotent', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const otherWorkspace = path.join(root, 'other')
    const home = path.join(root, 'home')
    const codexHistoryDir = path.join(home, '.codex', 'archived_sessions')
    const env = createTestEnv(workspace, home)

    await mkdir(workspace, { recursive: true })
    await mkdir(otherWorkspace, { recursive: true })
    await writeJsonl(path.join(codexHistoryDir, 'matching.jsonl'), [
      {
        type: 'session_meta',
        timestamp: '2026-06-01T00:00:00.000Z',
        payload: {
          id: 'codex-native-1',
          cwd: workspace,
          model: 'gpt-5'
        }
      },
      {
        type: 'event_msg',
        timestamp: '2026-06-01T00:00:01.000Z',
        payload: {
          type: 'user_message',
          message: 'What changed?'
        }
      },
      {
        type: 'response_item',
        timestamp: '2026-06-01T00:00:02.000Z',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'The project changed.' }]
        }
      }
    ])
    await writeJsonl(path.join(codexHistoryDir, 'other.jsonl'), [
      {
        type: 'session_meta',
        timestamp: '2026-06-01T00:00:00.000Z',
        payload: {
          id: 'codex-native-other',
          cwd: otherWorkspace
        }
      },
      {
        type: 'event_msg',
        timestamp: '2026-06-01T00:00:01.000Z',
        payload: {
          type: 'user_message',
          message: 'Do not import me'
        }
      }
    ])

    const firstImport = await importNativeProjectHistory({
      adapters: ['codex'],
      cwd: workspace,
      env,
      homeDir: home
    })
    const secondImport = await importNativeProjectHistory({
      adapters: ['codex'],
      cwd: workspace,
      env,
      homeDir: home
    })

    expect(firstImport).toEqual(expect.objectContaining({
      importedEvents: 2,
      importedSessions: 1,
      matchedFiles: 1,
      scannedFiles: 2
    }))
    expect(secondImport).toEqual(expect.objectContaining({
      importedEvents: 0,
      importedSessions: 0,
      matchedFiles: 0,
      scannedFiles: 2
    }))

    const runtimeRoot = resolveWorkspaceRuntimeStoreRoot(workspace, createWorkspaceRuntimeEnv(workspace, env))
    const db = await replayImportedSessions(runtimeRoot)
    const importedSessionId = firstImport.sessions[0]!.sessionId

    expect(db.getSession(importedSessionId)).toEqual(expect.objectContaining({
      adapter: 'codex',
      model: 'gpt-5',
      status: 'completed',
      title: 'What changed?'
    }))
    expect(db.getMessages(importedSessionId)).toEqual([
      expect.objectContaining({
        type: 'message',
        message: expect.objectContaining({
          role: 'user',
          content: 'What changed?'
        })
      }),
      expect.objectContaining({
        type: 'message',
        message: expect.objectContaining({
          role: 'assistant',
          content: 'The project changed.'
        })
      })
    ])
    expect(db.getSessions('all')).toHaveLength(1)
    db.close()
  })

  it('imports all-project Codex sessions into each matching workspace runtime root', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const otherWorkspace = path.join(root, 'other')
    const home = path.join(root, 'home')
    const codexHistoryDir = path.join(home, '.codex', 'sessions')
    const env = createTestEnv(workspace, home)

    await mkdir(workspace, { recursive: true })
    await mkdir(otherWorkspace, { recursive: true })
    await writeJsonl(path.join(codexHistoryDir, 'current.jsonl'), [
      {
        type: 'session_meta',
        timestamp: '2026-06-01T00:00:00.000Z',
        payload: {
          id: 'codex-current-project',
          cwd: workspace
        }
      },
      {
        type: 'event_msg',
        timestamp: '2026-06-01T00:00:01.000Z',
        payload: {
          type: 'user_message',
          message: 'Current project history'
        }
      }
    ])
    await writeJsonl(path.join(codexHistoryDir, 'other.jsonl'), [
      {
        type: 'session_meta',
        timestamp: '2026-06-01T00:00:00.000Z',
        payload: {
          id: 'codex-other-project',
          cwd: otherWorkspace
        }
      },
      {
        type: 'event_msg',
        timestamp: '2026-06-01T00:00:01.000Z',
        payload: {
          type: 'user_message',
          message: 'Other project history'
        }
      }
    ])

    const result = await importNativeProjectHistory({
      adapters: ['codex'],
      cwd: workspace,
      env,
      homeDir: home,
      projectScope: 'all-projects'
    })

    expect(result).toEqual(expect.objectContaining({
      importedEvents: 2,
      importedSessions: 2,
      matchedFiles: 2,
      scannedFiles: 2
    }))

    const currentRuntimeRoot = resolveWorkspaceRuntimeStoreRoot(workspace, createWorkspaceRuntimeEnv(workspace, env))
    const otherRuntimeRoot = resolveWorkspaceRuntimeStoreRoot(
      otherWorkspace,
      createWorkspaceRuntimeEnv(otherWorkspace, env)
    )
    const currentDb = await replayImportedSessions(currentRuntimeRoot)
    const otherDb = await replayImportedSessions(otherRuntimeRoot)

    expect(currentDb.getSessions('all')).toEqual([
      expect.objectContaining({
        title: 'Current project history'
      })
    ])
    expect(otherDb.getSessions('all')).toEqual([
      expect.objectContaining({
        title: 'Other project history'
      })
    ])
    currentDb.close()
    otherDb.close()
  })

  it('imports Codex sessions from another checkout with the same git remote', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const siblingCheckout = path.join(root, 'sibling')
    const home = path.join(root, 'home')
    const codexHistoryDir = path.join(home, '.codex', 'sessions')
    const env = createTestEnv(workspace, home)

    await mkdir(workspace, { recursive: true })
    await mkdir(siblingCheckout, { recursive: true })
    await writeGitOrigin(workspace, 'https://github.com/oneworks-ai/app.git')
    await writeGitOrigin(siblingCheckout, 'git@github.com:oneworks-ai/app.git')
    await writeJsonl(path.join(codexHistoryDir, 'same-repo.jsonl'), [
      {
        type: 'session_meta',
        timestamp: '2026-06-04T00:00:00.000Z',
        payload: {
          id: 'codex-same-repo',
          cwd: siblingCheckout
        }
      },
      {
        type: 'event_msg',
        timestamp: '2026-06-04T00:00:01.000Z',
        payload: {
          type: 'user_message',
          message: 'Import another checkout'
        }
      }
    ])

    const result = await importNativeProjectHistory({
      adapters: ['codex'],
      cwd: workspace,
      env,
      homeDir: home
    })

    expect(result).toEqual(expect.objectContaining({
      importedEvents: 1,
      importedSessions: 1,
      matchedFiles: 1,
      scannedFiles: 1
    }))
    expect(result.sessions[0]).toEqual(expect.objectContaining({
      adapter: 'codex',
      title: 'Import another checkout'
    }))
  })

  it('uses Codex thread metadata for archived state and deleted worktree project matching', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const deletedWorktree = path.join(root, 'deleted-worktrees', 'feature', 'app')
    const home = path.join(root, 'home')
    const codexHistoryDir = path.join(home, '.codex', 'sessions')
    const sourcePath = path.join(codexHistoryDir, 'metadata-match.jsonl')
    const env = createTestEnv(workspace, home)
    const createdAt = Date.parse('2026-06-05T00:00:00.000Z')
    const updatedAt = Date.parse('2026-06-09T00:00:00.000Z')

    await mkdir(workspace, { recursive: true })
    await writeGitOrigin(workspace, 'https://github.com/oneworks-ai/app.git')
    await writeJsonl(sourcePath, [
      {
        type: 'session_meta',
        timestamp: '2026-06-05T00:00:00.000Z',
        payload: {
          id: 'codex-metadata-match',
          cwd: deletedWorktree
        }
      },
      {
        type: 'event_msg',
        timestamp: '2026-06-09T00:00:00.000Z',
        payload: {
          type: 'user_message',
          message: 'Import deleted worktree history'
        }
      }
    ])
    await writeCodexThreadState(home, [{
      archived: true,
      createdAt,
      cwd: deletedWorktree,
      gitOriginUrl: 'git@github.com:oneworks-ai/app.git',
      id: 'codex-metadata-match',
      rolloutPath: sourcePath,
      title: 'Metadata title',
      updatedAt
    }])

    const preview = await previewNativeProjectHistory({
      adapters: ['codex'],
      cwd: workspace,
      env,
      homeDir: home
    })
    const result = await importNativeProjectHistory({
      adapters: ['codex'],
      cwd: workspace,
      env,
      homeDir: home,
      sourcePaths: [sourcePath]
    })

    expect(preview).toEqual(expect.objectContaining({
      matchedFiles: 1,
      scannedFiles: 1
    }))
    expect(preview.adapters[0]!.candidates[0]).toEqual(expect.objectContaining({
      createdAt,
      cwd: deletedWorktree,
      isArchived: true,
      nativeSessionId: 'codex-metadata-match',
      title: 'Metadata title',
      updatedAt
    }))
    expect(result).toEqual(expect.objectContaining({
      importedEvents: 1,
      importedSessions: 1,
      matchedFiles: 1,
      scannedFiles: 1
    }))
    expect(result.sessions[0]).toEqual(expect.objectContaining({
      createdAt,
      title: 'Metadata title',
      updatedAt
    }))
  })

  it('treats closed Codex spawned threads as archived candidates', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    const codexHistoryDir = path.join(home, '.codex', 'sessions')
    const sourcePath = path.join(codexHistoryDir, 'closed-spawn.jsonl')
    const env = createTestEnv(workspace, home)
    const createdAt = Date.parse('2026-06-05T00:00:00.000Z')
    const updatedAt = Date.parse('2026-06-09T00:00:00.000Z')

    await mkdir(workspace, { recursive: true })
    await writeJsonl(sourcePath, [
      {
        type: 'session_meta',
        timestamp: '2026-06-05T00:00:00.000Z',
        payload: {
          id: 'codex-closed-spawn',
          cwd: workspace
        }
      },
      {
        type: 'event_msg',
        timestamp: '2026-06-09T00:00:00.000Z',
        payload: {
          type: 'user_message',
          message: 'Review docs'
        }
      }
    ])
    await writeCodexThreadState(
      home,
      [{
        archived: false,
        createdAt,
        cwd: workspace,
        id: 'codex-closed-spawn',
        rolloutPath: sourcePath,
        threadSource: 'subagent',
        title: 'Review docs',
        updatedAt
      }],
      [{
        childThreadId: 'codex-closed-spawn',
        parentThreadId: 'codex-parent',
        status: 'closed'
      }]
    )

    const preview = await previewNativeProjectHistory({
      adapters: ['codex'],
      cwd: workspace,
      env,
      homeDir: home
    })

    expect(preview).toEqual(expect.objectContaining({
      matchedFiles: 1,
      scannedFiles: 1
    }))
    expect(preview.adapters[0]!.candidates[0]).toEqual(expect.objectContaining({
      isArchived: true,
      nativeSessionId: 'codex-closed-spawn',
      title: 'Review docs'
    }))
  })

  it('treats completed Codex subagent notifications as archived candidates', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    const codexHistoryDir = path.join(home, '.codex', 'sessions')
    const parentPath = path.join(codexHistoryDir, 'parent.jsonl')
    const childPath = path.join(codexHistoryDir, 'completed-child.jsonl')
    const env = createTestEnv(workspace, home)
    const createdAt = Date.parse('2026-06-05T00:00:00.000Z')
    const updatedAt = Date.parse('2026-06-09T00:00:00.000Z')

    await mkdir(workspace, { recursive: true })
    await Promise.all([
      writeJsonl(parentPath, [{
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{
            type: 'input_text',
            text: `<subagent_notification>\n${
              JSON.stringify({
                agent_path: 'codex-completed-spawn',
                status: {
                  completed: 'done'
                }
              })
            }\n</subagent_notification>`
          }]
        }
      }]),
      writeJsonl(childPath, [
        {
          type: 'session_meta',
          timestamp: '2026-06-05T00:00:00.000Z',
          payload: {
            id: 'codex-completed-spawn',
            cwd: workspace
          }
        },
        {
          type: 'event_msg',
          timestamp: '2026-06-09T00:00:00.000Z',
          payload: {
            type: 'user_message',
            message: '接入 rank 图标'
          }
        }
      ])
    ])
    await writeCodexThreadState(
      home,
      [{
        archived: false,
        createdAt,
        cwd: workspace,
        id: 'codex-parent',
        rolloutPath: parentPath,
        title: 'Parent session',
        updatedAt
      }, {
        archived: false,
        createdAt,
        cwd: workspace,
        id: 'codex-completed-spawn',
        rolloutPath: childPath,
        threadSource: 'subagent',
        title: '接入 rank 图标',
        updatedAt
      }],
      [{
        childThreadId: 'codex-completed-spawn',
        parentThreadId: 'codex-parent',
        status: 'open'
      }]
    )

    const preview = await previewNativeProjectHistory({
      adapters: ['codex'],
      cwd: workspace,
      env,
      homeDir: home,
      sourcePaths: [childPath]
    })

    expect(preview).toEqual(expect.objectContaining({
      matchedFiles: 1,
      scannedFiles: 2
    }))
    expect(preview.adapters[0]!.candidates[0]).toEqual(expect.objectContaining({
      isArchived: true,
      nativeSessionId: 'codex-completed-spawn',
      title: '接入 rank 图标'
    }))
  })

  it('filters Codex subagent threads by thread scope', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    const codexHistoryDir = path.join(home, '.codex', 'sessions')
    const userPath = path.join(codexHistoryDir, 'user.jsonl')
    const subagentPath = path.join(codexHistoryDir, 'subagent.jsonl')
    const env = createTestEnv(workspace, home)

    await mkdir(workspace, { recursive: true })
    await Promise.all([
      writeJsonl(userPath, [{ type: 'event_msg', payload: { type: 'user_message', message: 'User session' } }]),
      writeJsonl(subagentPath, [{ type: 'event_msg', payload: { type: 'user_message', message: 'Worker task' } }])
    ])
    await writeCodexThreadState(home, [{
      archived: false,
      createdAt: Date.parse('2026-06-10T00:00:00.000Z'),
      cwd: workspace,
      id: 'codex-user-thread',
      rolloutPath: userPath,
      threadSource: 'user',
      title: 'User session',
      updatedAt: Date.parse('2026-06-10T00:00:00.000Z')
    }, {
      archived: false,
      createdAt: Date.parse('2026-06-11T00:00:00.000Z'),
      cwd: workspace,
      id: 'codex-subagent-thread',
      rolloutPath: subagentPath,
      threadSource: 'subagent',
      title: 'Worker task',
      updatedAt: Date.parse('2026-06-11T00:00:00.000Z')
    }])

    const userOnly = await previewNativeProjectHistory({
      adapters: ['codex'],
      cwd: workspace,
      env,
      homeDir: home,
      threadScope: 'user'
    })
    const subagentOnly = await previewNativeProjectHistory({
      adapters: ['codex'],
      cwd: workspace,
      env,
      homeDir: home,
      threadScope: 'subagent'
    })

    expect(userOnly.adapters[0]!.candidates).toEqual([
      expect.objectContaining({
        nativeSessionId: 'codex-user-thread',
        threadSource: 'user',
        title: 'User session'
      })
    ])
    expect(subagentOnly.adapters[0]!.candidates).toEqual([
      expect.objectContaining({
        nativeSessionId: 'codex-subagent-thread',
        threadSource: 'subagent',
        title: 'Worker task'
      })
    ])
  })

  it('treats Codex session-indexed subagent threads as user-visible sessions', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    const codexHistoryDir = path.join(home, '.codex', 'sessions')
    const sourcePath = path.join(codexHistoryDir, 'listed-subagent.jsonl')
    const env = createTestEnv(workspace, home)

    await mkdir(workspace, { recursive: true })
    await writeJsonl(sourcePath, [{
      type: 'event_msg',
      payload: {
        type: 'user_message',
        message: 'Delegated but visible'
      }
    }])
    await writeCodexThreadState(home, [{
      archived: false,
      createdAt: Date.parse('2026-06-12T00:00:00.000Z'),
      cwd: workspace,
      id: 'codex-listed-subagent-thread',
      rolloutPath: sourcePath,
      threadSource: 'subagent',
      title: 'SQLite delegated title',
      updatedAt: Date.parse('2026-06-12T01:00:00.000Z')
    }])
    await writeCodexSessionIndex(home, [{
      id: 'codex-listed-subagent-thread',
      threadName: 'Visible delegated title'
    }])

    const userOnly = await previewNativeProjectHistory({
      adapters: ['codex'],
      cwd: workspace,
      env,
      homeDir: home,
      threadScope: 'user'
    })
    const subagentOnly = await previewNativeProjectHistory({
      adapters: ['codex'],
      cwd: workspace,
      env,
      homeDir: home,
      threadScope: 'subagent'
    })

    expect(userOnly.adapters[0]!.candidates).toEqual([
      expect.objectContaining({
        nativeSessionId: 'codex-listed-subagent-thread',
        title: 'Visible delegated title'
      })
    ])
    expect(userOnly.adapters[0]!.candidates[0]!.threadSource).toBeUndefined()
    expect(subagentOnly.adapters[0]!.candidates).toEqual([])
  })

  it('previews Codex history candidates with file sizes before import', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const otherWorkspace = path.join(root, 'other')
    const home = path.join(root, 'home')
    const codexHistoryDir = path.join(home, '.codex', 'sessions')
    const env = createTestEnv(workspace, home)

    await mkdir(workspace, { recursive: true })
    await mkdir(otherWorkspace, { recursive: true })
    await writeJsonl(path.join(codexHistoryDir, 'preview.jsonl'), [
      {
        type: 'session_meta',
        timestamp: '2026-06-05T00:00:00.000Z',
        payload: {
          id: 'codex-preview',
          cwd: workspace
        }
      },
      {
        type: 'event_msg',
        timestamp: '2026-06-05T00:00:01.000Z',
        payload: {
          type: 'user_message',
          message: 'Preview this session'
        }
      }
    ])
    await writeJsonl(path.join(codexHistoryDir, 'other-preview.jsonl'), [
      {
        type: 'session_meta',
        timestamp: '2026-06-05T00:00:00.000Z',
        payload: {
          id: 'codex-other-preview',
          cwd: otherWorkspace
        }
      },
      {
        type: 'event_msg',
        timestamp: '2026-06-05T00:00:01.000Z',
        payload: {
          type: 'user_message',
          message: 'Preview another project'
        }
      }
    ])

    const result = await previewNativeProjectHistory({
      adapters: ['codex'],
      cwd: workspace,
      env,
      homeDir: home
    })
    const allProjectsResult = await previewNativeProjectHistory({
      adapters: ['codex'],
      cwd: workspace,
      env,
      homeDir: home,
      projectScope: 'all-projects'
    })

    expect(result).toEqual(expect.objectContaining({
      largeFiles: 0,
      matchedFiles: 1,
      scannedFiles: 2
    }))
    expect(result.adapters[0]).toEqual(expect.objectContaining({
      adapter: 'codex',
      largeFiles: 0,
      matchedFiles: 1,
      scannedFiles: 2
    }))
    expect(result.adapters[0]!.candidates[0]).toEqual(expect.objectContaining({
      adapter: 'codex',
      cwd: workspace,
      fileSizeBytes: expect.any(Number),
      isArchived: false,
      isImported: false,
      isLarge: false,
      title: 'Preview this session'
    }))
    expect(result.totalBytes).toBeGreaterThan(0)
    expect(result.adapters[0]!.largestFileBytes).toBeGreaterThan(0)
    expect(allProjectsResult).toEqual(expect.objectContaining({
      matchedFiles: 2,
      scannedFiles: 2
    }))
    expect(allProjectsResult.adapters[0]!.candidates.map(candidate => candidate.title).sort()).toEqual([
      'Preview another project',
      'Preview this session'
    ])
  })

  it('previews Codex history candidates with time filters and descending time sort', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    const codexHistoryDir = path.join(home, '.codex', 'sessions')
    const env = createTestEnv(workspace, home)

    await mkdir(workspace, { recursive: true })
    await writeJsonl(path.join(codexHistoryDir, 'updated-late.jsonl'), [
      {
        type: 'session_meta',
        timestamp: '2026-06-01T00:00:00.000Z',
        payload: {
          id: 'codex-updated-late',
          cwd: workspace
        }
      },
      {
        type: 'event_msg',
        timestamp: '2026-06-10T00:00:00.000Z',
        payload: {
          type: 'user_message',
          message: 'Updated late'
        }
      }
    ])
    await writeJsonl(path.join(codexHistoryDir, 'created-later.jsonl'), [
      {
        type: 'session_meta',
        timestamp: '2026-06-08T00:00:00.000Z',
        payload: {
          id: 'codex-created-later',
          cwd: workspace
        }
      },
      {
        type: 'event_msg',
        timestamp: '2026-06-08T01:00:00.000Z',
        payload: {
          type: 'user_message',
          message: 'Created later'
        }
      }
    ])
    await writeJsonl(path.join(codexHistoryDir, 'old.jsonl'), [
      {
        type: 'session_meta',
        timestamp: '2026-05-01T00:00:00.000Z',
        payload: {
          id: 'codex-old',
          cwd: workspace
        }
      },
      {
        type: 'event_msg',
        timestamp: '2026-05-02T00:00:00.000Z',
        payload: {
          type: 'user_message',
          message: 'Old session'
        }
      }
    ])

    const updatedResult = await previewNativeProjectHistory({
      adapters: ['codex'],
      cwd: workspace,
      env,
      homeDir: home,
      timeFilter: {
        updatedAt: { from: Date.parse('2026-06-07T00:00:00.000Z') }
      },
      timeSort: 'activity'
    })
    const createdResult = await previewNativeProjectHistory({
      adapters: ['codex'],
      cwd: workspace,
      env,
      homeDir: home,
      timeFilter: {
        createdAt: { from: Date.parse('2026-06-07T00:00:00.000Z') }
      },
      timeSort: 'createdAt'
    })

    expect(updatedResult).toEqual(expect.objectContaining({
      matchedFiles: 2,
      scannedFiles: 3
    }))
    expect(updatedResult.adapters[0]!.candidates.map(candidate => candidate.title)).toEqual([
      'Updated late',
      'Created later'
    ])
    expect(createdResult).toEqual(expect.objectContaining({
      matchedFiles: 1,
      scannedFiles: 3
    }))
    expect(createdResult.adapters[0]!.candidates[0]).toEqual(expect.objectContaining({
      title: 'Created later'
    }))
  })

  it('prioritizes pinned Codex history candidates before preview pagination', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    const codexHistoryDir = path.join(home, '.codex', 'sessions')
    const env = createTestEnv(workspace, home)
    const pinnedPath = path.join(codexHistoryDir, 'pinned.jsonl')
    const newerPath = path.join(codexHistoryDir, 'newer.jsonl')

    await mkdir(workspace, { recursive: true })
    await Promise.all([
      writeJsonl(pinnedPath, [
        {
          type: 'event_msg',
          payload: {
            type: 'user_message',
            message: 'Pinned older session'
          }
        }
      ]),
      writeJsonl(newerPath, [
        {
          type: 'event_msg',
          payload: {
            type: 'user_message',
            message: 'Newer unpinned session'
          }
        }
      ])
    ])
    await writeCodexThreadState(home, [{
      createdAt: Date.parse('2026-06-01T00:00:00.000Z'),
      cwd: workspace,
      id: 'codex-pinned-session',
      rolloutPath: pinnedPath,
      title: 'Pinned older session',
      updatedAt: Date.parse('2026-06-01T01:00:00.000Z')
    }, {
      createdAt: Date.parse('2026-06-10T00:00:00.000Z'),
      cwd: workspace,
      id: 'codex-newer-session',
      rolloutPath: newerPath,
      title: 'Newer unpinned session',
      updatedAt: Date.parse('2026-06-10T01:00:00.000Z')
    }])
    await writeCodexGlobalState(home, {
      'pinned-thread-ids': ['codex-pinned-session']
    })

    const firstPage = await previewNativeProjectHistory({
      adapters: ['codex'],
      cwd: workspace,
      env,
      homeDir: home,
      previewLimit: 1,
      timeSort: 'activity'
    })
    const fullPreview = await previewNativeProjectHistory({
      adapters: ['codex'],
      cwd: workspace,
      env,
      homeDir: home,
      timeSort: 'activity'
    })

    expect(firstPage).toEqual(expect.objectContaining({
      hasMore: true,
      matchedFiles: 1,
      scannedFiles: 2
    }))
    expect(firstPage.adapters[0]!.candidates[0]).toEqual(expect.objectContaining({
      isPinned: true,
      nativeSessionId: 'codex-pinned-session',
      title: 'Pinned older session'
    }))
    expect(fullPreview.adapters[0]!.candidates.map(candidate => ({
      isPinned: candidate.isPinned,
      title: candidate.title
    }))).toEqual([{
      isPinned: true,
      title: 'Pinned older session'
    }, {
      isPinned: false,
      title: 'Newer unpinned session'
    }])
  })

  it('uses Codex SQLite metadata by thread id when rollout path does not match the source file', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const staleWorkspace = path.join(root, 'deleted-worktree')
    const home = path.join(root, 'home')
    const codexHistoryDir = path.join(home, '.codex', 'sessions')
    const env = createTestEnv(workspace, home)
    const sourcePath = path.join(codexHistoryDir, 'actual.jsonl')

    await mkdir(workspace, { recursive: true })
    await writeJsonl(sourcePath, [
      {
        type: 'session_meta',
        timestamp: '2026-06-01T00:00:00.000Z',
        payload: {
          cwd: staleWorkspace,
          id: 'codex-sqlite-title',
          thread_name: 'JSONL original prompt title'
        }
      },
      {
        type: 'event_msg',
        timestamp: '2026-06-01T00:00:01.000Z',
        payload: {
          type: 'user_message',
          message: 'JSONL first user prompt'
        }
      }
    ])
    await writeCodexThreadState(home, [{
      createdAt: Date.parse('2026-06-02T00:00:00.000Z'),
      cwd: workspace,
      id: 'codex-sqlite-title',
      rolloutPath: path.join(codexHistoryDir, 'stale-rollout-path.jsonl'),
      title: 'SQLite generated title',
      updatedAt: Date.parse('2026-06-03T00:00:00.000Z')
    }])

    const preview = await previewNativeProjectHistory({
      adapters: ['codex'],
      cwd: workspace,
      env,
      homeDir: home,
      sourcePaths: [sourcePath]
    })
    const imported = await importNativeProjectHistory({
      adapters: ['codex'],
      cwd: workspace,
      env,
      homeDir: home,
      sourcePaths: [sourcePath]
    })

    expect(preview.adapters[0]!.candidates[0]).toEqual(expect.objectContaining({
      cwd: workspace,
      nativeSessionId: 'codex-sqlite-title',
      title: 'SQLite generated title',
      updatedAt: Date.parse('2026-06-03T00:00:00.000Z')
    }))
    expect(imported.sessions[0]).toEqual(expect.objectContaining({
      title: 'SQLite generated title'
    }))
  })

  it('prefers Codex session index thread names over SQLite titles', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    const codexHistoryDir = path.join(home, '.codex', 'sessions')
    const env = createTestEnv(workspace, home)
    const sourcePath = path.join(codexHistoryDir, 'session-index-title.jsonl')

    await mkdir(workspace, { recursive: true })
    await writeJsonl(sourcePath, [
      {
        type: 'session_meta',
        timestamp: '2026-06-01T00:00:00.000Z',
        payload: {
          cwd: workspace,
          id: 'codex-session-index-title'
        }
      },
      {
        type: 'event_msg',
        timestamp: '2026-06-01T00:00:01.000Z',
        payload: {
          type: 'user_message',
          message: 'Long first user prompt title'
        }
      }
    ])
    await writeCodexThreadState(home, [{
      createdAt: Date.parse('2026-06-01T00:00:00.000Z'),
      cwd: workspace,
      id: 'codex-session-index-title',
      rolloutPath: sourcePath,
      title: 'SQLite full prompt title',
      updatedAt: Date.parse('2026-06-02T00:00:00.000Z')
    }])
    await writeCodexSessionIndex(home, [{
      id: 'codex-session-index-title',
      threadName: 'Sidebar compact title',
      updatedAt: '2026-06-01T00:00:02.000Z'
    }])

    const preview = await previewNativeProjectHistory({
      adapters: ['codex'],
      cwd: workspace,
      env,
      homeDir: home,
      sourcePaths: [sourcePath]
    })
    const imported = await importNativeProjectHistory({
      adapters: ['codex'],
      cwd: workspace,
      env,
      homeDir: home,
      sourcePaths: [sourcePath]
    })

    expect(preview.adapters[0]!.candidates[0]).toEqual(expect.objectContaining({
      nativeSessionId: 'codex-session-index-title',
      title: 'Sidebar compact title',
      updatedAt: Date.parse('2026-06-02T00:00:00.000Z')
    }))
    expect(imported.sessions[0]).toEqual(expect.objectContaining({
      title: 'Sidebar compact title',
      updatedAt: Date.parse('2026-06-02T00:00:00.000Z')
    }))
  })

  it('marks Codex archived history candidates in preview metadata', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    const codexHistoryDir = path.join(home, '.codex', 'archived_sessions')
    const env = createTestEnv(workspace, home)

    await mkdir(workspace, { recursive: true })
    await writeJsonl(path.join(codexHistoryDir, 'archived-preview.jsonl'), [
      {
        type: 'session_meta',
        timestamp: '2026-06-06T00:00:00.000Z',
        payload: {
          id: 'codex-archived-preview',
          cwd: workspace
        }
      },
      {
        type: 'event_msg',
        timestamp: '2026-06-06T00:00:01.000Z',
        payload: {
          type: 'user_message',
          message: 'Preview archived session'
        }
      }
    ])

    const result = await previewNativeProjectHistory({
      adapters: ['codex'],
      cwd: workspace,
      env,
      homeDir: home
    })

    expect(result.adapters[0]!.candidates[0]).toEqual(expect.objectContaining({
      isArchived: true,
      title: 'Preview archived session'
    }))
  })

  it('paginates preview candidates and filters candidate archive scope', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    const codexHistoryDir = path.join(home, '.codex', 'sessions')
    const env = createTestEnv(workspace, home)
    const archivedPath = path.join(codexHistoryDir, 'archived.jsonl')
    const newerPath = path.join(codexHistoryDir, 'newer.jsonl')
    const olderPath = path.join(codexHistoryDir, 'older.jsonl')

    await mkdir(workspace, { recursive: true })
    await Promise.all([
      writeJsonl(archivedPath, [{ type: 'event_msg', payload: { type: 'user_message', message: 'Archived' } }]),
      writeJsonl(newerPath, [{ type: 'event_msg', payload: { type: 'user_message', message: 'Newer' } }]),
      writeJsonl(olderPath, [{ type: 'event_msg', payload: { type: 'user_message', message: 'Older' } }])
    ])
    await writeCodexThreadState(home, [{
      archived: true,
      createdAt: Date.parse('2026-06-03T00:00:00.000Z'),
      cwd: workspace,
      id: 'codex-archived-page',
      rolloutPath: archivedPath,
      title: 'Archived page',
      updatedAt: Date.parse('2026-06-13T00:00:00.000Z')
    }, {
      archived: false,
      createdAt: Date.parse('2026-06-02T00:00:00.000Z'),
      cwd: workspace,
      id: 'codex-newer-page',
      rolloutPath: newerPath,
      title: 'Newer page',
      updatedAt: Date.parse('2026-06-12T00:00:00.000Z')
    }, {
      archived: false,
      createdAt: Date.parse('2026-06-01T00:00:00.000Z'),
      cwd: workspace,
      id: 'codex-older-page',
      rolloutPath: olderPath,
      title: 'Older page',
      updatedAt: Date.parse('2026-06-11T00:00:00.000Z')
    }])

    const firstPage = await previewNativeProjectHistory({
      adapters: ['codex'],
      candidateScope: 'unarchived',
      cwd: workspace,
      env,
      homeDir: home,
      previewLimit: 1,
      timeSort: 'activity'
    })
    const secondPage = await previewNativeProjectHistory({
      adapters: ['codex'],
      candidateScope: 'unarchived',
      cwd: workspace,
      env,
      homeDir: home,
      previewCursor: firstPage.nextCursor,
      previewLimit: 1,
      timeSort: 'activity'
    })
    const archivedOnly = await previewNativeProjectHistory({
      adapters: ['codex'],
      candidateScope: 'archived',
      cwd: workspace,
      env,
      homeDir: home,
      previewLimit: 5,
      timeSort: 'activity'
    })

    expect(firstPage).toEqual(expect.objectContaining({
      hasMore: true,
      isComplete: false,
      matchedFiles: 1,
      scannedFiles: 3
    }))
    expect(firstPage.nextCursor).toEqual(expect.any(String))
    expect(firstPage.adapters[0]).toEqual(expect.objectContaining({
      hasMore: true,
      isComplete: false
    }))
    expect(firstPage.adapters[0]!.candidates.map(candidate => candidate.title)).toEqual(['Newer page'])
    expect(secondPage).toEqual(expect.objectContaining({
      hasMore: false,
      isComplete: true,
      matchedFiles: 1,
      scannedFiles: 3
    }))
    expect(secondPage.adapters[0]!.candidates.map(candidate => candidate.title)).toEqual(['Older page'])
    expect(archivedOnly.adapters[0]!.candidates.map(candidate => candidate.title)).toEqual(['Archived page'])
  })

  it('filters already imported native history out of preview candidates', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    const codexHistoryDir = path.join(home, '.codex', 'sessions')
    const env = createTestEnv(workspace, home)
    const sourcePath = path.join(codexHistoryDir, 'imported.jsonl')

    await mkdir(workspace, { recursive: true })
    await writeJsonl(sourcePath, [
      {
        type: 'session_meta',
        timestamp: '2026-06-07T00:00:00.000Z',
        payload: {
          id: 'codex-imported-preview',
          cwd: workspace
        }
      },
      {
        type: 'event_msg',
        timestamp: '2026-06-07T00:00:01.000Z',
        payload: {
          type: 'user_message',
          message: 'Already imported'
        }
      }
    ])

    await importNativeProjectHistory({
      adapters: ['codex'],
      cwd: workspace,
      env,
      homeDir: home,
      sourcePaths: [sourcePath]
    })

    const result = await previewNativeProjectHistory({
      adapters: ['codex'],
      cwd: workspace,
      env,
      homeDir: home
    })

    expect(result).toEqual(expect.objectContaining({
      matchedFiles: 0,
      scannedFiles: 1
    }))
    expect(result.adapters[0]!.candidates).toEqual([])
  })

  it('skips native history files above the configured import size limit', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    const codexHistoryDir = path.join(home, '.codex', 'sessions')
    const env = createTestEnv(workspace, home)
    const smallFile = path.join(codexHistoryDir, 'small.jsonl')

    await mkdir(workspace, { recursive: true })
    await writeJsonl(smallFile, [
      {
        type: 'session_meta',
        timestamp: '2026-06-06T00:00:00.000Z',
        payload: {
          id: 'codex-small',
          cwd: workspace
        }
      },
      {
        type: 'event_msg',
        timestamp: '2026-06-06T00:00:01.000Z',
        payload: {
          type: 'user_message',
          message: 'Import the small one'
        }
      }
    ])
    const smallFileSize = (await stat(smallFile)).size
    await writeJsonl(path.join(codexHistoryDir, 'large.jsonl'), [
      {
        type: 'session_meta',
        timestamp: '2026-06-06T00:00:00.000Z',
        payload: {
          id: 'codex-large',
          cwd: workspace,
          thread_name: 'Skip large history'
        }
      },
      {
        type: 'event_msg',
        timestamp: '2026-06-06T00:00:01.000Z',
        payload: {
          type: 'user_message',
          message: 'x'.repeat(4096)
        }
      }
    ])

    const result = await importNativeProjectHistory({
      adapters: ['codex'],
      cwd: workspace,
      env,
      homeDir: home,
      maxFileSizeBytes: smallFileSize
    })

    expect(result).toEqual(expect.objectContaining({
      importedEvents: 1,
      importedSessions: 1,
      matchedFiles: 1,
      scannedFiles: 2
    }))
    expect(result.sessions[0]).toEqual(expect.objectContaining({
      title: 'Import the small one'
    }))
  })

  it('marks native history import as handled for the first project open', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    const codexHistoryDir = path.join(home, '.codex', 'sessions')
    const env = createTestEnv(workspace, home)

    await mkdir(workspace, { recursive: true })
    await writeJsonl(path.join(codexHistoryDir, 'first-open.jsonl'), [
      {
        type: 'session_meta',
        timestamp: '2026-06-03T00:00:00.000Z',
        payload: {
          id: 'codex-first-open',
          cwd: workspace
        }
      },
      {
        type: 'event_msg',
        timestamp: '2026-06-03T00:00:01.000Z',
        payload: {
          type: 'user_message',
          message: 'Import on first open'
        }
      }
    ])

    const firstImport = await prepareNativeProjectHistoryFirstOpenImport({
      adapters: ['codex'],
      cwd: workspace,
      env,
      homeDir: home
    })
    const secondImport = await prepareNativeProjectHistoryFirstOpenImport({
      adapters: ['codex'],
      cwd: workspace,
      env,
      homeDir: home
    })
    const markerDir = resolveProjectHomePath(
      workspace,
      createWorkspaceRuntimeEnv(workspace, env),
      'caches',
      'native-history-import'
    )

    const markerStat = await stat(markerDir)

    expect(markerStat.isDirectory()).toBe(true)
    expect(firstImport).toEqual(expect.objectContaining({
      importedEvents: 1,
      importedSessions: 1,
      matchedFiles: 1
    }))
    expect(secondImport).toEqual({
      importedEvents: 0,
      importedSessions: 0,
      matchedFiles: 0,
      scannedFiles: 0,
      sessions: []
    })
  })

  it('matches Claude Code history against the primary workspace for worktree sessions', async () => {
    const root = await createTempRoot()
    const worktree = path.join(root, 'worktrees', 'feature')
    const primaryWorkspace = path.join(root, 'app')
    const home = path.join(root, 'home')
    const claudeHistoryDir = path.join(home, '.claude', 'projects', 'app')
    const env = createTestEnv(worktree, home, primaryWorkspace)

    await mkdir(worktree, { recursive: true })
    await mkdir(primaryWorkspace, { recursive: true })
    await writeJsonl(path.join(claudeHistoryDir, 'claude-native-1.jsonl'), [
      {
        type: 'summary',
        cwd: primaryWorkspace,
        sessionId: 'claude-native-1',
        timestamp: '2026-06-02T00:00:00.000Z',
        summary: 'Primary workspace summary'
      },
      {
        type: 'user',
        cwd: path.join(primaryWorkspace, 'apps', 'client'),
        sessionId: 'claude-native-1',
        timestamp: '2026-06-02T00:00:01.000Z',
        uuid: 'user-1',
        message: {
          role: 'user',
          content: 'Review the client'
        }
      },
      {
        type: 'assistant',
        cwd: primaryWorkspace,
        sessionId: 'claude-native-1',
        timestamp: '2026-06-02T00:00:02.000Z',
        uuid: 'assistant-1',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Client reviewed.' },
            { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: 'apps/client/package.json' } },
            { type: 'tool_result', tool_use_id: 'tool-1', content: 'ok' }
          ]
        }
      }
    ])

    const result = await importNativeProjectHistory({
      adapters: ['claude-code'],
      cwd: worktree,
      env,
      homeDir: home
    })

    expect(result).toEqual(expect.objectContaining({
      importedEvents: 2,
      importedSessions: 1,
      matchedFiles: 1,
      scannedFiles: 1
    }))

    const runtimeRoot = resolveWorkspaceRuntimeStoreRoot(worktree, createWorkspaceRuntimeEnv(worktree, env))
    const db = await replayImportedSessions(runtimeRoot)
    const importedSessionId = result.sessions[0]!.sessionId

    expect(db.getSession(importedSessionId)).toEqual(expect.objectContaining({
      adapter: 'claude-code',
      status: 'completed',
      title: 'Review the client'
    }))
    expect(db.getMessages(importedSessionId)).toEqual([
      expect.objectContaining({
        type: 'message',
        message: expect.objectContaining({
          role: 'user',
          content: 'Review the client'
        })
      }),
      expect.objectContaining({
        type: 'message',
        message: expect.objectContaining({
          role: 'assistant',
          content: [
            { type: 'text', text: 'Client reviewed.' },
            { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: 'apps/client/package.json' } },
            { type: 'tool_result', tool_use_id: 'tool-1', content: 'ok' }
          ]
        })
      })
    ])
    db.close()
  })
})
