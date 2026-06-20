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

  it('previews Codex history candidates with file sizes before import', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    const codexHistoryDir = path.join(home, '.codex', 'sessions')
    const env = createTestEnv(workspace, home)

    await mkdir(workspace, { recursive: true })
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

    const result = await previewNativeProjectHistory({
      adapters: ['codex'],
      cwd: workspace,
      env,
      homeDir: home
    })

    expect(result).toEqual(expect.objectContaining({
      largeFiles: 0,
      matchedFiles: 1,
      scannedFiles: 1
    }))
    expect(result.adapters[0]).toEqual(expect.objectContaining({
      adapter: 'codex',
      largeFiles: 0,
      matchedFiles: 1,
      scannedFiles: 1
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
