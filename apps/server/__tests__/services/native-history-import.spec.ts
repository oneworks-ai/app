/* eslint-disable max-lines -- native history import fixtures cover parser, matching, preview, and size-limit behavior together. */
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { truncateSync } from 'node:fs'
import {
  chmod,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  truncate,
  utimes,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Config } from '@oneworks/types'
import { resolveProjectHomePath } from '@oneworks/utils/ai-path'

import { SqliteDb } from '#~/db/index.js'
import { createSqliteDatabase } from '#~/db/sqlite.js'
import { listLauncherWorkspaces, rememberLauncherWorkspaces } from '#~/services/launcher/manager.js'
import { discoverRuntimeSessionStores } from '#~/services/runtime-store/discovery.js'
import {
  DEFAULT_NATIVE_HISTORY_IMPORT_MAX_FILE_SIZE_BYTES,
  autoImportNativeProjectHistoryAndReplay,
  importNativeProjectHistory,
  prepareNativeProjectHistoryFirstOpenImport,
  previewNativeProjectHistory,
  resolveNativeHistoryAutoImportOptions
} from '#~/services/runtime-store/history-import.js'
import { replayRuntimeStore } from '#~/services/runtime-store/watcher.js'
import { createWorkspaceRuntimeEnv, resolveWorkspaceRuntimeStoreRoot } from '#~/services/runtime-store/workspace-env.js'

const tempDirs: string[] = []
const originalCwd = process.cwd()
const qwenFixtureRoot = path.resolve(
  __dirname,
  '../fixtures/qwen-code-0.21.11'
)
const qwenFixtureFiles = [
  'projects/-fixture/chats/1c408cc2-a3f3-4881-9807-4782e1788ffa.jsonl',
  'projects/-fixture/chats/da59db28-d7e8-4167-bc90-10a7b5bdec78.jsonl',
  'projects/-fixture/subagents/da59db28-d7e8-4167-bc90-10a7b5bdec78/agent-general-purpose-call_agent_fixture.jsonl',
  'projects/-fixture/subagents/da59db28-d7e8-4167-bc90-10a7b5bdec78/agent-general-purpose-call_agent_fixture.meta.json'
] as const

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

const createTempRoot = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ow-native-history-'))
  tempDirs.push(dir)
  return dir
}

const writeJsonl = async (filePath: string, records: unknown[]) => {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${records.map(record => JSON.stringify(record)).join('\n')}\n`, 'utf8')
}

const materializeQwenFixture = async (params: {
  cwd: string
  runtimeDir: string
}) => {
  const sourceHashes = new Map<string, string>()
  for (const relativePath of qwenFixtureFiles) {
    const source = await readFile(path.join(qwenFixtureRoot, relativePath), 'utf8')
    const targetPath = path.join(params.runtimeDir, relativePath)
    const content = source
      .replaceAll('<QWEN_FIXTURE_CWD>', params.cwd)
      .replaceAll('<QWEN_FIXTURE_RUNTIME>', params.runtimeDir)
    await mkdir(path.dirname(targetPath), { recursive: true })
    await writeFile(targetPath, content, 'utf8')
    sourceHashes.set(targetPath, sha256(content))
  }
  return sourceHashes
}

const sha256File = async (filePath: string) => (
  createHash('sha256').update(await readFile(filePath)).digest('hex')
)

const writeGitOrigin = async (repoRoot: string, remoteUrl: string) => {
  await mkdir(path.join(repoRoot, '.git'), { recursive: true })
  await writeFile(
    path.join(repoRoot, '.git', 'config'),
    `[remote "origin"]\n\turl = ${remoteUrl}\n`,
    'utf8'
  )
}

describe('native history automatic import size policy', () => {
  it('resolves null, inheritance, adapter overrides, and non-Qwen adapters without clamping', () => {
    const hardLimit = DEFAULT_NATIVE_HISTORY_IMPORT_MAX_FILE_SIZE_BYTES
    const belowLimit = hardLimit - 1

    expect(resolveNativeHistoryAutoImportOptions({
      nativeHistoryImport: { autoImport: true, maxFileSizeBytes: null }
    })).toEqual({
      adapters: ['codex', 'claude-code', 'cline', 'cursor', 'droid', 'goose', 'grok', 'qwen-code'],
      bestEffortUnavailableAdapters: [
        'codex',
        'claude-code',
        'cline',
        'cursor',
        'droid',
        'goose',
        'grok',
        'qwen-code'
      ],
      maxFileSizeBytes: hardLimit,
      threadScope: 'user'
    })
    expect(resolveNativeHistoryAutoImportOptions({
      nativeHistoryImport: {
        autoImport: true,
        maxFileSizeBytes: belowLimit,
        adapters: {
          cursor: { maxFileSizeBytes: null },
          grok: { autoImport: false },
          'qwen-code': { maxFileSizeBytes: hardLimit }
        }
      }
    })).toEqual({
      adapters: ['codex', 'claude-code', 'cline', 'cursor', 'droid', 'goose', 'qwen-code'],
      bestEffortUnavailableAdapters: ['codex', 'claude-code', 'cline', 'cursor', 'droid', 'goose', 'qwen-code'],
      maxFileSizeBytes: belowLimit,
      maxFileSizeBytesByAdapter: {
        cursor: hardLimit,
        'qwen-code': hardLimit
      },
      threadScope: 'user'
    })
    expect(() =>
      resolveNativeHistoryAutoImportOptions({
        nativeHistoryImport: {
          autoImport: true,
          maxFileSizeBytes: hardLimit + 1
        }
      })
    ).toThrow('Native history import size limit must be between')
  })
})

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

describe('factory Droid native history import', () => {
  const fixtureDir = path.join(__dirname, '../fixtures/factory-sessions')

  const installFixture = async (params: {
    fixtureName: string
    home: string
    nativeSessionId: string
    workspace: string
  }) => {
    const source = await readFile(path.join(fixtureDir, params.fixtureName), 'utf8')
    const target = path.join(
      params.home,
      '.factory',
      'sessions',
      `-${params.workspace.replaceAll(path.sep, '-')}`,
      `${params.nativeSessionId}.jsonl`
    )
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, source.replaceAll('FACTORY_FIXTURE_CWD', params.workspace), 'utf8')
    return target
  }

  it('previews user/subagent sessions and imports native ids, parent chains, and tool results read-only', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    const env = createTestEnv(workspace, home)
    await mkdir(workspace, { recursive: true })
    const parentPath = await installFixture({
      fixtureName: 'factory-parent-1.jsonl',
      home,
      nativeSessionId: 'factory-parent-1',
      workspace
    })
    await installFixture({
      fixtureName: 'factory-worker-1.jsonl',
      home,
      nativeSessionId: 'factory-worker-1',
      workspace
    })
    const settingsPath = path.join(path.dirname(parentPath), 'factory-parent-1.settings.json')
    const credentialsPath = path.join(home, '.factory', 'credentials.json')
    await writeFile(settingsPath, '{not-json-on-purpose', 'utf8')
    await writeFile(credentialsPath, 'credential-canary', 'utf8')

    const userPreview = await previewNativeProjectHistory({
      adapters: ['droid'],
      cwd: workspace,
      env,
      homeDir: home,
      threadScope: 'user'
    })
    const subagentPreview = await previewNativeProjectHistory({
      adapters: ['droid'],
      cwd: workspace,
      env,
      homeDir: home,
      threadScope: 'subagent'
    })
    expect(userPreview.adapters[0]!.candidates).toEqual([
      expect.objectContaining({ nativeSessionId: 'factory-parent-1', title: 'Factory parent fixture' })
    ])
    expect(subagentPreview.adapters[0]!.candidates).toEqual([
      expect.objectContaining({
        nativeSessionId: 'factory-worker-1',
        threadSource: 'subagent',
        title: 'Factory worker fixture'
      })
    ])

    const result = await importNativeProjectHistory({
      adapters: ['droid'],
      cwd: workspace,
      env,
      homeDir: home,
      sourcePaths: [parentPath]
    })
    expect(result).toEqual(expect.objectContaining({
      importedEvents: 4,
      importedSessions: 1,
      matchedFiles: 1,
      scannedFiles: 1
    }))
    const runtimeRoot = resolveWorkspaceRuntimeStoreRoot(workspace, createWorkspaceRuntimeEnv(workspace, env))
    const eventPath = path.join(runtimeRoot, 'sessions', result.sessions[0]!.sessionId, 'events.jsonl')
    const events = (await readFile(eventPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(events[1]).toEqual(expect.objectContaining({
      id: 'parent-assistant-1',
      parentEventId: 'parent-user-1'
    }))
    expect(events[2]).toEqual(expect.objectContaining({
      role: 'assistant',
      parentEventId: 'parent-assistant-1',
      content: expect.arrayContaining([
        expect.objectContaining({
          type: 'tool_result',
          tool_use_id: 'factory-tool-1',
          is_error: false
        }),
        { type: 'image', url: 'data:image/png;base64,iVBORw0KGgo=' },
        expect.objectContaining({
          type: 'file',
          name: 'result.txt',
          mimeType: 'text/plain',
          data: 'Factory report text',
          encoding: 'utf8'
        })
      ]),
      ts: 1786492802000
    }))
    expect(events[3]).toEqual(expect.objectContaining({
      id: 'parent-document-1',
      role: 'assistant',
      parentEventId: 'parent-tool-result-1',
      content: [expect.objectContaining({
        type: 'file',
        name: 'report.pdf',
        mimeType: 'application/pdf',
        data: 'JVBERg==',
        encoding: 'base64'
      })]
    }))

    const db = await replayImportedSessions(runtimeRoot)
    const messages = db.getMessages(result.sessions[0]!.sessionId)
    expect(messages).toHaveLength(4)
    expect(messages[2]).toEqual(expect.objectContaining({
      message: expect.objectContaining({
        role: 'assistant',
        content: expect.arrayContaining([
          expect.objectContaining({
            type: 'tool_result',
            tool_use_id: 'factory-tool-1'
          }),
          expect.objectContaining({
            type: 'file',
            mimeType: 'text/plain',
            data: 'Factory report text'
          })
        ])
      })
    }))
    expect(messages[3]).toEqual(expect.objectContaining({
      message: expect.objectContaining({
        role: 'assistant',
        content: [expect.objectContaining({
          type: 'file',
          mimeType: 'application/pdf',
          data: 'JVBERg=='
        })]
      })
    }))
    db.close()
    expect(await readFile(settingsPath, 'utf8')).toBe('{not-json-on-purpose')
    expect(await readFile(credentialsPath, 'utf8')).toBe('credential-canary')

    const duplicate = await importNativeProjectHistory({
      adapters: ['droid'],
      cwd: workspace,
      env,
      homeDir: home,
      sourcePaths: [parentPath]
    })
    expect(duplicate).toEqual(expect.objectContaining({ importedEvents: 0, importedSessions: 0, matchedFiles: 0 }))
  })

  it('deduplicates authoritative native ids across all-project source paths and honors projectPaths', async () => {
    const root = await createTempRoot()
    const currentWorkspace = path.join(root, 'current')
    const selectedWorkspace = path.join(root, 'selected')
    const home = path.join(root, 'home')
    const env = createTestEnv(currentWorkspace, home)
    await Promise.all([
      mkdir(currentWorkspace, { recursive: true }),
      mkdir(selectedWorkspace, { recursive: true })
    ])
    const firstPath = await installFixture({
      fixtureName: 'factory-parent-1.jsonl',
      home,
      nativeSessionId: 'factory-parent-1',
      workspace: selectedWorkspace
    })
    const duplicateDir = path.join(home, '.factory', 'sessions', '-duplicate-project')
    const duplicatePath = path.join(duplicateDir, 'factory-parent-1.jsonl')
    await mkdir(duplicateDir, { recursive: true })
    await writeFile(duplicatePath, await readFile(firstPath, 'utf8'), 'utf8')

    const preview = await previewNativeProjectHistory({
      adapters: ['droid'],
      cwd: currentWorkspace,
      env,
      homeDir: home,
      projectPaths: [selectedWorkspace],
      projectScope: 'all-projects',
      sourcePaths: [firstPath, duplicatePath]
    })
    expect(preview.adapters[0]!.projects).toEqual([
      expect.objectContaining({ path: await realpath(selectedWorkspace), sessionCount: 2 })
    ])
    const result = await importNativeProjectHistory({
      adapters: ['droid'],
      cwd: currentWorkspace,
      env,
      homeDir: home,
      projectPaths: [selectedWorkspace],
      projectScope: 'all-projects',
      sourcePaths: [firstPath, duplicatePath]
    })
    expect(result).toEqual(expect.objectContaining({ importedSessions: 1, matchedFiles: 1, scannedFiles: 2 }))
    expect(result.sessions[0]).toEqual(expect.objectContaining({
      adapter: 'droid',
      workspaceCwd: await realpath(selectedWorkspace)
    }))
  })

  it('fails closed for malformed, oversized, outside-root, and symlinked Droid sources', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    const env = createTestEnv(workspace, home)
    await mkdir(workspace, { recursive: true })
    const validPath = await installFixture({
      fixtureName: 'factory-parent-1.jsonl',
      home,
      nativeSessionId: 'factory-parent-1',
      workspace
    })
    const malformedPath = path.join(path.dirname(validPath), 'malformed.jsonl')
    const outsidePath = path.join(root, 'outside.jsonl')
    const symlinkPath = path.join(path.dirname(validPath), 'linked.jsonl')
    const outsideDir = path.join(root, 'outside-dir')
    const linkedDir = path.join(path.dirname(validPath), 'linked-dir')
    const ancestorSymlinkPath = path.join(linkedDir, 'outside.jsonl')
    await writeFile(malformedPath, '{"type":"session_start","title":"missing cwd"}\nnot-json\n', 'utf8')
    await writeFile(outsidePath, await readFile(validPath, 'utf8'), 'utf8')
    await symlink(validPath, symlinkPath)
    await mkdir(outsideDir, { recursive: true })
    await writeFile(path.join(outsideDir, 'outside.jsonl'), await readFile(validPath, 'utf8'), 'utf8')
    await symlink(outsideDir, linkedDir)

    const result = await importNativeProjectHistory({
      adapters: ['droid'],
      cwd: workspace,
      env,
      homeDir: home,
      maxFileSizeBytes: (await stat(validPath)).size - 1,
      sourcePaths: [validPath, malformedPath, outsidePath, symlinkPath, ancestorSymlinkPath]
    })
    expect(result).toEqual(expect.objectContaining({
      importedEvents: 0,
      importedSessions: 0,
      matchedFiles: 0,
      perFileLimitedFiles: 2,
      rejectedFiles: 1,
      scannedFiles: 4
    }))
  })

  it('fails closed when the Factory sessions source root is a symlink', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    const outsideSessions = path.join(root, 'outside-sessions')
    const env = createTestEnv(workspace, home)
    await Promise.all([
      mkdir(workspace, { recursive: true }),
      mkdir(outsideSessions, { recursive: true }),
      mkdir(path.join(home, '.factory'), { recursive: true })
    ])
    const source = await readFile(path.join(fixtureDir, 'factory-parent-1.jsonl'), 'utf8')
    const outsidePath = path.join(outsideSessions, 'factory-parent-1.jsonl')
    await writeFile(outsidePath, source.replaceAll('FACTORY_FIXTURE_CWD', workspace), 'utf8')
    await symlink(outsideSessions, path.join(home, '.factory', 'sessions'))

    const preview = await previewNativeProjectHistory({
      adapters: ['droid'],
      cwd: workspace,
      env,
      homeDir: home
    })
    expect(preview).toEqual(expect.objectContaining({ matchedFiles: 0, rejectedFiles: 0, scannedFiles: 0 }))
    expect(preview.adapters[0]).toEqual(expect.objectContaining({ candidates: [], scannedFiles: 0 }))

    const result = await importNativeProjectHistory({
      adapters: ['droid'],
      cwd: workspace,
      env,
      homeDir: home,
      sourcePaths: [outsidePath]
    })
    expect(result).toEqual(expect.objectContaining({
      importedEvents: 0,
      importedSessions: 0,
      matchedFiles: 0,
      rejectedFiles: 0,
      scannedFiles: 0
    }))
  })

  it('rejects a symlinked .factory ancestor without reading or mutating its outside sentinel', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    const outsideFactory = path.join(root, 'outside-factory')
    const outsideSessions = path.join(outsideFactory, 'sessions', '-outside-project')
    const outsidePath = path.join(outsideSessions, 'factory-parent-1.jsonl')
    const sentinelPath = path.join(outsideFactory, 'credentials.json')
    const env = createTestEnv(workspace, home)
    await Promise.all([
      mkdir(workspace, { recursive: true }),
      mkdir(home, { recursive: true }),
      mkdir(outsideSessions, { recursive: true })
    ])
    const source = await readFile(path.join(fixtureDir, 'factory-parent-1.jsonl'), 'utf8')
    await writeFile(outsidePath, source.replaceAll('FACTORY_FIXTURE_CWD', workspace), 'utf8')
    await writeFile(sentinelPath, 'outside-credential-sentinel', 'utf8')
    const sourceHash = await sha256File(outsidePath)
    const sentinelHash = await sha256File(sentinelPath)
    await symlink(outsideFactory, path.join(home, '.factory'))
    const requestedPath = path.join(
      home,
      '.factory',
      'sessions',
      '-outside-project',
      'factory-parent-1.jsonl'
    )

    const preview = await previewNativeProjectHistory({
      adapters: ['droid'],
      cwd: workspace,
      env,
      homeDir: home,
      sourcePaths: [requestedPath]
    })
    const imported = await importNativeProjectHistory({
      adapters: ['droid'],
      cwd: workspace,
      env,
      homeDir: home,
      sourcePaths: [requestedPath]
    })

    expect(preview).toEqual(expect.objectContaining({ matchedFiles: 0, rejectedFiles: 1, scannedFiles: 1 }))
    expect(imported).toEqual(expect.objectContaining({
      importedEvents: 0,
      importedSessions: 0,
      matchedFiles: 0,
      rejectedFiles: 1,
      scannedFiles: 1
    }))
    expect(await sha256File(outsidePath)).toBe(sourceHash)
    expect(await sha256File(sentinelPath)).toBe(sentinelHash)
  })

  it('bounds Droid preview bytes by default, skips sparse/growing files, and keeps truthful small-file totals', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    const env = createTestEnv(workspace, home)
    await mkdir(workspace, { recursive: true })
    const smallPath = await installFixture({
      fixtureName: 'factory-parent-1.jsonl',
      home,
      nativeSessionId: 'factory-parent-1',
      workspace
    })
    const largePath = path.join(path.dirname(smallPath), 'factory-large.jsonl')
    await writeFile(
      largePath,
      `${
        JSON.stringify({
          type: 'session_start',
          sessionId: 'factory-large',
          title: 'Too large',
          cwd: workspace
        })
      }\n`,
      'utf8'
    )
    const handle = await open(largePath, 'r+')
    await handle.truncate(DEFAULT_NATIVE_HISTORY_IMPORT_MAX_FILE_SIZE_BYTES + 1)
    await handle.close()
    const largeBefore = await stat(largePath)
    const smallBytes = (await stat(smallPath)).size

    const preview = await previewNativeProjectHistory({
      adapters: ['droid'],
      cwd: workspace,
      env,
      homeDir: home,
      previewLimit: 1
    })
    expect(preview).toEqual(expect.objectContaining({
      largeFiles: 1,
      matchedFiles: 1,
      largestFileBytes: largeBefore.size,
      perFileLimitedFiles: 1,
      totalBytes: smallBytes + largeBefore.size
    }))
    expect(preview.adapters[0]).toEqual(expect.objectContaining({
      candidates: [expect.objectContaining({
        fileSizeBytes: smallBytes,
        nativeSessionId: 'factory-parent-1'
      })],
      perFileLimitedFiles: 1,
      scannedFiles: 2,
      totalBytes: smallBytes + largeBefore.size
    }))
    expect(await stat(largePath)).toEqual(expect.objectContaining({
      size: largeBefore.size
    }))

    const growingPath = path.join(path.dirname(smallPath), 'factory-growing.jsonl')
    await writeFile(growingPath, await readFile(smallPath))
    const growingPreview = previewNativeProjectHistory({
      adapters: ['droid'],
      cwd: workspace,
      env,
      homeDir: home,
      maxFileSizeBytes: smallBytes,
      sourcePaths: [growingPath]
    })
    const growingHandle = await open(growingPath, 'a')
    await growingHandle.write('x'.repeat(smallBytes + 1))
    await growingHandle.close()
    expect((await growingPreview).matchedFiles).toBe(0)
  })

  it('applies the default manual import cap to sparse, growing, and giant-line Droid files', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    const env = createTestEnv(workspace, home)
    await mkdir(workspace, { recursive: true })
    const smallPath = await installFixture({
      fixtureName: 'factory-parent-1.jsonl',
      home,
      nativeSessionId: 'factory-parent-1',
      workspace
    })
    const sessionDir = path.dirname(smallPath)
    const sparsePath = path.join(sessionDir, 'factory-sparse.jsonl')
    const growingPath = path.join(sessionDir, 'factory-growing.jsonl')
    const giantLinePath = path.join(sessionDir, 'factory-giant-line.jsonl')
    await writeFile(sparsePath, '{"type":"session_start"}\n', 'utf8')
    truncateSync(sparsePath, DEFAULT_NATIVE_HISTORY_IMPORT_MAX_FILE_SIZE_BYTES + 1)
    await writeFile(growingPath, await readFile(smallPath))
    await writeFile(giantLinePath, `${'x'.repeat(17 * 1024 * 1024)}\n`, 'utf8')
    const sourceHashes = new Map(
      await Promise.all(
        [smallPath, sparsePath, giantLinePath].map(async filePath => [filePath, await sha256File(filePath)] as const)
      )
    )

    const importing = importNativeProjectHistory({
      adapters: ['droid'],
      cwd: workspace,
      env,
      homeDir: home,
      sourcePaths: [smallPath, sparsePath, growingPath, giantLinePath]
    })
    truncateSync(growingPath, DEFAULT_NATIVE_HISTORY_IMPORT_MAX_FILE_SIZE_BYTES + 1)
    const result = await importing

    expect(result).toEqual(expect.objectContaining({
      importedEvents: 4,
      importedSessions: 1,
      matchedFiles: 1,
      scannedFiles: 4
    }))
    expect(result.sessions).toEqual([
      expect.objectContaining({
        sourcePath: smallPath,
        title: 'Factory parent fixture'
      })
    ])
    expect((await stat(sparsePath)).size).toBe(DEFAULT_NATIVE_HISTORY_IMPORT_MAX_FILE_SIZE_BYTES + 1)
    expect((await stat(growingPath)).size).toBe(DEFAULT_NATIVE_HISTORY_IMPORT_MAX_FILE_SIZE_BYTES + 1)
    for (const [filePath, expectedHash] of sourceHashes) {
      expect(await sha256File(filePath)).toBe(expectedHash)
    }
  }, 20_000)
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

const writeGooseHistoryCli = async (params: {
  cliPath?: string
  commandLogPath?: string
  exportsById: Record<string, unknown>
  root: string
  sessions: unknown[]
}) => {
  const cliPath = params.cliPath ?? path.join(params.root, 'goose-history-fixture.mjs')
  await mkdir(path.dirname(cliPath), { recursive: true })
  await writeFile(
    cliPath,
    [
      `#!${process.execPath}`,
      "import { appendFileSync } from 'node:fs'",
      `const sessions = ${JSON.stringify(params.sessions)}`,
      `const exportsById = ${JSON.stringify(params.exportsById)}`,
      `const commandLogPath = ${JSON.stringify(params.commandLogPath)}`,
      'const args = process.argv.slice(2)',
      'if (commandLogPath) appendFileSync(commandLogPath, JSON.stringify(args) + "\\n")',
      "if (args.join(' ') === '--version') {",
      "  process.stdout.write('goose 1.46.0\\n')",
      "} else if (args.join(' ') === 'session list --format json') {",
      '  process.stdout.write(JSON.stringify(sessions))',
      "} else if (args[0] === 'session' && args[1] === 'export' && args[2] === '--session-id' &&",
      "    args[4] === '--format' && args[5] === 'json' && exportsById[args[3]] != null) {",
      '  process.stdout.write(JSON.stringify(exportsById[args[3]]))',
      '} else {',
      '  process.stderr.write("unexpected Goose public history command: " + args.join(" ") + "\\n")',
      '  process.exit(2)',
      '}',
      ''
    ].join('\n'),
    'utf8'
  )
  await chmod(cliPath, 0o755)
  return cliPath
}

const createGooseHistorySession = (params: {
  cwd: string
  id: string
  title: string
  updatedAt?: string
}) => ({
  id: params.id,
  working_dir: params.cwd,
  name: params.title,
  session_type: 'user',
  created_at: '2026-08-13T12:00:00Z',
  updated_at: params.updatedAt ?? '2026-08-13T12:05:00Z',
  last_message_at: params.updatedAt ?? '2026-08-13T12:05:00Z',
  message_count: 4,
  provider_name: 'anthropic',
  model_config: { model_name: 'claude-sonnet-4-6' },
  archived_at: null
})

const createGooseHistoryExport = (session: ReturnType<typeof createGooseHistorySession>) => ({
  ...session,
  conversation: [
    {
      id: 'user-1',
      role: 'user',
      created: 1_786_612_800,
      content: [{ type: 'text', text: `Question for ${session.id}` }]
    },
    {
      id: 'assistant-tool',
      role: 'assistant',
      created: 1_786_612_801,
      content: [{
        type: 'toolRequest',
        id: 'tool-1',
        toolCall: { status: 'success', value: { name: 'developer__read', arguments: { path: 'README.md' } } }
      }]
    },
    {
      id: 'user-tool-result',
      role: 'user',
      created: 1_786_612_802,
      content: [{
        type: 'toolResponse',
        id: 'tool-1',
        toolResult: {
          status: 'success',
          value: { content: [{ type: 'text', text: 'fixture result' }], isError: false }
        }
      }]
    },
    {
      id: 'assistant-2',
      role: 'assistant',
      created: 1_786_612_803,
      content: [{ type: 'text', text: 'Done' }]
    }
  ]
})

afterEach(async () => {
  process.chdir(originalCwd)
  vi.unstubAllEnvs()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

describe('native project history import', () => {
  it('previews and migrates Cursor JSONL transcripts for the current project', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace-with-dash')
    const home = path.join(root, 'home')
    const env = createTestEnv(workspace, home)
    const projectKey = workspace
      .replace(/[^a-z0-9]/gi, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
    const sourcePath = path.join(
      home,
      '.cursor',
      'projects',
      projectKey,
      'agent-transcripts',
      'cursor-native-1',
      'cursor-native-1.jsonl'
    )

    await mkdir(workspace, { recursive: true })
    const resolvedWorkspace = await realpath(workspace)
    await writeJsonl(sourcePath, [
      {
        role: 'user',
        message: {
          content: [{ type: 'text', text: 'Migrate this Cursor session' }]
        }
      },
      {
        role: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Cursor answer' },
            { type: 'tool_use', name: 'readToolCall', input: { path: 'README.md' } }
          ]
        }
      },
      { type: 'turn_ended', status: 'success' }
    ])

    const preview = await previewNativeProjectHistory({
      adapters: ['cursor'],
      cwd: workspace,
      env,
      homeDir: home
    })
    const result = await importNativeProjectHistory({
      adapters: ['cursor'],
      cwd: workspace,
      env,
      homeDir: home
    })

    expect(preview).toEqual(expect.objectContaining({ matchedFiles: 1, scannedFiles: 1 }))
    expect(preview.adapters[0]!.candidates[0]).toEqual(expect.objectContaining({
      adapter: 'cursor',
      cwd: resolvedWorkspace,
      nativeSessionId: 'cursor-native-1',
      title: 'Migrate this Cursor session'
    }))
    expect(result).toEqual(expect.objectContaining({
      importedEvents: 2,
      importedSessions: 1,
      matchedFiles: 1,
      scannedFiles: 1
    }))

    const runtimeRoot = resolveWorkspaceRuntimeStoreRoot(workspace, createWorkspaceRuntimeEnv(workspace, env))
    const db = await replayImportedSessions(runtimeRoot)
    const importedSessionId = result.sessions[0]!.sessionId
    expect(db.getSession(importedSessionId)).toEqual(expect.objectContaining({
      adapter: 'cursor',
      status: 'completed',
      title: 'Migrate this Cursor session'
    }))
    expect(db.getMessages(importedSessionId)).toEqual([
      expect.objectContaining({
        message: expect.objectContaining({ role: 'user', content: 'Migrate this Cursor session' })
      }),
      expect.objectContaining({
        message: expect.objectContaining({
          role: 'assistant',
          content: expect.arrayContaining([
            expect.objectContaining({ type: 'text', text: 'Cursor answer' }),
            expect.objectContaining({ type: 'tool_use', name: 'readToolCall' })
          ])
        })
      })
    ])
    db.close()
  })

  it('previews and imports selected Cursor histories from another project', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const selectedWorkspace = path.join(root, 'selected-project')
    const home = path.join(root, 'home')
    const env = createTestEnv(workspace, home)
    const projectKey = selectedWorkspace
      .replace(/[^a-z0-9]/gi, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
    const sourcePath = path.join(
      home,
      '.cursor',
      'projects',
      projectKey,
      'agent-transcripts',
      'cursor-native-selected',
      'cursor-native-selected.jsonl'
    )

    await Promise.all([
      mkdir(workspace, { recursive: true }),
      mkdir(selectedWorkspace, { recursive: true })
    ])
    await writeJsonl(sourcePath, [
      {
        role: 'user',
        message: { content: [{ type: 'text', text: 'Selected Cursor history' }] }
      },
      {
        role: 'assistant',
        message: { content: [{ type: 'text', text: 'Selected Cursor answer' }] }
      }
    ])

    const selectedRealPath = await realpath(selectedWorkspace)
    const preview = await previewNativeProjectHistory({
      adapters: ['cursor'],
      cwd: workspace,
      env,
      homeDir: home,
      projectPaths: [selectedWorkspace],
      projectScope: 'all-projects',
      sourcePaths: [sourcePath]
    })
    const result = await importNativeProjectHistory({
      adapters: ['cursor'],
      cwd: workspace,
      env,
      homeDir: home,
      projectPaths: [selectedWorkspace],
      projectScope: 'all-projects',
      sourcePaths: [sourcePath]
    })

    expect(preview.adapters[0]).toEqual(expect.objectContaining({
      matchedFiles: 1,
      projects: [{ path: selectedRealPath, sessionCount: 1 }],
      candidates: [expect.objectContaining({
        cwd: selectedRealPath,
        nativeSessionId: 'cursor-native-selected'
      })]
    }))
    expect(result).toEqual(expect.objectContaining({
      importedEvents: 2,
      importedSessions: 1,
      matchedFiles: 1,
      sessions: [expect.objectContaining({
        cwd: selectedRealPath,
        workspaceCwd: selectedRealPath
      })]
    }))
  })

  it('discovers all-project Cursor histories from workspace storage metadata', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const discoveredWorkspace = path.join(root, 'discovered-project')
    const home = path.join(root, 'home')
    const env = createTestEnv(workspace, home)
    const projectKey = discoveredWorkspace
      .replace(/[^a-z0-9]/gi, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
    const sourcePath = path.join(
      home,
      '.cursor',
      'projects',
      projectKey,
      'agent-transcripts',
      'cursor-native-discovered',
      'cursor-native-discovered.jsonl'
    )
    const workspaceJsonPath = path.join(
      home,
      'Library',
      'Application Support',
      'Cursor',
      'User',
      'workspaceStorage',
      'workspace-id',
      'workspace.json'
    )

    await Promise.all([
      mkdir(workspace, { recursive: true }),
      mkdir(discoveredWorkspace, { recursive: true }),
      mkdir(path.dirname(workspaceJsonPath), { recursive: true })
    ])
    await writeFile(workspaceJsonPath, `${JSON.stringify({ folder: pathToFileURL(discoveredWorkspace).href })}\n`)
    await writeJsonl(sourcePath, [
      {
        role: 'user',
        message: { content: [{ type: 'text', text: 'Discovered Cursor history' }] }
      }
    ])

    const discoveredRealPath = await realpath(discoveredWorkspace)
    const preview = await previewNativeProjectHistory({
      adapters: ['cursor'],
      cwd: workspace,
      env,
      homeDir: home,
      projectScope: 'all-projects'
    })
    const result = await importNativeProjectHistory({
      adapters: ['cursor'],
      cwd: workspace,
      env,
      homeDir: home,
      projectScope: 'all-projects'
    })

    expect(preview.adapters[0]!.candidates).toEqual([
      expect.objectContaining({ cwd: discoveredRealPath, nativeSessionId: 'cursor-native-discovered' })
    ])
    expect(result.sessions).toEqual([
      expect.objectContaining({ cwd: discoveredRealPath, workspaceCwd: discoveredRealPath })
    ])
  })

  it('previews and imports Grok native sessions from summary and chat history files', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    const env = createTestEnv(workspace, home)
    const nativeSessionId = '11111111-1111-4111-8111-111111111111'
    const sessionDir = path.join(home, '.grok', 'sessions', encodeURIComponent(workspace), nativeSessionId)
    const sourcePath = path.join(sessionDir, 'chat_history.jsonl')
    await mkdir(workspace, { recursive: true })
    await mkdir(sessionDir, { recursive: true })
    await writeFile(
      path.join(sessionDir, 'summary.json'),
      JSON.stringify({
        info: { id: nativeSessionId, cwd: workspace },
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-01T00:00:02.000Z',
        current_model_id: 'grok-code-fast-1',
        session_summary: 'Fix the Grok adapter'
      })
    )
    await writeJsonl(sourcePath, [
      { type: 'system', content: 'system prompt' },
      {
        type: 'user',
        synthetic_reason: 'project_instructions',
        content: [{ type: 'text', text: 'Internal project instructions' }]
      },
      { type: 'user', content: [{ type: 'text', text: 'Fix the adapter' }] },
      { type: 'assistant', content: 'Done', model_id: 'grok-code-fast-1' },
      {
        type: 'user',
        synthetic_reason: 'auto_continue',
        content: [{ type: 'text', text: 'Internal automatic continuation' }]
      }
    ])

    const preview = await previewNativeProjectHistory({
      adapters: ['grok'],
      cwd: workspace,
      env,
      homeDir: home
    })
    const imported = await importNativeProjectHistory({
      adapters: ['grok'],
      cwd: workspace,
      env,
      homeDir: home
    })

    expect(preview.adapters[0]).toEqual(expect.objectContaining({
      adapter: 'grok',
      matchedFiles: 1,
      scannedFiles: 1
    }))
    expect(preview.adapters[0]!.candidates[0]).toEqual(expect.objectContaining({
      cwd: workspace,
      nativeSessionId,
      title: 'Fix the Grok adapter'
    }))
    expect(imported).toEqual(expect.objectContaining({
      importedSessions: 1,
      importedEvents: 2,
      matchedFiles: 1,
      scannedFiles: 1
    }))
    expect(imported.sessions[0]).toEqual(expect.objectContaining({
      adapter: 'grok',
      title: 'Fix the Grok adapter'
    }))

    const runtimeRoot = resolveWorkspaceRuntimeStoreRoot(workspace, createWorkspaceRuntimeEnv(workspace, env))
    const db = await replayImportedSessions(runtimeRoot)
    expect(db.getMessages(imported.sessions[0]!.sessionId)).toEqual([
      expect.objectContaining({
        message: expect.objectContaining({ role: 'user', content: 'Fix the adapter' })
      }),
      expect.objectContaining({
        message: expect.objectContaining({ role: 'assistant', content: 'Done' })
      })
    ])
    db.close()
  })

  it('uses the first real Grok user message as the preview title when the summary is missing', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    const env = createTestEnv(workspace, home)
    const nativeSessionId = '22222222-2222-4222-8222-222222222222'
    const sessionDir = path.join(home, '.grok', 'sessions', encodeURIComponent(workspace), nativeSessionId)
    await mkdir(workspace, { recursive: true })
    await mkdir(sessionDir, { recursive: true })
    await writeFile(
      path.join(sessionDir, 'summary.json'),
      JSON.stringify({
        info: { id: nativeSessionId, cwd: workspace },
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-01T00:00:02.000Z',
        current_model_id: 'grok-code-fast-1'
      })
    )
    await writeJsonl(path.join(sessionDir, 'chat_history.jsonl'), [
      {
        type: 'user',
        synthetic_reason: 'project_instructions',
        content: [{ type: 'text', text: 'Internal project instructions' }]
      },
      { type: 'user', content: [{ type: 'text', text: 'Fix the adapter' }] },
      { type: 'assistant', content: 'Done', model_id: 'grok-code-fast-1' }
    ])

    const preview = await previewNativeProjectHistory({
      adapters: ['grok'],
      cwd: workspace,
      env,
      homeDir: home
    })

    expect(preview.adapters[0]!.candidates[0]).toEqual(expect.objectContaining({
      nativeSessionId,
      title: 'Fix the adapter'
    }))
  })

  it('previews and imports Goose public CLI history for the current project with native id, tools, and dedupe', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const otherWorkspace = path.join(root, 'other-workspace')
    const home = path.join(root, 'home')
    await Promise.all([mkdir(workspace, { recursive: true }), mkdir(otherWorkspace, { recursive: true })])
    const current = createGooseHistorySession({ cwd: workspace, id: 'goose-current', title: 'Current Goose task' })
    const duplicate = createGooseHistorySession({
      cwd: workspace,
      id: 'goose-current',
      title: 'Current Goose task',
      updatedAt: '2026-08-13T12:06:00Z'
    })
    const other = createGooseHistorySession({ cwd: otherWorkspace, id: 'goose-other', title: 'Other Goose task' })
    const cliPath = await writeGooseHistoryCli({
      root,
      sessions: [current, duplicate, other],
      exportsById: {
        'goose-current': createGooseHistoryExport(duplicate),
        'goose-other': createGooseHistoryExport(other)
      }
    })
    const env = {
      ...createTestEnv(workspace, home),
      __ONEWORKS_PROJECT_ADAPTER_GOOSE_CLI_PATH__: cliPath
    }

    const preview = await previewNativeProjectHistory({ adapters: ['goose'], cwd: workspace, env, homeDir: home })
    const first = await importNativeProjectHistory({ adapters: ['goose'], cwd: workspace, env, homeDir: home })
    const second = await importNativeProjectHistory({ adapters: ['goose'], cwd: workspace, env, homeDir: home })

    expect(preview.adapters[0]).toEqual(expect.objectContaining({
      adapter: 'goose',
      matchedFiles: 1,
      scannedFiles: 2,
      candidates: [expect.objectContaining({
        fileSizeBytes: expect.any(Number),
        nativeSessionId: 'goose-current',
        sourcePath: 'goose-cli://session/goose-current',
        title: 'Current Goose task'
      })]
    }))
    expect(preview.adapters[0]!.candidates[0]!.fileSizeBytes).toBeGreaterThan(0)
    expect(preview.adapters[0]!.totalBytes).toBe(preview.adapters[0]!.candidates[0]!.fileSizeBytes)
    expect(first).toEqual(expect.objectContaining({
      importedEvents: 4,
      importedSessions: 1,
      matchedFiles: 1,
      scannedFiles: 2,
      sessions: [expect.objectContaining({ adapter: 'goose', cwd: await realpath(workspace) })]
    }))
    expect(second).toEqual(expect.objectContaining({ importedEvents: 0, importedSessions: 0, matchedFiles: 0 }))

    const runtimeRoot = resolveWorkspaceRuntimeStoreRoot(workspace, createWorkspaceRuntimeEnv(workspace, env))
    const db = await replayImportedSessions(runtimeRoot)
    const importedSessionId = first.sessions[0]!.sessionId
    expect(db.getSession(importedSessionId)).toEqual(expect.objectContaining({
      adapter: 'goose',
      title: 'Current Goose task'
    }))
    expect(db.getMessages(importedSessionId)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        message: expect.objectContaining({
          content: [expect.objectContaining({ type: 'tool_use', id: 'tool-1', name: 'developer__read' })]
        })
      }),
      expect.objectContaining({
        message: expect.objectContaining({
          content: [expect.objectContaining({ type: 'tool_result', tool_use_id: 'tool-1', content: 'fixture result' })]
        })
      })
    ]))
    db.close()
  })

  it('filters Goose all-project history by projectPaths and imports into the selected project store', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const selectedWorkspace = path.join(root, 'selected-workspace')
    const ignoredWorkspace = path.join(root, 'ignored-workspace')
    const home = path.join(root, 'home')
    const commandLogPath = path.join(root, 'goose-project-filter-commands.jsonl')
    await Promise.all([
      mkdir(workspace, { recursive: true }),
      mkdir(selectedWorkspace, { recursive: true }),
      mkdir(ignoredWorkspace, { recursive: true })
    ])
    const selected = createGooseHistorySession({ cwd: selectedWorkspace, id: 'goose-selected', title: 'Selected' })
    const ignored = createGooseHistorySession({ cwd: ignoredWorkspace, id: 'goose-ignored', title: 'Ignored' })
    const cliPath = await writeGooseHistoryCli({
      commandLogPath,
      root,
      sessions: [selected, ignored],
      exportsById: {
        'goose-selected': createGooseHistoryExport(selected),
        'goose-ignored': createGooseHistoryExport(ignored)
      }
    })
    const env = {
      ...createTestEnv(workspace, home),
      __ONEWORKS_PROJECT_ADAPTER_GOOSE_CLI_PATH__: cliPath
    }

    const preview = await previewNativeProjectHistory({
      adapters: ['goose'],
      cwd: workspace,
      env,
      homeDir: home,
      projectPaths: [selectedWorkspace],
      projectScope: 'all-projects'
    })
    const imported = await importNativeProjectHistory({
      adapters: ['goose'],
      cwd: workspace,
      env,
      homeDir: home,
      projectPaths: [selectedWorkspace],
      projectScope: 'all-projects'
    })

    const selectedRealPath = await realpath(selectedWorkspace)
    expect(preview.adapters[0]!.candidates).toEqual([
      expect.objectContaining({ cwd: selectedRealPath, nativeSessionId: 'goose-selected' })
    ])
    expect(imported.sessions).toEqual([
      expect.objectContaining({ cwd: selectedRealPath, workspaceCwd: selectedRealPath })
    ])
    expect(imported.importedSessions).toBe(1)
    const commands = (await readFile(commandLogPath, 'utf8')).trim().split('\n')
      .map(line => JSON.parse(line) as string[])
    expect(commands.filter(args => args.join(' ') === '--version')).toHaveLength(2)
    expect(commands.filter(args => args.join(' ') === 'session list --format json')).toHaveLength(2)
    expect(commands.filter(args => args.includes('goose-selected'))).toHaveLength(2)
    expect(commands.some(args => args.includes('goose-ignored'))).toBe(false)
  })

  it('resolves Goose once and exports only the filtered bounded preview page', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const otherWorkspace = path.join(root, 'other-workspace')
    const home = path.join(root, 'home')
    const commandLogPath = path.join(root, 'goose-commands.jsonl')
    await Promise.all([mkdir(workspace, { recursive: true }), mkdir(otherWorkspace, { recursive: true })])
    const current = Array.from({ length: 40 }, (_, index) =>
      createGooseHistorySession({
        cwd: workspace,
        id: `goose-current-${String(index).padStart(3, '0')}`,
        title: `Current ${index}`,
        updatedAt: new Date(Date.parse('2026-08-13T12:05:00Z') + index * 1000).toISOString()
      }))
    const outsideProject = Array.from({ length: 20 }, (_, index) =>
      createGooseHistorySession({
        cwd: otherWorkspace,
        id: `goose-other-${String(index).padStart(3, '0')}`,
        title: `Other ${index}`,
        updatedAt: new Date(Date.parse('2026-08-13T12:05:00Z') + index * 1000).toISOString()
      }))
    const outsideTime = createGooseHistorySession({
      cwd: workspace,
      id: 'goose-too-old',
      title: 'Too old',
      updatedAt: '2025-01-01T00:00:00Z'
    })
    const allSessions = [...current, ...outsideProject, outsideTime]
    const cliPath = await writeGooseHistoryCli({
      commandLogPath,
      exportsById: Object.fromEntries(allSessions.map(session => [session.id, createGooseHistoryExport(session)])),
      root,
      sessions: allSessions
    })
    const env = {
      ...createTestEnv(workspace, home),
      __ONEWORKS_PROJECT_ADAPTER_GOOSE_CLI_PATH__: cliPath
    }

    const preview = await previewNativeProjectHistory({
      adapters: ['goose'],
      cwd: workspace,
      env,
      homeDir: home,
      previewLimit: 3,
      timeFilter: { updatedAt: { from: Date.parse('2026-08-13T12:05:00Z') } }
    })

    expect(preview.adapters[0]).toMatchObject({
      hasMore: true,
      isComplete: false,
      matchedFiles: 3,
      scannedFiles: 61
    })
    expect(preview.adapters[0]!.candidates.map(candidate => candidate.nativeSessionId)).toEqual([
      'goose-current-039',
      'goose-current-038',
      'goose-current-037'
    ])
    const commands = (await readFile(commandLogPath, 'utf8')).trim().split('\n')
      .map(line => JSON.parse(line) as string[])
    expect(commands.filter(args => args.join(' ') === '--version')).toHaveLength(1)
    expect(commands.filter(args => args.join(' ') === 'session list --format json')).toHaveLength(1)
    expect(commands.filter(args => args[1] === 'export')).toHaveLength(3)
    expect(commands.some(args => args.includes('goose-other-000'))).toBe(false)
    expect(commands.some(args => args.includes('goose-too-old'))).toBe(false)
  })

  it('bounds a malformed Goose preview export to the requested page', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    const commandLogPath = path.join(root, 'goose-malformed-commands.jsonl')
    await mkdir(workspace, { recursive: true })
    const sessions = Array.from({ length: 25 }, (_, index) =>
      createGooseHistorySession({
        cwd: workspace,
        id: `goose-malformed-${String(index).padStart(2, '0')}`,
        title: `Malformed ${index}`,
        updatedAt: new Date(Date.parse('2026-08-13T12:05:00Z') + index * 1000).toISOString()
      }))
    const newest = sessions.at(-1)!
    const cliPath = await writeGooseHistoryCli({
      commandLogPath,
      exportsById: {
        ...Object.fromEntries(sessions.map(session => [session.id, createGooseHistoryExport(session)])),
        [newest.id]: { invalid: true }
      },
      root,
      sessions
    })
    const env = {
      ...createTestEnv(workspace, home),
      __ONEWORKS_PROJECT_ADAPTER_GOOSE_CLI_PATH__: cliPath
    }

    await expect(previewNativeProjectHistory({
      adapters: ['goose'],
      cwd: workspace,
      env,
      homeDir: home,
      previewLimit: 2
    })).rejects.toThrow(/unsafe native session id|mismatched session/u)

    const commands = (await readFile(commandLogPath, 'utf8')).trim().split('\n')
      .map(line => JSON.parse(line) as string[])
    expect(commands.filter(args => args.join(' ') === '--version')).toHaveLength(1)
    expect(commands.filter(args => args[1] === 'export')).toHaveLength(1)
  })

  it('preserves an explicit Goose preview failure and does not fall back to SQLite', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    await mkdir(workspace, { recursive: true })
    await mkdir(path.join(home, '.local', 'share', 'goose'), { recursive: true })
    await writeFile(path.join(home, '.local', 'share', 'goose', 'sessions.db'), 'private fixture', 'utf8')
    const env = {
      ...createTestEnv(workspace, home),
      __ONEWORKS_PROJECT_ADAPTER_GOOSE_CLI_PATH__: path.join(root, 'missing-goose')
    }

    await expect(previewNativeProjectHistory({
      adapters: ['goose'],
      cwd: workspace,
      env,
      homeDir: home
    })).rejects.toThrow('does not exist')
  })

  it('uses a validated managed-cache Goose CLI for preview and import without installing', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    const cache = path.join(root, 'cache')
    await mkdir(workspace, { recursive: true })
    const session = createGooseHistorySession({ cwd: workspace, id: 'goose-managed', title: 'Managed Goose' })
    const releaseArch = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
    const installKey = process.platform === 'darwin'
      ? `darwin-${releaseArch}-standard`
      : process.platform === 'linux'
      ? `linux-${releaseArch}-standard`
      : `win32-${releaseArch}-standard`
    const cliPath = path.join(
      cache,
      'native',
      'goose',
      'versions',
      '1.46.0',
      installKey,
      process.platform === 'win32' ? 'goose.exe' : 'goose'
    )
    await writeGooseHistoryCli({
      cliPath,
      root,
      sessions: [session],
      exportsById: { 'goose-managed': createGooseHistoryExport(session) }
    })
    const env = {
      ...createTestEnv(workspace, home),
      __ONEWORKS_PROJECT_PACKAGE_CACHE_DIR__: cache
    }
    const before = await readFile(cliPath, 'utf8')

    const preview = await previewNativeProjectHistory({ adapters: ['goose'], cwd: workspace, env, homeDir: home })
    const imported = await importNativeProjectHistory({ adapters: ['goose'], cwd: workspace, env, homeDir: home })

    expect(preview.matchedFiles).toBe(1)
    expect(imported.importedSessions).toBe(1)
    expect(await readFile(cliPath, 'utf8')).toBe(before)
  })

  it('keeps global auto-import best effort while explicit Goose selection remains actionable', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    const codexSession = path.join(home, '.codex', 'sessions', '2026', '08', '13', 'global-auto.jsonl')
    await mkdir(workspace, { recursive: true })
    await writeJsonl(codexSession, [
      { type: 'session_meta', payload: { id: 'codex-global-auto', cwd: workspace } },
      { type: 'event_msg', payload: { type: 'user_message', message: 'Import Codex while Goose is absent' } },
      { type: 'event_msg', payload: { type: 'agent_message', message: 'Imported' } }
    ])
    const env = {
      ...createTestEnv(workspace, home),
      __ONEWORKS_PROJECT_ADAPTER_GOOSE_CLI_PATH__: path.join(root, 'missing-goose')
    }

    const mixed = await importNativeProjectHistory({
      adapters: ['codex', 'goose'],
      cwd: workspace,
      env,
      homeDir: home
    })
    expect(mixed.importedSessions).toBe(1)
    expect(mixed.diagnostics).toEqual([expect.objectContaining({
      adapter: 'goose',
      code: 'adapter_unavailable',
      level: 'error'
    })])
    await expect(importNativeProjectHistory({
      adapters: ['goose'],
      cwd: workspace,
      env,
      homeDir: home
    })).rejects.toThrow('does not exist')

    process.chdir(workspace)
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)
    const automatic = await autoImportNativeProjectHistoryAndReplay({
      nativeHistoryImport: { autoImport: true }
    } as Config)
    expect(automatic.diagnostics).toEqual([expect.objectContaining({
      adapter: 'goose',
      code: 'adapter_unavailable',
      level: 'warning'
    })])
    await expect(autoImportNativeProjectHistoryAndReplay({
      nativeHistoryImport: {
        autoImport: false,
        adapters: { goose: { autoImport: true } }
      }
    } as Config)).rejects.toThrow('does not exist')
    await expect(autoImportNativeProjectHistoryAndReplay({
      nativeHistoryImport: { autoImport: false }
    } as Config)).resolves.toEqual(expect.objectContaining({
      importedSessions: 0,
      matchedFiles: 0
    }))
  })

  it('measures Goose exports in preview and skips an oversized candidate without aborting the scan', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    await mkdir(workspace, { recursive: true })
    const session = createGooseHistorySession({ cwd: workspace, id: 'goose-large', title: 'Large Goose' })
    const cliPath = await writeGooseHistoryCli({
      root,
      sessions: [session],
      exportsById: { 'goose-large': createGooseHistoryExport(session) }
    })
    const env = {
      ...createTestEnv(workspace, home),
      __ONEWORKS_PROJECT_ADAPTER_GOOSE_CLI_PATH__: cliPath
    }

    const preview = await previewNativeProjectHistory({
      adapters: ['goose'],
      cwd: workspace,
      env,
      homeDir: home,
      maxFileSizeBytes: 1
    })
    const imported = await importNativeProjectHistory({
      adapters: ['goose'],
      cwd: workspace,
      env,
      homeDir: home,
      maxFileSizeBytes: 1
    })

    expect(preview.totalBytes).toBeGreaterThan(1)
    expect(preview.adapters[0]!.candidates[0]!.fileSizeBytes).toBe(preview.totalBytes)
    expect(preview.diagnostics).toEqual([expect.objectContaining({ code: 'history_oversized' })])
    expect(imported.importedSessions).toBe(0)
    expect(imported.diagnostics).toEqual([expect.objectContaining({ code: 'history_oversized' })])

    const manual = await importNativeProjectHistory({
      adapters: ['goose'],
      cwd: workspace,
      env,
      homeDir: home,
      sourcePaths: [`goose-cli://session/${session.id}`]
    })
    expect(manual.importedSessions).toBe(1)
  })

  it('continues preview and automatic-style import after one multibyte export exceeds the exact policy boundary', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    await mkdir(workspace, { recursive: true })
    const within = createGooseHistorySession({ cwd: workspace, id: 'goose-within', title: 'Within policy' })
    const oversized = createGooseHistorySession({ cwd: workspace, id: 'goose-oversized', title: 'Over policy' })
    const withinExport = createGooseHistoryExport(within)
    const oversizedExport = createGooseHistoryExport(oversized)
    oversizedExport.conversation[0]!.content = [{ type: 'text', text: '鹅🪿'.repeat(4_096) }]
    const exactLimit = Buffer.byteLength(JSON.stringify(withinExport))
    const cliPath = await writeGooseHistoryCli({
      root,
      sessions: [oversized, within],
      exportsById: {
        'goose-oversized': oversizedExport,
        'goose-within': withinExport
      }
    })
    const env = {
      ...createTestEnv(workspace, home),
      __ONEWORKS_PROJECT_ADAPTER_GOOSE_CLI_PATH__: cliPath
    }

    const preview = await previewNativeProjectHistory({
      adapters: ['goose'],
      cwd: workspace,
      env,
      homeDir: home,
      maxFileSizeBytes: exactLimit
    })
    const imported = await importNativeProjectHistory({
      adapters: ['goose'],
      cwd: workspace,
      env,
      homeDir: home,
      maxFileSizeBytes: exactLimit
    })

    expect(preview.adapters[0]!.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ nativeSessionId: 'goose-within', fileSizeBytes: exactLimit }),
      expect.objectContaining({ nativeSessionId: 'goose-oversized' })
    ]))
    expect(preview.diagnostics).toEqual([expect.objectContaining({
      code: 'history_oversized',
      nativeSessionId: 'goose-oversized',
      sourcePath: 'goose-cli://session/goose-oversized'
    })])
    expect(imported).toEqual(expect.objectContaining({ importedSessions: 1, matchedFiles: 1 }))
    expect(imported.sessions).toEqual([
      expect.objectContaining({ sourcePath: 'goose-cli://session/goose-within' })
    ])
    expect(imported.diagnostics).toEqual([expect.objectContaining({
      code: 'history_oversized',
      nativeSessionId: 'goose-oversized'
    })])
  })

  it('threads inherited and explicit-null size policies through actual Goose automatic import', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    await mkdir(workspace, { recursive: true })
    const within = createGooseHistorySession({ cwd: workspace, id: 'goose-auto-within', title: 'Auto within' })
    const oversized = createGooseHistorySession({ cwd: workspace, id: 'goose-auto-over', title: 'Auto over' })
    const withinExport = createGooseHistoryExport(within)
    const oversizedExport = createGooseHistoryExport(oversized)
    oversizedExport.conversation[0]!.content = [{ type: 'text', text: 'automatic-limit'.repeat(1_024) }]
    const exactLimit = Buffer.byteLength(JSON.stringify(withinExport))
    const cliPath = await writeGooseHistoryCli({
      root,
      sessions: [oversized, within],
      exportsById: {
        'goose-auto-over': oversizedExport,
        'goose-auto-within': withinExport
      }
    })
    const env = {
      ...createTestEnv(workspace, home),
      __ONEWORKS_PROJECT_ADAPTER_GOOSE_CLI_PATH__: cliPath
    }
    process.chdir(workspace)
    vi.stubEnv('DB_PATH', path.join(root, 'db.sqlite'))
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)
    const baseConfig = {
      adapters: { goose: { cli: { source: 'path', path: cliPath, autoInstall: false } } },
      nativeHistoryImport: {
        autoImport: false,
        maxFileSizeBytes: exactLimit,
        adapters: { goose: { autoImport: true } }
      }
    } as Config

    const inherited = await autoImportNativeProjectHistoryAndReplay(baseConfig)
    const explicitNull = await autoImportNativeProjectHistoryAndReplay({
      ...baseConfig,
      nativeHistoryImport: {
        ...baseConfig.nativeHistoryImport,
        adapters: { goose: { autoImport: true, maxFileSizeBytes: null } }
      }
    })

    expect(inherited.sessions).toEqual([
      expect.objectContaining({ sourcePath: 'goose-cli://session/goose-auto-within' })
    ])
    expect(inherited.diagnostics).toEqual([expect.objectContaining({
      code: 'history_oversized',
      nativeSessionId: 'goose-auto-over'
    })])
    expect(explicitNull.sessions).toEqual([
      expect.objectContaining({ sourcePath: 'goose-cli://session/goose-auto-over' })
    ])
  })

  it('distinguishes unsupported Goose recipes and subagents from an empty history', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    await mkdir(workspace, { recursive: true })
    const normal = createGooseHistorySession({ cwd: workspace, id: 'goose-normal', title: 'Normal' })
    const recipe = { ...createGooseHistorySession({ cwd: workspace, id: 'goose-recipe', title: 'Recipe' }), recipe: {} }
    const subagent = {
      ...createGooseHistorySession({ cwd: workspace, id: 'goose-subagent', title: 'Subagent' }),
      session_type: 'sub_agent'
    }
    const cliPath = await writeGooseHistoryCli({
      root,
      sessions: [normal, recipe, subagent],
      exportsById: { 'goose-normal': createGooseHistoryExport(normal) }
    })
    const env = {
      ...createTestEnv(workspace, home),
      __ONEWORKS_PROJECT_ADAPTER_GOOSE_CLI_PATH__: cliPath
    }

    const preview = await previewNativeProjectHistory({ adapters: ['goose'], cwd: workspace, env, homeDir: home })

    expect(preview.matchedFiles).toBe(1)
    expect(preview.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'unsupported_history_kind', skippedSessions: 1 }),
      expect.objectContaining({ code: 'unsupported_history_kind', skippedSessions: 1 })
    ]))
  })

  it('reports explicit Goose Subtasks scope as unsupported in preview and import', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    await mkdir(workspace, { recursive: true })
    const env = createTestEnv(workspace, home)

    const preview = await previewNativeProjectHistory({
      adapters: ['goose'],
      cwd: workspace,
      env,
      homeDir: home,
      threadScope: 'subagent'
    })
    const imported = await importNativeProjectHistory({
      adapters: ['goose'],
      cwd: workspace,
      env,
      homeDir: home,
      threadScope: 'subagent'
    })

    expect(preview.matchedFiles).toBe(0)
    expect(preview.diagnostics).toEqual([expect.objectContaining({
      adapter: 'goose',
      code: 'unsupported_history_scope',
      sourceKind: 'subagent'
    })])
    expect(imported.importedSessions).toBe(0)
    expect(imported.diagnostics).toEqual([expect.objectContaining({
      adapter: 'goose',
      code: 'unsupported_history_scope',
      sourceKind: 'subagent'
    })])
  })

  it('preserves a genuine empty Goose preview for supported user sessions', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    await mkdir(workspace, { recursive: true })
    const cliPath = await writeGooseHistoryCli({ root, sessions: [], exportsById: {} })
    const env = {
      ...createTestEnv(workspace, home),
      __ONEWORKS_PROJECT_ADAPTER_GOOSE_CLI_PATH__: cliPath
    }

    const preview = await previewNativeProjectHistory({
      adapters: ['goose'],
      cwd: workspace,
      env,
      homeDir: home,
      threadScope: 'user'
    })

    expect(preview.matchedFiles).toBe(0)
    expect(preview.adapters).toEqual([expect.objectContaining({
      adapter: 'goose',
      candidates: [],
      matchedFiles: 0
    })])
    expect(preview.diagnostics).toBeUndefined()
  })

  it('previews and imports real sanitized Qwen Code 0.21.11 chats and subagents idempotently', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    const qwenRuntimeDir = path.join(home, '.qwen-runtime')
    await mkdir(workspace, { recursive: true })
    const sourceHashes = await materializeQwenFixture({ cwd: workspace, runtimeDir: qwenRuntimeDir })
    const env = {
      ...createTestEnv(workspace, home),
      QWEN_RUNTIME_DIR: qwenRuntimeDir
    }

    const preview = await previewNativeProjectHistory({
      adapters: ['qwen-code'],
      cwd: workspace,
      env,
      homeDir: home,
      threadScope: 'all'
    })
    const userPreview = await previewNativeProjectHistory({
      adapters: ['qwen-code'],
      cwd: workspace,
      env,
      homeDir: home,
      threadScope: 'user'
    })
    const subagentPreview = await previewNativeProjectHistory({
      adapters: ['qwen-code'],
      cwd: workspace,
      env,
      homeDir: home,
      threadScope: 'subagent'
    })

    expect(preview).toEqual(expect.objectContaining({ matchedFiles: 3, scannedFiles: 3 }))
    expect(preview.adapters[0]!.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        nativeSessionId: '1c408cc2-a3f3-4881-9807-4782e1788ffa',
        title: 'READ_FIXTURE: read README.md and reply MAIN_FIXTURE_OK.'
      }),
      expect.objectContaining({
        nativeSessionId: 'da59db28-d7e8-4167-bc90-10a7b5bdec78',
        title: 'DELEGATE_FIXTURE: use a subagent and then reply PARENT_FIXTURE_OK.'
      }),
      expect.objectContaining({
        nativeSessionId: 'da59db28-d7e8-4167-bc90-10a7b5bdec78:general-purpose-call_agent_fixture',
        threadSource: 'subagent',
        title: 'fixture child task'
      })
    ]))
    expect(userPreview.matchedFiles).toBe(2)
    expect(subagentPreview.matchedFiles).toBe(1)

    const firstImport = await importNativeProjectHistory({
      adapters: ['qwen-code'],
      cwd: workspace,
      env,
      homeDir: home,
      threadScope: 'all'
    })
    const secondImport = await importNativeProjectHistory({
      adapters: ['qwen-code'],
      cwd: workspace,
      env,
      homeDir: home,
      threadScope: 'all'
    })
    expect(firstImport).toEqual(expect.objectContaining({
      importedEvents: 10,
      importedSessions: 3,
      matchedFiles: 3,
      scannedFiles: 3
    }))
    expect(secondImport).toEqual(expect.objectContaining({
      importedEvents: 0,
      importedSessions: 0,
      matchedFiles: 0,
      scannedFiles: 3
    }))

    const readSession = firstImport.sessions.find(session => (
      session.sourcePath.endsWith('/chats/1c408cc2-a3f3-4881-9807-4782e1788ffa.jsonl')
    ))!
    const parentSession = firstImport.sessions.find(session => (
      session.sourcePath.endsWith('/chats/da59db28-d7e8-4167-bc90-10a7b5bdec78.jsonl')
    ))!
    const childSession = firstImport.sessions.find(session => session.sourcePath.includes('/subagents/'))!
    const runtimeRoot = resolveWorkspaceRuntimeStoreRoot(workspace, createWorkspaceRuntimeEnv(workspace, env))
    const childMeta = JSON.parse(
      await readFile(path.join(runtimeRoot, 'sessions', childSession.sessionId, 'meta.json'), 'utf8')
    ) as Record<string, any>
    expect(childMeta).toEqual(expect.objectContaining({
      parentSessionId: parentSession.sessionId,
      historyImport: expect.objectContaining({
        nativeParentSessionId: 'da59db28-d7e8-4167-bc90-10a7b5bdec78',
        nativeSessionId: 'da59db28-d7e8-4167-bc90-10a7b5bdec78:general-purpose-call_agent_fixture',
        threadSource: 'subagent'
      })
    }))

    const db = await replayImportedSessions(runtimeRoot)
    expect(db.getMessages(readSession.sessionId)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        message: expect.objectContaining({
          content: [expect.objectContaining({
            type: 'tool_use',
            id: 'call_read_fixture',
            name: 'adapter:qwen-code:ReadFile'
          })]
        })
      }),
      expect.objectContaining({
        message: expect.objectContaining({
          content: [expect.objectContaining({
            type: 'tool_result',
            tool_use_id: 'call_read_fixture'
          })]
        })
      })
    ]))
    expect(db.getMessages(childSession.sessionId)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        message: expect.objectContaining({ role: 'assistant', content: 'SUBAGENT_FIXTURE_OK' })
      })
    ]))
    db.close()

    for (const [sourcePath, originalHash] of sourceHashes) {
      expect(sha256(await readFile(sourcePath, 'utf8'))).toBe(originalHash)
    }
  })

  it('keeps the checked-in Qwen fixture sanitized and free of credential-shaped fields', async () => {
    const credentialShapedField =
      /["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|client[_-]?secret|password)["']?\s*[:=]/iu
    const absoluteTemporaryPath = /(?:\/tmp\/|\/private\/var\/folders\/|\/Users\/|[A-Za-z]:\\)/u

    for (const relativePath of qwenFixtureFiles) {
      const source = await readFile(path.join(qwenFixtureRoot, relativePath), 'utf8')
      expect(source, relativePath).not.toMatch(credentialShapedField)
      expect(source, relativePath).not.toMatch(absoluteTemporaryPath)
    }
  })

  it('rejects missing, future, and mixed Qwen history record versions', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    const qwenRuntimeDir = path.join(home, '.qwen-runtime')
    const chatsDir = path.join(qwenRuntimeDir, 'projects', '-fixture', 'chats')
    await Promise.all([mkdir(workspace, { recursive: true }), mkdir(chatsDir, { recursive: true })])
    const baseRecord = {
      cwd: workspace,
      message: { role: 'user', parts: [{ text: 'version fixture' }] },
      parentUuid: null,
      provenance: 'real_user',
      timestamp: '2026-08-13T07:50:15.529Z',
      type: 'user'
    }
    const versionCases = [
      { id: 'missing-version', versions: [undefined] },
      { id: 'future-version', versions: ['0.22.0'] },
      { id: 'mixed-version', versions: ['0.21.11', '0.22.0'] }
    ]
    const sourceHashes = new Map<string, string>()
    for (const testCase of versionCases) {
      const filePath = path.join(chatsDir, `${testCase.id}.jsonl`)
      const records = testCase.versions.map((version, index) => ({
        ...baseRecord,
        uuid: `${testCase.id}-${index}`,
        sessionId: testCase.id,
        ...(version == null ? {} : { version })
      }))
      await writeJsonl(filePath, records)
      sourceHashes.set(filePath, sha256(await readFile(filePath, 'utf8')))
    }
    const env = { ...createTestEnv(workspace, home), QWEN_RUNTIME_DIR: qwenRuntimeDir }

    const preview = await previewNativeProjectHistory({
      adapters: ['qwen-code'],
      cwd: workspace,
      env,
      homeDir: home
    })
    const imported = await importNativeProjectHistory({
      adapters: ['qwen-code'],
      cwd: workspace,
      env,
      homeDir: home
    })

    expect(preview).toEqual(expect.objectContaining({ matchedFiles: 0, scannedFiles: 3 }))
    expect(imported).toEqual(expect.objectContaining({ importedSessions: 0, scannedFiles: 3 }))
    for (const [sourcePath, sourceHash] of sourceHashes) {
      expect(sha256(await readFile(sourcePath, 'utf8'))).toBe(sourceHash)
    }
  })

  it.each([
    'later agentId mismatch',
    'filename mismatch',
    'metadata agent mismatch',
    'wrong parent session',
    'wrong toolUseId',
    'missing parent call',
    'missing parent response',
    'duplicate parent correlation',
    'malformed metadata',
    'oversized metadata',
    'symlinked metadata'
  ])('rejects a Qwen subagent with %s', async (caseName) => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    const qwenRuntimeDir = path.join(home, '.qwen-runtime')
    await mkdir(workspace, { recursive: true })
    await materializeQwenFixture({ cwd: workspace, runtimeDir: qwenRuntimeDir })
    const parentPath = path.join(
      qwenRuntimeDir,
      'projects/-fixture/chats/da59db28-d7e8-4167-bc90-10a7b5bdec78.jsonl'
    )
    let childPath = path.join(
      qwenRuntimeDir,
      'projects/-fixture/subagents/da59db28-d7e8-4167-bc90-10a7b5bdec78/agent-general-purpose-call_agent_fixture.jsonl'
    )
    let metaPath = childPath.replace(/\.jsonl$/u, '.meta.json')
    if (caseName === 'later agentId mismatch') {
      const records = (await readFile(childPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
      records[1].agentId = 'different-agent'
      await writeJsonl(childPath, records)
    } else if (caseName === 'filename mismatch') {
      const renamedChildPath = path.join(path.dirname(childPath), 'agent-renamed.jsonl')
      const renamedMetaPath = renamedChildPath.replace(/\.jsonl$/u, '.meta.json')
      await Promise.all([rename(childPath, renamedChildPath), rename(metaPath, renamedMetaPath)])
      childPath = renamedChildPath
      metaPath = renamedMetaPath
    } else if (caseName === 'metadata agent mismatch') {
      const metadata = JSON.parse(await readFile(metaPath, 'utf8'))
      metadata.agentId = 'different-agent'
      await writeFile(metaPath, `${JSON.stringify(metadata)}\n`, 'utf8')
    } else if (caseName === 'wrong parent session') {
      const metadata = JSON.parse(await readFile(metaPath, 'utf8'))
      metadata.parentSessionId = 'different-parent'
      await writeFile(metaPath, `${JSON.stringify(metadata)}\n`, 'utf8')
    } else if (caseName === 'wrong toolUseId') {
      const metadata = JSON.parse(await readFile(metaPath, 'utf8'))
      metadata.toolUseId = 'different-tool-call'
      await writeFile(metaPath, `${JSON.stringify(metadata)}\n`, 'utf8')
    } else if (caseName === 'missing parent call') {
      const records = (await readFile(parentPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
      records.splice(1, 1)
      await writeJsonl(parentPath, records)
    } else if (caseName === 'missing parent response') {
      const records = (await readFile(parentPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
      records.splice(2, 1)
      await writeJsonl(parentPath, records)
    } else if (caseName === 'duplicate parent correlation') {
      const records = (await readFile(parentPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
      records.splice(2, 0, structuredClone(records[1]))
      await writeJsonl(parentPath, records)
    } else if (caseName === 'malformed metadata') {
      await writeFile(metaPath, '{not-json}\n', 'utf8')
    } else if (caseName === 'oversized metadata') {
      await writeFile(metaPath, 'x'.repeat(1024 * 1024 + 1), 'utf8')
    } else if (caseName === 'symlinked metadata') {
      const outsideMetaPath = path.join(root, 'outside-meta.json')
      await writeFile(outsideMetaPath, await readFile(metaPath, 'utf8'), 'utf8')
      await rm(metaPath)
      await symlink(outsideMetaPath, metaPath)
    }
    const sourceHash = sha256(await readFile(childPath, 'utf8'))
    const env = { ...createTestEnv(workspace, home), QWEN_RUNTIME_DIR: qwenRuntimeDir }

    const preview = await previewNativeProjectHistory({
      adapters: ['qwen-code'],
      cwd: workspace,
      env,
      homeDir: home,
      threadScope: 'subagent'
    })
    const imported = await importNativeProjectHistory({
      adapters: ['qwen-code'],
      cwd: workspace,
      env,
      homeDir: home,
      threadScope: 'subagent'
    })

    expect(preview.matchedFiles).toBe(0)
    expect(imported.importedSessions).toBe(0)
    expect(sha256(await readFile(childPath, 'utf8'))).toBe(sourceHash)
  })

  it.each(['project', 'chats', 'subagents'])(
    'rejects an explicit Qwen source through a symlinked $level ancestor',
    async (level) => {
      const root = await createTempRoot()
      const workspace = path.join(root, 'workspace')
      const home = path.join(root, 'home')
      const qwenRuntimeDir = path.join(home, '.qwen-runtime')
      const outsideRuntimeDir = path.join(root, 'outside-runtime')
      await mkdir(workspace, { recursive: true })
      await materializeQwenFixture({ cwd: workspace, runtimeDir: outsideRuntimeDir })
      const projectsDir = path.join(qwenRuntimeDir, 'projects')
      const outsideProjectDir = path.join(outsideRuntimeDir, 'projects', '-fixture')
      await mkdir(path.join(projectsDir, '-fixture'), { recursive: true })
      let sourcePath: string
      if (level === 'project') {
        await rm(path.join(projectsDir, '-fixture'), { recursive: true })
        await symlink(outsideProjectDir, path.join(projectsDir, '-fixture'))
        sourcePath = path.join(projectsDir, '-fixture/chats/1c408cc2-a3f3-4881-9807-4782e1788ffa.jsonl')
      } else if (level === 'chats') {
        await symlink(path.join(outsideProjectDir, 'chats'), path.join(projectsDir, '-fixture', 'chats'))
        sourcePath = path.join(projectsDir, '-fixture/chats/1c408cc2-a3f3-4881-9807-4782e1788ffa.jsonl')
      } else {
        await symlink(path.join(outsideProjectDir, 'subagents'), path.join(projectsDir, '-fixture', 'subagents'))
        sourcePath = path.join(
          projectsDir,
          '-fixture/subagents/da59db28-d7e8-4167-bc90-10a7b5bdec78/agent-general-purpose-call_agent_fixture.jsonl'
        )
      }
      const env = { ...createTestEnv(workspace, home), QWEN_RUNTIME_DIR: qwenRuntimeDir }

      const preview = await previewNativeProjectHistory({
        adapters: ['qwen-code'],
        cwd: workspace,
        env,
        homeDir: home,
        sourcePaths: [sourcePath]
      })
      const imported = await importNativeProjectHistory({
        adapters: ['qwen-code'],
        cwd: workspace,
        env,
        homeDir: home,
        sourcePaths: [sourcePath]
      })

      expect(preview).toEqual(expect.objectContaining({
        matchedFiles: 0,
        rejectedFiles: 1,
        scannedFiles: 1
      }))
      expect(imported).toEqual(expect.objectContaining({
        importedSessions: 0,
        rejectedFiles: 1,
        scannedFiles: 1
      }))
    }
  )

  it('applies the server-owned default history size limit before parsing and continues other candidates', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    const qwenRuntimeDir = path.join(home, '.qwen-runtime')
    const chatsDir = path.join(qwenRuntimeDir, 'projects', '-fixture', 'chats')
    const oversizedPath = path.join(chatsDir, 'oversized-session.jsonl')
    const validPath = path.join(chatsDir, 'valid-session.jsonl')
    await Promise.all([mkdir(workspace, { recursive: true }), mkdir(chatsDir, { recursive: true })])
    const record = (sessionId: string) => ({
      uuid: `${sessionId}-record`,
      parentUuid: null,
      sessionId,
      timestamp: '2026-08-13T07:50:15.529Z',
      type: 'user',
      provenance: 'real_user',
      cwd: workspace,
      version: '0.21.11',
      message: { role: 'user', parts: [{ text: sessionId }] }
    })
    await writeJsonl(oversizedPath, [record('oversized-session')])
    await truncate(oversizedPath, DEFAULT_NATIVE_HISTORY_IMPORT_MAX_FILE_SIZE_BYTES + 1)
    await writeJsonl(validPath, [record('valid-session')])
    const validHash = sha256(await readFile(validPath, 'utf8'))
    const env = { ...createTestEnv(workspace, home), QWEN_RUNTIME_DIR: qwenRuntimeDir }

    const preview = await previewNativeProjectHistory({
      adapters: ['qwen-code'],
      cwd: workspace,
      env,
      homeDir: home
    })
    const imported = await importNativeProjectHistory({
      adapters: ['qwen-code'],
      cwd: workspace,
      env,
      homeDir: home
    })

    expect(preview).toEqual(expect.objectContaining({
      largeFiles: 1,
      largestFileBytes: DEFAULT_NATIVE_HISTORY_IMPORT_MAX_FILE_SIZE_BYTES + 1,
      matchedFiles: 1,
      scannedFiles: 2
    }))
    expect(imported).toEqual(expect.objectContaining({
      importedSessions: 1,
      matchedFiles: 1,
      scannedFiles: 2
    }))
    expect(sha256(await readFile(validPath, 'utf8'))).toBe(validHash)
  })

  it('uses Qwen record cwd for all-project and projectPaths ownership', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'manager-workspace')
    const selectedWorkspace = path.join(root, 'selected-workspace')
    const excludedWorkspace = path.join(root, 'excluded-workspace')
    const home = path.join(root, 'home')
    const qwenRuntimeDir = path.join(home, '.qwen-runtime')
    await Promise.all([
      mkdir(workspace, { recursive: true }),
      mkdir(selectedWorkspace, { recursive: true }),
      mkdir(excludedWorkspace, { recursive: true })
    ])
    await materializeQwenFixture({ cwd: selectedWorkspace, runtimeDir: qwenRuntimeDir })
    const env = {
      ...createTestEnv(workspace, home),
      QWEN_RUNTIME_DIR: qwenRuntimeDir
    }
    const preview = await previewNativeProjectHistory({
      adapters: ['qwen-code'],
      cwd: workspace,
      env,
      homeDir: home,
      projectPaths: [selectedWorkspace],
      projectScope: 'all-projects'
    })
    const excluded = await previewNativeProjectHistory({
      adapters: ['qwen-code'],
      cwd: workspace,
      env,
      homeDir: home,
      projectPaths: [excludedWorkspace],
      projectScope: 'all-projects'
    })
    expect(preview.matchedFiles).toBe(3)
    expect(preview.adapters[0]!.projects).toEqual([{
      path: await realpath(selectedWorkspace),
      sessionCount: 3
    }])
    expect(excluded.matchedFiles).toBe(0)
  })

  it('fails closed for malformed, oversized, out-of-root, and symlinked Qwen history', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    const qwenRuntimeDir = path.join(home, '.qwen-runtime')
    const chatsDir = path.join(qwenRuntimeDir, 'projects', '-fixture', 'chats')
    const malformedPath = path.join(chatsDir, 'malformed.jsonl')
    const truncatedPath = path.join(chatsDir, 'truncated.jsonl')
    const outsidePath = path.join(root, 'outside', 'outside.jsonl')
    const symlinkPath = path.join(chatsDir, 'linked.jsonl')
    await Promise.all([
      mkdir(workspace, { recursive: true }),
      mkdir(chatsDir, { recursive: true }),
      mkdir(path.dirname(outsidePath), { recursive: true })
    ])
    const validRecord = JSON.stringify({
      uuid: 'valid-record',
      parentUuid: null,
      sessionId: 'fail-closed-session',
      timestamp: '2026-08-13T07:50:15.529Z',
      type: 'user',
      provenance: 'real_user',
      cwd: workspace,
      version: '0.21.11',
      message: { role: 'user', parts: [{ text: 'must not import' }] }
    })
    await writeFile(malformedPath, `${validRecord}\n{not-json}\n`, 'utf8')
    await writeFile(truncatedPath, `${validRecord}\n{"uuid":"truncated"`, 'utf8')
    await writeFile(outsidePath, `${validRecord}\n`, 'utf8')
    await symlink(outsidePath, symlinkPath)
    const env = {
      ...createTestEnv(workspace, home),
      QWEN_RUNTIME_DIR: qwenRuntimeDir
    }

    const preview = await previewNativeProjectHistory({
      adapters: ['qwen-code'],
      cwd: workspace,
      env,
      homeDir: home
    })
    const containedImport = await importNativeProjectHistory({
      adapters: ['qwen-code'],
      cwd: workspace,
      env,
      homeDir: home,
      sourcePaths: [outsidePath]
    })
    const sizeLimitedImport = await importNativeProjectHistory({
      adapters: ['qwen-code'],
      cwd: workspace,
      env,
      homeDir: home,
      maxFileSizeBytesByAdapter: { 'qwen-code': 1 }
    })

    expect(preview).toEqual(expect.objectContaining({
      matchedFiles: 0,
      rejectedFiles: 3,
      scannedFiles: 3
    }))
    expect(containedImport).toEqual(expect.objectContaining({ importedSessions: 0, scannedFiles: 0 }))
    expect(sizeLimitedImport).toEqual(expect.objectContaining({
      importedSessions: 0,
      perFileLimitedFiles: 2,
      rejectedFiles: 1,
      scannedFiles: 3
    }))
    expect(await readFile(malformedPath, 'utf8')).toBe(`${validRecord}\n{not-json}\n`)
    expect(await readFile(truncatedPath, 'utf8')).toBe(`${validRecord}\n{"uuid":"truncated"`)
  })

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

  it('maps a deleted Codex worktree to an existing checkout and imports it as an openable project', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'manager-workspace')
    const canonicalWorkspace = path.join(root, 'codes', 'modeldriveprotocol')
    const wrongOriginWorkspace = path.join(root, 'codes', 'unrelated')
    const staleWorktree = path.join(root, '.codex', 'worktrees', 'a482', 'modeldriveprotocol')
    const home = path.join(root, 'home')
    const sourcePath = path.join(home, '.codex', 'sessions', 'target.jsonl')
    const remoteUrl = 'https://github.com/modeldriveprotocol/modeldriveprotocol.git'
    const env = createTestEnv(workspace, home)

    await Promise.all([
      mkdir(workspace, { recursive: true }),
      mkdir(canonicalWorkspace, { recursive: true }),
      mkdir(wrongOriginWorkspace, { recursive: true })
    ])
    await writeGitOrigin(canonicalWorkspace, remoteUrl)
    await writeGitOrigin(wrongOriginWorkspace, 'https://github.com/example/unrelated.git')
    await writeJsonl(sourcePath, [
      {
        type: 'session_meta',
        timestamp: '2026-06-01T00:00:00.000Z',
        payload: {
          id: 'codex-stale-worktree',
          cwd: staleWorktree
        }
      },
      {
        type: 'event_msg',
        timestamp: '2026-06-01T00:00:01.000Z',
        payload: {
          type: 'user_message',
          message: 'Import from a deleted worktree'
        }
      }
    ])
    await writeCodexThreadState(home, [
      {
        createdAt: 1_000,
        cwd: staleWorktree,
        gitOriginUrl: remoteUrl,
        id: 'codex-stale-worktree',
        rolloutPath: sourcePath,
        title: 'Deleted worktree session',
        updatedAt: 2_000
      },
      {
        createdAt: 1_000,
        cwd: canonicalWorkspace,
        gitOriginUrl: remoteUrl,
        id: 'codex-canonical-1',
        rolloutPath: path.join(home, '.codex', 'sessions', 'canonical-1.jsonl'),
        title: 'Canonical checkout one',
        updatedAt: 2_000
      },
      {
        createdAt: 1_000,
        cwd: canonicalWorkspace,
        gitOriginUrl: remoteUrl,
        id: 'codex-canonical-2',
        rolloutPath: path.join(home, '.codex', 'sessions', 'canonical-2.jsonl'),
        title: 'Canonical checkout two',
        updatedAt: 2_000
      },
      {
        createdAt: 1_000,
        cwd: wrongOriginWorkspace,
        gitOriginUrl: remoteUrl,
        id: 'codex-wrong-origin-1',
        rolloutPath: path.join(home, '.codex', 'sessions', 'wrong-origin-1.jsonl'),
        title: 'Incorrect metadata one',
        updatedAt: 2_000
      },
      {
        createdAt: 1_000,
        cwd: wrongOriginWorkspace,
        gitOriginUrl: remoteUrl,
        id: 'codex-wrong-origin-2',
        rolloutPath: path.join(home, '.codex', 'sessions', 'wrong-origin-2.jsonl'),
        title: 'Incorrect metadata two',
        updatedAt: 2_000
      },
      {
        createdAt: 1_000,
        cwd: wrongOriginWorkspace,
        gitOriginUrl: remoteUrl,
        id: 'codex-wrong-origin-3',
        rolloutPath: path.join(home, '.codex', 'sessions', 'wrong-origin-3.jsonl'),
        title: 'Incorrect metadata three',
        updatedAt: 2_000
      }
    ])

    const canonicalRealPath = await realpath(canonicalWorkspace)
    const preview = await previewNativeProjectHistory({
      adapters: ['codex'],
      cwd: workspace,
      env,
      homeDir: home,
      projectPaths: [canonicalWorkspace],
      projectScope: 'all-projects',
      sourcePaths: [sourcePath]
    })
    const firstImport = await importNativeProjectHistory({
      adapters: ['codex'],
      cwd: workspace,
      env,
      homeDir: home,
      projectPaths: [canonicalWorkspace],
      projectScope: 'all-projects',
      sourcePaths: [sourcePath]
    })
    const secondImport = await importNativeProjectHistory({
      adapters: ['codex'],
      cwd: workspace,
      env,
      homeDir: home,
      projectPaths: [canonicalWorkspace],
      projectScope: 'all-projects',
      sourcePaths: [sourcePath]
    })

    expect(preview.adapters[0]).toEqual(expect.objectContaining({
      candidates: [
        expect.objectContaining({
          cwd: canonicalRealPath,
          nativeSessionId: 'codex-stale-worktree'
        })
      ],
      projects: [{ path: canonicalRealPath, sessionCount: 1 }]
    }))
    expect(firstImport).toEqual(expect.objectContaining({
      importedEvents: 1,
      importedSessions: 1,
      matchedFiles: 1,
      sessions: [
        expect.objectContaining({
          cwd: staleWorktree,
          workspaceCwd: canonicalRealPath
        })
      ]
    }))
    expect(secondImport).toEqual(expect.objectContaining({
      importedEvents: 0,
      importedSessions: 0,
      matchedFiles: 0
    }))

    vi.stubEnv('HOME', home)
    vi.stubEnv('__ONEWORKS_PROJECT_HOME_PROJECT_DIR__', 'manager')
    await rememberLauncherWorkspaces(firstImport.sessions.map(session => session.workspaceCwd))
    const launcherState = await listLauncherWorkspaces()
    expect(launcherState.recentProjects).toEqual([
      expect.objectContaining({
        workspaceFolder: canonicalRealPath
      })
    ])

    const canonicalRuntimeRoot = resolveWorkspaceRuntimeStoreRoot(
      canonicalRealPath,
      createWorkspaceRuntimeEnv(canonicalRealPath, env)
    )
    const importedSessionId = firstImport.sessions[0]!.sessionId
    const importedMeta = JSON.parse(
      await readFile(path.join(canonicalRuntimeRoot, 'sessions', importedSessionId, 'meta.json'), 'utf8')
    ) as {
      cwd?: string
      historyImport?: {
        importedAt?: number
        nativeCwd?: string
        sourceUpdatedAt?: number
        workspaceCwd?: string
      }
    }
    expect(importedMeta).toEqual(expect.objectContaining({
      cwd: canonicalRealPath,
      historyImport: expect.objectContaining({
        importedAt: expect.any(Number),
        nativeCwd: staleWorktree,
        sourceUpdatedAt: 2_000_000,
        workspaceCwd: canonicalRealPath
      })
    }))
    const importedDb = await replayImportedSessions(canonicalRuntimeRoot)
    expect(importedDb.getSession(importedSessionId)).toEqual(expect.objectContaining({
      id: importedSessionId,
      historyImport: expect.objectContaining({
        adapter: 'codex',
        importedAt: expect.any(Number),
        sourceUpdatedAt: 2_000_000
      })
    }))
    importedDb.close()
  })

  it('filters all-project previews by selected project roots before pagination', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const selectedWorkspace = path.join(root, 'selected')
    const selectedConversationCwd = path.join(selectedWorkspace, 'packages', 'app')
    const home = path.join(root, 'home')
    const codexHistoryDir = path.join(home, '.codex', 'sessions')
    const env = createTestEnv(workspace, home)

    await Promise.all([
      mkdir(workspace, { recursive: true }),
      mkdir(selectedConversationCwd, { recursive: true })
    ])
    await writeJsonl(path.join(codexHistoryDir, 'workspace.jsonl'), [
      {
        type: 'session_meta',
        timestamp: '2026-06-02T00:00:00.000Z',
        payload: {
          id: 'codex-workspace-project',
          cwd: workspace
        }
      },
      {
        type: 'event_msg',
        timestamp: '2026-06-02T00:00:01.000Z',
        payload: {
          type: 'user_message',
          message: 'Workspace project history'
        }
      }
    ])
    await writeJsonl(path.join(codexHistoryDir, 'selected.jsonl'), [
      {
        type: 'session_meta',
        timestamp: '2026-06-01T00:00:00.000Z',
        payload: {
          id: 'codex-selected-project',
          cwd: selectedConversationCwd
        }
      },
      {
        type: 'event_msg',
        timestamp: '2026-06-01T00:00:01.000Z',
        payload: {
          type: 'user_message',
          message: 'Selected project history'
        }
      }
    ])

    const preview = await previewNativeProjectHistory({
      adapters: ['codex'],
      cwd: workspace,
      env,
      homeDir: home,
      previewLimit: 1,
      projectPaths: [selectedWorkspace],
      projectScope: 'all-projects'
    })
    expect(preview).toEqual(expect.objectContaining({
      matchedFiles: 1,
      scannedFiles: 2
    }))
    expect(preview.adapters[0]!.candidates.map(candidate => candidate.title)).toEqual([
      'Selected project history'
    ])
    expect(preview.adapters[0]!.projects).toEqual(expect.arrayContaining([
      { path: await realpath(selectedConversationCwd), sessionCount: 1 },
      { path: await realpath(workspace), sessionCount: 1 }
    ]))
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
      scannedFiles: 1
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

  it('reads only explicitly requested history files inside adapter source roots', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    const codexHistoryDir = path.join(home, '.codex', 'sessions')
    const requestedSourcePath = path.join(codexHistoryDir, 'requested.jsonl')
    const unrequestedSourcePath = path.join(codexHistoryDir, 'unrequested.jsonl')
    const outsideSourcePath = path.join(home, 'outside.jsonl')
    const env = createTestEnv(workspace, home)

    await mkdir(workspace, { recursive: true })
    await Promise.all([
      writeJsonl(requestedSourcePath, [
        {
          type: 'session_meta',
          timestamp: '2026-06-07T00:00:00.000Z',
          payload: {
            id: 'codex-requested',
            cwd: workspace
          }
        },
        {
          type: 'event_msg',
          timestamp: '2026-06-07T00:00:01.000Z',
          payload: {
            type: 'user_message',
            message: 'Import requested source'
          }
        }
      ]),
      writeJsonl(unrequestedSourcePath, [
        {
          type: 'session_meta',
          timestamp: '2026-06-07T00:00:00.000Z',
          payload: {
            id: 'codex-unrequested',
            cwd: workspace
          }
        },
        {
          type: 'event_msg',
          timestamp: '2026-06-07T00:00:01.000Z',
          payload: {
            type: 'user_message',
            message: 'Do not import this source'
          }
        }
      ]),
      writeJsonl(outsideSourcePath, [
        {
          type: 'session_meta',
          timestamp: '2026-06-07T00:00:00.000Z',
          payload: {
            id: 'codex-outside',
            cwd: workspace
          }
        },
        {
          type: 'event_msg',
          timestamp: '2026-06-07T00:00:01.000Z',
          payload: {
            type: 'user_message',
            message: 'Do not import outside source roots'
          }
        }
      ])
    ])

    const preview = await previewNativeProjectHistory({
      adapters: ['codex'],
      cwd: workspace,
      env,
      homeDir: home,
      sourcePaths: [requestedSourcePath, outsideSourcePath]
    })
    const imported = await importNativeProjectHistory({
      adapters: ['codex'],
      cwd: workspace,
      env,
      homeDir: home,
      sourcePaths: [requestedSourcePath, outsideSourcePath]
    })

    expect(preview).toEqual(expect.objectContaining({
      matchedFiles: 1,
      scannedFiles: 1
    }))
    expect(preview.adapters[0]!.candidates.map(candidate => candidate.nativeSessionId)).toEqual([
      'codex-requested'
    ])
    expect(imported).toEqual(expect.objectContaining({
      importedSessions: 1,
      matchedFiles: 1,
      scannedFiles: 1
    }))
    expect(imported.sessions.map(session => session.sourcePath)).toEqual([requestedSourcePath])
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

  it('enforces the aggregate budget while consuming bytes and continues later bounded candidates', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    const historyDir = path.join(home, '.codex', 'sessions')
    const env = createTestEnv(workspace, home)
    await mkdir(workspace, { recursive: true })

    const content = (id: string, title: string, trailingNewline = true) => {
      const lines = [
        JSON.stringify({
          type: 'session_meta',
          timestamp: '2026-08-13T00:00:00.000Z',
          payload: { id, cwd: workspace }
        }),
        JSON.stringify({
          type: 'event_msg',
          timestamp: '2026-08-13T00:00:01.000Z',
          payload: { type: 'user_message', message: title }
        })
      ].join('\n')
      return trailingNewline ? `${lines}\n` : lines
    }
    const writePadded = async (filePath: string, value: string, size: number) => {
      const bytes = Buffer.from(value)
      expect(bytes.length).toBeLessThanOrEqual(size)
      await mkdir(path.dirname(filePath), { recursive: true })
      await writeFile(filePath, Buffer.concat([bytes, Buffer.alloc(size - bytes.length, 0x20)]))
    }
    const firstPath = path.join(historyDir, 'first.jsonl')
    const skippedPath = path.join(historyDir, 'second.jsonl')
    const lastPath = path.join(historyDir, 'third-no-newline.jsonl')
    const lastContent = content('codex-last', 'Import after aggregate skip', false)
    await writePadded(firstPath, content('codex-first', 'Import first'), 512)
    await writePadded(skippedPath, content('codex-skipped', 'Skip aggregate'), 800)
    await writeFile(lastPath, lastContent, 'utf8')
    await utimes(firstPath, 300, 300)
    await utimes(skippedPath, 200, 200)
    await utimes(lastPath, 100, 100)
    const lastHash = sha256(await readFile(lastPath, 'utf8'))
    const options = {
      adapters: ['codex' as const],
      cwd: workspace,
      env,
      homeDir: home,
      maxFileSizeBytes: 1024,
      maxTotalBytes: 900,
      sourcePaths: [firstPath, skippedPath, lastPath],
      timeSort: 'updatedAt' as const
    }

    const preview = await previewNativeProjectHistory(options)
    const imported = await importNativeProjectHistory(options)

    expect(preview).toEqual(expect.objectContaining({
      matchedFiles: 2,
      rejectedFiles: 0,
      scannedFiles: 3,
      sizeLimitedBytes: 800,
      sizeLimitedFiles: 1
    }))
    expect(preview.adapters[0]!.candidates.map(candidate => candidate.nativeSessionId)).toEqual([
      'codex-last',
      'codex-first'
    ])
    expect(imported).toEqual(expect.objectContaining({
      importedSessions: 2,
      matchedFiles: 2,
      rejectedFiles: 0,
      sizeLimitedBytes: 800,
      sizeLimitedFiles: 1
    }))
    expect(imported.sessions.map(session => session.title)).toEqual([
      'Import after aggregate skip',
      'Import first'
    ])
    expect(sha256(await readFile(lastPath, 'utf8'))).toBe(lastHash)
  })

  it('debits Codex session index, global state, SQLite, and rollout bytes from one exact budget', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    const sourcePath = path.join(home, '.codex', 'sessions', 'codex-budget.jsonl')
    const statePath = path.join(home, '.codex', '.codex-global-state.json')
    const indexPath = path.join(home, '.codex', 'session_index.jsonl')
    const databasePath = path.join(home, '.codex', 'state_5.sqlite')
    const env = createTestEnv(workspace, home)
    await mkdir(workspace, { recursive: true })
    await writeJsonl(sourcePath, [
      {
        payload: { cwd: workspace, id: 'codex-budget' },
        timestamp: '2026-08-13T00:00:00.000Z',
        type: 'session_meta'
      },
      {
        payload: { message: 'Budgeted Codex source', type: 'user_message' },
        timestamp: '2026-08-13T00:00:01.000Z',
        type: 'event_msg'
      }
    ])
    await writeCodexGlobalState(home, { 'pinned-thread-ids': ['codex-budget'] })
    await writeCodexSessionIndex(home, [{ id: 'codex-budget', threadName: 'Indexed budget title' }])
    await writeCodexThreadState(home, [{
      createdAt: Date.parse('2026-08-13T00:00:00.000Z'),
      cwd: workspace,
      id: 'codex-budget',
      rolloutPath: sourcePath,
      title: 'SQLite budget title',
      updatedAt: Date.parse('2026-08-13T00:00:01.000Z')
    }])
    const metadataPaths = [statePath, indexPath, databasePath]
    const exactBytes = (await Promise.all(
      [...metadataPaths, sourcePath].map(async filePath => (await stat(filePath)).size)
    )).reduce((sum, size) => sum + size, 0)
    const maxFileSizeBytes = Math.max(
      ...await Promise.all(
        [...metadataPaths, sourcePath].map(async filePath => (await stat(filePath)).size)
      )
    )
    const openedPaths: string[] = []
    const options = {
      adapters: ['codex' as const],
      cwd: workspace,
      env,
      homeDir: home,
      maxFileSizeBytes,
      maxTotalBytes: exactBytes,
      readOperations: {
        afterOpen: (filePath: string) => {
          openedPaths.push(filePath)
        }
      },
      sourcePaths: [sourcePath]
    }

    const preview = await previewNativeProjectHistory(options)
    expect(preview).toEqual(expect.objectContaining({
      aggregateLimitedFiles: 0,
      matchedFiles: 1,
      rejectedFiles: 0
    }))
    expect(preview.adapters[0]!.candidates[0]).toEqual(expect.objectContaining({
      isPinned: true,
      title: 'Indexed budget title'
    }))
    expect(openedPaths).toEqual([...metadataPaths, sourcePath])

    const imported = await importNativeProjectHistory({ ...options, readOperations: undefined })
    expect(imported).toEqual(expect.objectContaining({
      aggregateLimitedFiles: 0,
      importedSessions: 1,
      matchedFiles: 1
    }))

    const exhausted = await previewNativeProjectHistory({
      ...options,
      maxTotalBytes: exactBytes - 1,
      readOperations: undefined
    })
    expect(exhausted).toEqual(expect.objectContaining({
      aggregateLimitedBytes: (await stat(sourcePath)).size,
      aggregateLimitedFiles: 1,
      matchedFiles: 0,
      perFileLimitedFiles: 0,
      rejectedFiles: 0
    }))
  })

  it('debits Cursor workspace metadata and Grok summaries from the same preview/import budget', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const discoveredWorkspace = path.join(root, 'cursor-project')
    const home = path.join(root, 'home')
    const env = createTestEnv(workspace, home)
    const cursorProjectKey = discoveredWorkspace
      .replace(/[^a-z0-9]/gi, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
    const cursorSourcePath = path.join(
      home,
      '.cursor',
      'projects',
      cursorProjectKey,
      'agent-transcripts',
      'cursor-budget',
      'cursor-budget.jsonl'
    )
    const cursorMetadataPath = path.join(
      home,
      'Library',
      'Application Support',
      'Cursor',
      'User',
      'workspaceStorage',
      'budget-workspace',
      'workspace.json'
    )
    await Promise.all([
      mkdir(workspace, { recursive: true }),
      mkdir(discoveredWorkspace, { recursive: true }),
      mkdir(path.dirname(cursorMetadataPath), { recursive: true })
    ])
    await writeFile(
      cursorMetadataPath,
      `${JSON.stringify({ folder: pathToFileURL(discoveredWorkspace).href })}\n`,
      'utf8'
    )
    await writeJsonl(cursorSourcePath, [{
      message: { content: [{ text: 'Cursor exact metadata budget', type: 'text' }] },
      role: 'user'
    }])
    const cursorMetadataBytes = (await stat(cursorMetadataPath)).size
    const cursorSourceBytes = (await stat(cursorSourcePath)).size
    const cursorOptions = {
      adapters: ['cursor' as const],
      cwd: workspace,
      env,
      homeDir: home,
      maxFileSizeBytes: Math.max(cursorMetadataBytes, cursorSourceBytes),
      maxTotalBytes: cursorMetadataBytes + cursorSourceBytes,
      projectScope: 'all-projects' as const,
      sourcePaths: [cursorSourcePath]
    }
    expect(await previewNativeProjectHistory(cursorOptions)).toEqual(expect.objectContaining({
      aggregateLimitedFiles: 0,
      matchedFiles: 1
    }))
    expect(await importNativeProjectHistory(cursorOptions)).toEqual(expect.objectContaining({
      aggregateLimitedFiles: 0,
      importedSessions: 1
    }))
    expect(
      await previewNativeProjectHistory({
        ...cursorOptions,
        maxTotalBytes: cursorMetadataBytes + cursorSourceBytes - 1
      })
    ).toEqual(expect.objectContaining({
      aggregateLimitedBytes: cursorSourceBytes,
      aggregateLimitedFiles: 1,
      matchedFiles: 0,
      perFileLimitedFiles: 0
    }))

    const grokSessionId = '33333333-3333-4333-8333-333333333333'
    const grokSessionDir = path.join(home, '.grok', 'sessions', encodeURIComponent(workspace), grokSessionId)
    const grokSourcePath = path.join(grokSessionDir, 'chat_history.jsonl')
    const grokSummaryPath = path.join(grokSessionDir, 'summary.json')
    await mkdir(grokSessionDir, { recursive: true })
    await writeFile(
      grokSummaryPath,
      JSON.stringify({
        info: { cwd: workspace, id: grokSessionId },
        session_summary: 'Grok exact metadata budget'
      })
    )
    await writeJsonl(grokSourcePath, [{
      content: [{ text: 'Grok budget source', type: 'text' }],
      cwd: workspace,
      type: 'user'
    }])
    const grokSummaryBytes = (await stat(grokSummaryPath)).size
    const grokSourceBytes = (await stat(grokSourcePath)).size
    const grokOptions = {
      adapters: ['grok' as const],
      cwd: workspace,
      env,
      homeDir: home,
      maxFileSizeBytes: Math.max(grokSummaryBytes, grokSourceBytes),
      maxTotalBytes: grokSummaryBytes + grokSourceBytes,
      sourcePaths: [grokSourcePath]
    }
    expect(await previewNativeProjectHistory(grokOptions)).toEqual(expect.objectContaining({
      aggregateLimitedFiles: 0,
      matchedFiles: 1
    }))
    expect(await importNativeProjectHistory(grokOptions)).toEqual(expect.objectContaining({
      aggregateLimitedFiles: 0,
      importedSessions: 1
    }))
    expect(
      await previewNativeProjectHistory({
        ...grokOptions,
        maxTotalBytes: grokSummaryBytes + grokSourceBytes - 1
      })
    ).toEqual(expect.objectContaining({
      aggregateLimitedBytes: grokSourceBytes,
      aggregateLimitedFiles: 1,
      matchedFiles: 0,
      perFileLimitedFiles: 0
    }))
  })

  it('debits Qwen subagent metadata and parent correlation reads from the exact shared budget', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    const runtimeDir = path.join(home, '.qwen-runtime')
    const env = { ...createTestEnv(workspace, home), QWEN_RUNTIME_DIR: runtimeDir }
    await mkdir(workspace, { recursive: true })
    await materializeQwenFixture({ cwd: workspace, runtimeDir })
    const parentPath = path.join(
      runtimeDir,
      'projects/-fixture/chats/da59db28-d7e8-4167-bc90-10a7b5bdec78.jsonl'
    )
    const agentPath = path.join(
      runtimeDir,
      'projects/-fixture/subagents/da59db28-d7e8-4167-bc90-10a7b5bdec78/',
      'agent-general-purpose-call_agent_fixture.jsonl'
    )
    const metadataPath = agentPath.replace(/\.jsonl$/u, '.meta.json')
    const sizes = Object.fromEntries(
      await Promise.all(
        [agentPath, metadataPath, parentPath].map(async filePath => [filePath, (await stat(filePath)).size])
      )
    ) as Record<string, number>
    const exactPreviewBytes = sizes[agentPath]! + sizes[metadataPath]! + sizes[parentPath]!
    const openedPaths: string[] = []
    const options = {
      adapters: ['qwen-code' as const],
      cwd: workspace,
      env,
      homeDir: home,
      maxFileSizeBytes: Math.max(...Object.values(sizes)),
      maxTotalBytes: exactPreviewBytes,
      readOperations: {
        afterOpen: (filePath: string) => {
          openedPaths.push(filePath)
        }
      },
      sourcePaths: [agentPath],
      threadScope: 'subagent' as const
    }
    expect(await previewNativeProjectHistory(options)).toEqual(expect.objectContaining({
      aggregateLimitedFiles: 0,
      matchedFiles: 1,
      rejectedFiles: 0
    }))
    expect(openedPaths).toEqual([agentPath, metadataPath, parentPath])
    expect(
      await previewNativeProjectHistory({
        ...options,
        maxTotalBytes: exactPreviewBytes - 1,
        readOperations: undefined
      })
    ).toEqual(expect.objectContaining({
      aggregateLimitedBytes: sizes[parentPath],
      aggregateLimitedFiles: 1,
      matchedFiles: 0,
      perFileLimitedFiles: 0
    }))

    const exactImportBytes = sizes[agentPath]! + 2 * sizes[metadataPath]! + 2 * sizes[parentPath]!
    expect(
      await importNativeProjectHistory({
        ...options,
        maxTotalBytes: exactImportBytes,
        readOperations: undefined
      })
    ).toEqual(expect.objectContaining({
      aggregateLimitedFiles: 0,
      importedSessions: 1,
      matchedFiles: 1
    }))
  })

  it.each(['grow', 'replace', 'symlink'] as const)(
    'rejects a Codex SQLite %s race before querying and continues the rollout',
    async (scenario) => {
      const root = await createTempRoot()
      const workspace = path.join(root, 'workspace')
      const home = path.join(root, 'home')
      const sourcePath = path.join(home, '.codex', 'sessions', `sqlite-${scenario}.jsonl`)
      const databasePath = path.join(home, '.codex', 'state_5.sqlite')
      const backupPath = path.join(root, `state-${scenario}.sqlite`)
      const env = createTestEnv(workspace, home)
      await mkdir(workspace, { recursive: true })
      await writeJsonl(sourcePath, [
        {
          payload: { cwd: workspace, id: `sqlite-${scenario}` },
          timestamp: '2026-08-13T00:00:00.000Z',
          type: 'session_meta'
        },
        {
          payload: { message: `Continue after SQLite ${scenario}`, type: 'user_message' },
          timestamp: '2026-08-13T00:00:01.000Z',
          type: 'event_msg'
        }
      ])
      await writeCodexThreadState(home, [{
        createdAt: 1,
        cwd: workspace,
        id: `sqlite-${scenario}`,
        rolloutPath: sourcePath,
        title: `SQLite ${scenario}`,
        updatedAt: 2
      }])
      if (scenario === 'symlink') {
        await rename(databasePath, backupPath)
        await symlink(backupPath, databasePath)
      }
      let changed = false
      const readOperations = scenario === 'symlink'
        ? undefined
        : {
          afterOpen: async (filePath: string) => {
            if (changed || filePath !== databasePath) return
            changed = true
            if (scenario === 'grow') {
              await truncate(databasePath, (await stat(databasePath)).size + 1)
            } else {
              await rename(databasePath, backupPath)
              await writeFile(databasePath, await readFile(backupPath))
            }
          }
        }
      const preview = await previewNativeProjectHistory({
        adapters: ['codex'],
        cwd: workspace,
        env,
        homeDir: home,
        maxFileSizeBytes: 1024 * 1024,
        maxTotalBytes: 2 * 1024 * 1024,
        readOperations,
        sourcePaths: [sourcePath]
      })
      expect(preview).toEqual(expect.objectContaining({
        matchedFiles: 1,
        rejectedFiles: 1
      }))
      expect(preview.adapters[0]!.candidates[0]).toEqual(expect.objectContaining({
        nativeSessionId: `sqlite-${scenario}`
      }))
    }
  )

  it('accepts an exact per-file boundary and lets manual import exceed a smaller automatic threshold', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    const sourcePath = path.join(home, '.codex', 'sessions', 'exact-boundary.jsonl')
    const env = createTestEnv(workspace, home)
    const content = [
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-08-13T00:00:00.000Z',
        payload: { id: 'codex-exact-boundary', cwd: workspace }
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-08-13T00:00:01.000Z',
        payload: { type: 'user_message', message: 'Exact boundary without final newline' }
      })
    ].join('\n')
    const exactLimit = 1024
    const bytes = Buffer.from(content)
    await mkdir(workspace, { recursive: true })
    await mkdir(path.dirname(sourcePath), { recursive: true })
    await writeFile(sourcePath, Buffer.concat([bytes, Buffer.alloc(exactLimit - bytes.length, 0x20)]))
    const sourceHash = sha256(await readFile(sourcePath, 'utf8'))
    const autoOptions = resolveNativeHistoryAutoImportOptions({
      nativeHistoryImport: { autoImport: true, maxFileSizeBytes: exactLimit - 1 }
    })!

    const autoResult = await importNativeProjectHistory({
      ...autoOptions,
      cwd: workspace,
      env,
      homeDir: home,
      sourcePaths: [sourcePath]
    })
    const preview = await previewNativeProjectHistory({
      adapters: ['codex'],
      cwd: workspace,
      env,
      homeDir: home,
      maxFileSizeBytes: exactLimit,
      sourcePaths: [sourcePath]
    })
    const manualResult = await importNativeProjectHistory({
      adapters: ['codex'],
      cwd: workspace,
      env,
      homeDir: home,
      maxFileSizeBytes: exactLimit,
      sourcePaths: [sourcePath]
    })

    expect(autoResult).toEqual(expect.objectContaining({
      importedSessions: 0,
      sizeLimitedBytes: exactLimit,
      sizeLimitedFiles: 1
    }))
    expect(preview).toEqual(expect.objectContaining({ matchedFiles: 1, sizeLimitedFiles: 0 }))
    expect(preview.adapters[0]!.candidates[0]).toEqual(expect.objectContaining({
      fileSizeBytes: exactLimit,
      nativeSessionId: 'codex-exact-boundary'
    }))
    expect(manualResult).toEqual(expect.objectContaining({ importedSessions: 1, matchedFiles: 1 }))
    expect(sha256(await readFile(sourcePath, 'utf8'))).toBe(sourceHash)
  })

  it.each(['grow-after-open', 'replace-after-open', 'symlink-before-open'] as const)(
    'fails closed on a %s race and continues the next candidate in preview and import',
    async (scenario) => {
      const root = await createTempRoot()
      const workspace = path.join(root, 'workspace')
      const home = path.join(root, 'home')
      const historyDir = path.join(home, '.codex', 'sessions')
      const badPath = path.join(historyDir, `${scenario}.jsonl`)
      const validPath = path.join(historyDir, 'valid.jsonl')
      const outsidePath = path.join(root, 'outside.jsonl')
      const backupPath = path.join(root, `${scenario}.backup.jsonl`)
      const env = createTestEnv(workspace, home)
      const record = (id: string, title: string) => [
        {
          type: 'session_meta',
          timestamp: '2026-08-13T00:00:00.000Z',
          payload: { id, cwd: workspace }
        },
        {
          type: 'event_msg',
          timestamp: '2026-08-13T00:00:01.000Z',
          payload: { type: 'user_message', message: title }
        }
      ]
      await mkdir(workspace, { recursive: true })
      await writeJsonl(outsidePath, record('outside', 'Outside'))
      const resetSources = async () => {
        await rm(badPath, { force: true })
        await rm(backupPath, { force: true })
        await writeJsonl(badPath, record('bad-race', 'Reject race'))
        await writeJsonl(validPath, record('valid-after-race', 'Continue safely'))
        await utimes(badPath, 300, 300)
        await utimes(validPath, 100, 100)
      }
      const createOperations = () => {
        let applied = false
        return {
          beforeOpen: async (filePath: string) => {
            if (applied || filePath !== badPath || scenario !== 'symlink-before-open') return
            applied = true
            await rename(badPath, backupPath)
            await symlink(outsidePath, badPath)
          },
          afterOpen: async (filePath: string) => {
            if (applied || filePath !== badPath || scenario === 'symlink-before-open') return
            applied = true
            if (scenario === 'grow-after-open') {
              await truncate(badPath, 513)
            } else {
              await rename(badPath, backupPath)
              await writeJsonl(badPath, record('replacement', 'Replacement'))
            }
          }
        }
      }
      const options = (readOperations: ReturnType<typeof createOperations>) => ({
        adapters: ['codex' as const],
        cwd: workspace,
        env,
        homeDir: home,
        maxFileSizeBytes: 512,
        maxTotalBytes: 2048,
        readOperations,
        sourcePaths: [badPath, validPath],
        timeSort: 'updatedAt' as const
      })

      await resetSources()
      const preview = await previewNativeProjectHistory(options(createOperations()))
      expect(preview).toEqual(expect.objectContaining({ matchedFiles: 1, scannedFiles: 2 }))
      expect(preview.adapters[0]!.candidates[0]).toEqual(expect.objectContaining({
        nativeSessionId: 'valid-after-race'
      }))
      if (scenario === 'grow-after-open') {
        expect(preview).toEqual(expect.objectContaining({ sizeLimitedFiles: 1 }))
      } else {
        expect(preview).toEqual(expect.objectContaining({ rejectedFiles: 1 }))
      }

      await resetSources()
      const validHash = sha256(await readFile(validPath, 'utf8'))
      const imported = await importNativeProjectHistory(options(createOperations()))
      expect(imported).toEqual(expect.objectContaining({ importedSessions: 1, matchedFiles: 1 }))
      expect(imported.sessions[0]).toEqual(expect.objectContaining({
        title: 'Continue safely'
      }))
      if (scenario === 'grow-after-open') {
        expect(imported).toEqual(expect.objectContaining({ sizeLimitedFiles: 1 }))
      } else {
        expect(imported).toEqual(expect.objectContaining({ rejectedFiles: 1 }))
      }
      expect(sha256(await readFile(validPath, 'utf8'))).toBe(validHash)
    }
  )

  it('marks native history import as handled for the first project open', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    const codexHistoryDir = path.join(home, '.codex', 'sessions')
    const env = createTestEnv(workspace, home)
    vi.stubEnv('DB_PATH', path.join(root, 'db.sqlite'))

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
      aggregateLimitedBytes: 0,
      aggregateLimitedFiles: 0,
      importedEvents: 0,
      importedSessions: 0,
      matchedFiles: 0,
      perFileLimitedBytes: 0,
      perFileLimitedFiles: 0,
      rejectedFiles: 0,
      scannedFiles: 0,
      sessions: [],
      sizeLimitedBytes: 0,
      sizeLimitedFiles: 0
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
