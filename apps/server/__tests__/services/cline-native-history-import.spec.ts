/* eslint-disable max-lines -- one released Cline fixture drives the complete read-only safety matrix. */
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { CLINE_HISTORY_DATABASE_MAX_BYTES } from '#~/services/runtime-store/cline-history.js'
import { importNativeProjectHistory, previewNativeProjectHistory } from '#~/services/runtime-store/history-import.js'
import { createWorkspaceRuntimeEnv, resolveWorkspaceRuntimeStoreRoot } from '#~/services/runtime-store/workspace-env.js'

const require = createRequire(__filename)
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')

const fixtureRoot = path.resolve(__dirname, '../fixtures/cline-history')
const databaseBase64Path = path.join(fixtureRoot, 'cline-3.0.54-sanitized-sessions.db.base64')
const messagesFixturePath = path.join(fixtureRoot, '1786606633588_XQOWO_cli.messages.json')
const nativeParentId = '1786606633588_XQOWO_cli'
const tempDirs: string[] = []

const createTempRoot = async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ow-cline-history-'))
  tempDirs.push(root)
  return realpath(root)
}

const createTestEnv = (workspaceFolder: string, home: string): NodeJS.ProcessEnv => ({
  __ONEWORKS_PROJECT_HOME_PROJECTS_DIR__: path.join(home, 'oneworks-projects'),
  __ONEWORKS_PROJECT_REAL_HOME__: home,
  __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: workspaceFolder,
  __ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__: workspaceFolder
})

const hashFile = async (filePath: string) => createHash('sha256').update(await readFile(filePath)).digest('hex')

const createReleasedFixture = async (root: string) => {
  const home = path.join(root, 'home')
  const dataRoot = path.join(home, '.cline', 'data')
  const databasePath = path.join(dataRoot, 'db', 'sessions.db')
  const messagesPath = path.join(dataRoot, 'fixtures', 'cline', `${nativeParentId}.messages.json`)
  await Promise.all([
    mkdir(path.dirname(databasePath), { recursive: true }),
    mkdir(path.dirname(messagesPath), { recursive: true })
  ])
  const databaseBase64 = (await readFile(databaseBase64Path, 'utf8')).trim()
  await Promise.all([
    writeFile(databasePath, Buffer.from(databaseBase64, 'base64')),
    writeFile(messagesPath, await readFile(messagesFixturePath))
  ])
  return {
    dataRoot: await realpath(dataRoot),
    databasePath: await realpath(databasePath),
    home: await realpath(home),
    messagesPath: await realpath(messagesPath)
  }
}

const writeMessages = async (
  filePath: string,
  sessionId: string,
  messages: unknown[]
) => {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(
    filePath,
    `${
      JSON.stringify(
        {
          version: 1,
          origin: { source: 'cli', mode: 'user', sessionId, version: '3.0.54' },
          agent: 'lead',
          sessionId,
          messages,
          system_prompt: '[sanitized]',
          updated_at: '2026-08-13T07:37:16.655Z'
        },
        null,
        2
      )
    }\n`,
    'utf8'
  )
}

const updateParentFixturePaths = (
  databasePath: string,
  workspace: string,
  messagesPath: string
) => {
  const database = new DatabaseSync(databasePath)
  database.prepare(`
    UPDATE sessions
    SET cwd = ?, workspace_root = ?, messages_path = ?
    WHERE session_id = ?
  `).run(workspace, workspace, messagesPath, nativeParentId)
  database.close()
}

const insertSession = (
  databasePath: string,
  params: {
    id: string
    isSubagent?: boolean
    messagesPath: string
    parentId?: string
    startedAt: string
    updatedAt: string
    workspace: string
  }
) => {
  const database = new DatabaseSync(databasePath)
  database.prepare(`
    INSERT INTO sessions (
      session_id, source, pid, started_at, status, status_lock, interactive, provider, model, cwd,
      workspace_root, enable_tools, enable_spawn, enable_teams, parent_session_id, is_subagent,
      transcript_path, hook_path, messages_path, updated_at
    ) VALUES (?, 'cli', 0, ?, 'idle', 10, 1, 'sanitized', 'sanitized-model', ?, ?, 1, 1, 0, ?, ?, '', '', ?, ?)
  `).run(
    params.id,
    params.startedAt,
    params.workspace,
    params.workspace,
    params.parentId ?? null,
    params.isSubagent === true ? 1 : 0,
    params.messagesPath,
    params.updatedAt
  )
  database.close()
}

const readImportedEvents = async (
  workspace: string,
  env: NodeJS.ProcessEnv,
  sessionId: string
) => {
  const runtimeRoot = resolveWorkspaceRuntimeStoreRoot(
    workspace,
    createWorkspaceRuntimeEnv(workspace, env)
  )
  const content = await readFile(path.join(runtimeRoot, 'sessions', sessionId, 'events.jsonl'), 'utf8')
  return content.trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
}

const createParentChildFixture = async (root: string) => {
  const fixture = await createReleasedFixture(root)
  const workspace = path.join(root, 'workspace')
  await mkdir(workspace, { recursive: true })
  const parentMessagesPath = path.join(fixture.dataRoot, 'sessions', `${nativeParentId}.messages.json`)
  await mkdir(path.dirname(parentMessagesPath), { recursive: true })
  await writeFile(parentMessagesPath, await readFile(messagesFixturePath))
  updateParentFixturePaths(fixture.databasePath, workspace, parentMessagesPath)
  const childId = '1786606634000_INCREMENTAL_CHILD_cli'
  const childMessagesPath = path.join(fixture.dataRoot, 'sessions', `${childId}.messages.json`)
  await writeMessages(childMessagesPath, childId, [
    { id: 'incremental-child-user', role: 'user', content: 'Incremental child', ts: 1786606634000 }
  ])
  insertSession(fixture.databasePath, {
    id: childId,
    isSubagent: true,
    messagesPath: childMessagesPath,
    parentId: nativeParentId,
    startedAt: '2026-08-13T07:37:14.000Z',
    updatedAt: '2026-08-13T07:37:17.000Z',
    workspace
  })
  return { ...fixture, childId, childMessagesPath, parentMessagesPath, workspace }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(root => rm(root, { force: true, recursive: true })))
})

describe('cline native history import', () => {
  it('imports the exact sanitized 3.0.54 fixture read-only and deduplicates repeat imports', async () => {
    const fixtureDatabaseBytes = Buffer.from((await readFile(databaseBase64Path, 'utf8')).trim(), 'base64')
    expect(createHash('sha256').update(fixtureDatabaseBytes).digest('hex')).toBe(
      '4c0644c5f815e96838f4e154ae6b4565902d961d42029b56fee695164737c395'
    )
    expect(await hashFile(messagesFixturePath)).toBe(
      '2403c0ba5734cabc7906f5eeb624ccad0b387b2c4e73c83a40ff877c7537a826'
    )
    const root = await createTempRoot()
    const fixture = await createReleasedFixture(root)
    const workspace = '/workspace/example'
    const env = createTestEnv(workspace, fixture.home)
    const hashesBefore = await Promise.all([
      hashFile(fixture.databasePath),
      hashFile(fixture.messagesPath)
    ])

    const preview = await previewNativeProjectHistory({
      adapters: ['cline'],
      cwd: workspace,
      env,
      homeDir: fixture.home
    })
    const imported = await importNativeProjectHistory({
      adapters: ['cline'],
      cwd: workspace,
      env,
      homeDir: fixture.home
    })
    const repeated = await importNativeProjectHistory({
      adapters: ['cline'],
      cwd: workspace,
      env,
      homeDir: fixture.home
    })
    const previewAfterImport = await previewNativeProjectHistory({
      adapters: ['cline'],
      cwd: workspace,
      env,
      homeDir: fixture.home
    })

    expect(preview).toEqual(expect.objectContaining({ matchedFiles: 1, scannedFiles: 1 }))
    expect(preview.adapters[0]!.candidates[0]).toEqual(expect.objectContaining({
      adapter: 'cline',
      fileSizeBytes: (await readFile(messagesFixturePath)).byteLength,
      isLarge: false,
      nativeSessionId: nativeParentId,
      sourcePath: fixture.messagesPath,
      title: 'SANITIZED_TURN_1: emit text, request the command tool, then finish.'
    }))
    expect(imported).toEqual(expect.objectContaining({
      importedEvents: 8,
      importedSessions: 1,
      matchedFiles: 1,
      scannedFiles: 1
    }))
    expect(imported.sessions[0]).toEqual(expect.objectContaining({
      adapter: 'cline',
      sourcePath: fixture.messagesPath
    }))
    expect(repeated).toEqual(expect.objectContaining({ importedEvents: 0, importedSessions: 0, matchedFiles: 0 }))
    expect(previewAfterImport.matchedFiles).toBe(0)

    const runtimeRoot = resolveWorkspaceRuntimeStoreRoot(workspace, createWorkspaceRuntimeEnv(workspace, env))
    const importedMeta = JSON.parse(
      await readFile(path.join(runtimeRoot, 'sessions', imported.sessions[0]!.sessionId, 'meta.json'), 'utf8')
    ) as { historyImport?: { nativeSessionId?: string } }
    expect(importedMeta.historyImport?.nativeSessionId).toBe(nativeParentId)
    const events = await readImportedEvents(workspace, env, imported.sessions[0]!.sessionId)
    const content = events.flatMap((event) => {
      const value = event.content
      return Array.isArray(value) ? value : []
    })
    expect(content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'tool_use', id: 'acp-spike-tool-call-1' }),
      expect.objectContaining({ type: 'tool_result', tool_use_id: 'acp-spike-tool-call-1' })
    ]))
    expect(await Promise.all([hashFile(fixture.databasePath), hashFile(fixture.messagesPath)])).toEqual(hashesBefore)
    expect(existsSync(`${fixture.databasePath}-wal`)).toBe(false)
    expect(existsSync(`${fixture.databasePath}-shm`)).toBe(false)
  })

  it('supports all-project and projectPaths filters with native parent/subagent linkage', async () => {
    const root = await createTempRoot()
    const fixture = await createReleasedFixture(root)
    const currentWorkspace = path.join(root, 'current')
    const selectedWorkspace = path.join(root, 'selected')
    const otherWorkspace = path.join(root, 'other')
    await Promise.all([
      mkdir(currentWorkspace, { recursive: true }),
      mkdir(selectedWorkspace, { recursive: true }),
      mkdir(otherWorkspace, { recursive: true })
    ])
    const parentMessagesPath = path.join(fixture.dataRoot, 'sessions', `${nativeParentId}.messages.json`)
    await mkdir(path.dirname(parentMessagesPath), { recursive: true })
    await writeFile(parentMessagesPath, await readFile(messagesFixturePath))
    updateParentFixturePaths(fixture.databasePath, selectedWorkspace, parentMessagesPath)

    const childId = '1786606634000_CHILD_cli'
    const childMessagesPath = path.join(fixture.dataRoot, 'sessions', `${childId}.messages.json`)
    await writeMessages(childMessagesPath, childId, [
      { id: 'child-user', role: 'user', content: [{ type: 'text', text: 'Child task' }], ts: 1786606634000 },
      {
        id: 'child-tool',
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'child-tool-use', name: 'read_file', input: { path: 'a.ts' } }],
        ts: 1786606634001
      },
      {
        id: 'child-image',
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'child-tool-use', rawOutput: '[image]', content: '[image]' }],
        ts: 1786606634002
      },
      { id: 'child-user', role: 'user', content: [{ type: 'text', text: 'duplicate' }], ts: 1786606634004 }
    ])
    insertSession(fixture.databasePath, {
      id: childId,
      isSubagent: true,
      messagesPath: childMessagesPath,
      parentId: nativeParentId,
      startedAt: '2026-08-13T07:37:14.000Z',
      updatedAt: '2026-08-13T07:37:17.000Z',
      workspace: selectedWorkspace
    })

    const otherId = '1786606635000_OTHER_cli'
    const otherMessagesPath = path.join(fixture.dataRoot, 'sessions', `${otherId}.messages.json`)
    await writeMessages(otherMessagesPath, otherId, [
      { id: 'other-user', role: 'user', content: [{ type: 'text', text: 'Other project' }], ts: 1786606635000 }
    ])
    insertSession(fixture.databasePath, {
      id: otherId,
      messagesPath: otherMessagesPath,
      startedAt: '2026-08-13T07:37:15.000Z',
      updatedAt: '2026-08-13T07:37:18.000Z',
      workspace: otherWorkspace
    })

    const env = createTestEnv(currentWorkspace, fixture.home)
    const userPreview = await previewNativeProjectHistory({
      adapters: ['cline'],
      cwd: currentWorkspace,
      env,
      homeDir: fixture.home,
      projectPaths: [selectedWorkspace],
      projectScope: 'all-projects',
      threadScope: 'user'
    })
    const subagentPreview = await previewNativeProjectHistory({
      adapters: ['cline'],
      cwd: currentWorkspace,
      env,
      homeDir: fixture.home,
      projectPaths: [selectedWorkspace],
      projectScope: 'all-projects',
      threadScope: 'subagent'
    })
    const subagentOnly = await importNativeProjectHistory({
      adapters: ['cline'],
      cwd: currentWorkspace,
      env,
      homeDir: fixture.home,
      projectPaths: [selectedWorkspace],
      projectScope: 'all-projects',
      threadScope: 'subagent'
    })
    expect(subagentOnly.importedSessions).toBe(1)
    const subagentRuntimeRoot = resolveWorkspaceRuntimeStoreRoot(
      selectedWorkspace,
      createWorkspaceRuntimeEnv(selectedWorkspace, env)
    )
    const subagentOnlyMeta = JSON.parse(
      await readFile(
        path.join(subagentRuntimeRoot, 'sessions', subagentOnly.sessions[0]!.sessionId, 'meta.json'),
        'utf8'
      )
    ) as Record<string, unknown>
    expect(subagentOnlyMeta.parentSessionId).toBeUndefined()
    await rm(subagentRuntimeRoot, { recursive: true })

    const imported = await importNativeProjectHistory({
      adapters: ['cline'],
      cwd: currentWorkspace,
      env,
      homeDir: fixture.home,
      projectPaths: [selectedWorkspace],
      projectScope: 'all-projects',
      threadScope: 'all'
    })

    expect(userPreview.adapters[0]!.candidates).toEqual([
      expect.objectContaining({ nativeSessionId: nativeParentId })
    ])
    expect(subagentPreview.adapters[0]!.candidates).toEqual([
      expect.objectContaining({ nativeSessionId: childId, threadSource: 'subagent' })
    ])
    expect(userPreview.adapters[0]!.projects).toEqual(expect.arrayContaining([
      { path: selectedWorkspace, sessionCount: 2 },
      { path: otherWorkspace, sessionCount: 1 }
    ]))
    expect(imported.importedSessions).toBe(2)
    expect(imported.sessions.map(session => session.sourcePath).sort()).toEqual([
      childMessagesPath,
      parentMessagesPath
    ].sort())

    const parent = imported.sessions.find(session => session.sourcePath === parentMessagesPath)!
    const child = imported.sessions.find(session => session.sourcePath === childMessagesPath)!
    const runtimeRoot = resolveWorkspaceRuntimeStoreRoot(
      selectedWorkspace,
      createWorkspaceRuntimeEnv(selectedWorkspace, env)
    )
    const childMeta = JSON.parse(
      await readFile(path.join(runtimeRoot, 'sessions', child.sessionId, 'meta.json'), 'utf8')
    ) as Record<string, unknown>
    expect(childMeta.parentSessionId).toBe(parent.sessionId)
    expect(existsSync(path.join(runtimeRoot, 'sessions', parent.sessionId, 'meta.json'))).toBe(true)
    const childEvents = await readImportedEvents(selectedWorkspace, env, child.sessionId)
    expect(childEvents).toHaveLength(3)
    expect(JSON.stringify(childEvents)).toContain('[unavailable native image output]')
    expect(JSON.stringify(childEvents)).not.toContain('"tool_use_id":"child-tool-use","content":"[image]"')
  })

  it('preserves parent navigation across parent-first and child-first incremental sourcePath imports', async () => {
    const parentFirstRoot = await createTempRoot()
    const parentFirst = await createParentChildFixture(parentFirstRoot)
    const parentFirstEnv = createTestEnv(parentFirst.workspace, parentFirst.home)
    const parentHashes = await Promise.all([
      hashFile(parentFirst.databasePath),
      hashFile(parentFirst.parentMessagesPath),
      hashFile(parentFirst.childMessagesPath)
    ])
    const importedParent = await importNativeProjectHistory({
      adapters: ['cline'],
      cwd: parentFirst.workspace,
      env: parentFirstEnv,
      homeDir: parentFirst.home,
      sourcePaths: [parentFirst.parentMessagesPath]
    })
    const importedChild = await importNativeProjectHistory({
      adapters: ['cline'],
      cwd: parentFirst.workspace,
      env: parentFirstEnv,
      homeDir: parentFirst.home,
      sourcePaths: [parentFirst.childMessagesPath],
      threadScope: 'subagent'
    })
    expect(importedParent.importedSessions).toBe(1)
    expect(importedChild.importedSessions).toBe(1)
    const parentFirstRuntimeRoot = resolveWorkspaceRuntimeStoreRoot(
      parentFirst.workspace,
      createWorkspaceRuntimeEnv(parentFirst.workspace, parentFirstEnv)
    )
    const parentFirstChildMeta = JSON.parse(
      await readFile(
        path.join(
          parentFirstRuntimeRoot,
          'sessions',
          importedChild.sessions[0]!.sessionId,
          'meta.json'
        ),
        'utf8'
      )
    ) as Record<string, unknown>
    expect(parentFirstChildMeta.parentSessionId).toBe(importedParent.sessions[0]!.sessionId)
    expect(existsSync(path.join(
      parentFirstRuntimeRoot,
      'sessions',
      String(parentFirstChildMeta.parentSessionId),
      'meta.json'
    ))).toBe(true)
    expect(
      await Promise.all([
        hashFile(parentFirst.databasePath),
        hashFile(parentFirst.parentMessagesPath),
        hashFile(parentFirst.childMessagesPath)
      ])
    ).toEqual(parentHashes)

    const crossRootFixture = await createParentChildFixture(await createTempRoot())
    const crossRootDatabase = new DatabaseSync(crossRootFixture.databasePath)
    crossRootDatabase.prepare(`
      UPDATE sessions SET cwd = ?, workspace_root = ? WHERE session_id = ?
    `).run(parentFirst.workspace, parentFirst.workspace, crossRootFixture.childId)
    crossRootDatabase.close()
    const crossRootChild = await importNativeProjectHistory({
      adapters: ['cline'],
      cwd: parentFirst.workspace,
      env: parentFirstEnv,
      homeDir: crossRootFixture.home,
      sourceDirs: { cline: [crossRootFixture.dataRoot] },
      sourcePaths: [crossRootFixture.childMessagesPath],
      threadScope: 'subagent'
    })
    const crossRootChildMeta = JSON.parse(
      await readFile(
        path.join(
          parentFirstRuntimeRoot,
          'sessions',
          crossRootChild.sessions[0]!.sessionId,
          'meta.json'
        ),
        'utf8'
      )
    ) as Record<string, unknown>
    expect(crossRootChildMeta.parentSessionId).toBeUndefined()

    const childFirstRoot = await createTempRoot()
    const childFirst = await createParentChildFixture(childFirstRoot)
    const childFirstEnv = createTestEnv(childFirst.workspace, childFirst.home)
    const childOnly = await importNativeProjectHistory({
      adapters: ['cline'],
      cwd: childFirst.workspace,
      env: childFirstEnv,
      homeDir: childFirst.home,
      sourcePaths: [childFirst.childMessagesPath],
      threadScope: 'subagent'
    })
    const childFirstRuntimeRoot = resolveWorkspaceRuntimeStoreRoot(
      childFirst.workspace,
      createWorkspaceRuntimeEnv(childFirst.workspace, childFirstEnv)
    )
    const childMetaPath = path.join(
      childFirstRuntimeRoot,
      'sessions',
      childOnly.sessions[0]!.sessionId,
      'meta.json'
    )
    const childBeforeParent = JSON.parse(await readFile(childMetaPath, 'utf8')) as {
      historyImport?: Record<string, unknown>
      parentSessionId?: string
    }
    expect(childBeforeParent.parentSessionId).toBeUndefined()
    expect(childBeforeParent.historyImport).toEqual(expect.objectContaining({
      nativeParentSessionId: nativeParentId,
      nativeSourceRoot: childFirst.dataRoot
    }))
    const parentLater = await importNativeProjectHistory({
      adapters: ['cline'],
      cwd: childFirst.workspace,
      env: childFirstEnv,
      homeDir: childFirst.home,
      sourcePaths: [childFirst.parentMessagesPath],
      threadScope: 'user'
    })
    const childAfterParent = JSON.parse(await readFile(childMetaPath, 'utf8')) as Record<string, unknown>
    expect(childAfterParent.parentSessionId).toBe(parentLater.sessions[0]!.sessionId)
    expect(existsSync(path.join(
      childFirstRuntimeRoot,
      'sessions',
      String(childAfterParent.parentSessionId),
      'meta.json'
    ))).toBe(true)
    const repeated = await importNativeProjectHistory({
      adapters: ['cline'],
      cwd: childFirst.workspace,
      env: childFirstEnv,
      homeDir: childFirst.home,
      sourcePaths: [childFirst.parentMessagesPath, childFirst.childMessagesPath]
    })
    expect(repeated).toEqual(expect.objectContaining({ importedEvents: 0, importedSessions: 0 }))
    expect((JSON.parse(await readFile(childMetaPath, 'utf8')) as Record<string, unknown>).parentSessionId).toBe(
      parentLater.sessions[0]!.sessionId
    )
  })

  it('keeps incremental children root-only when an imported parent belongs to another project', async () => {
    const fixture = await createParentChildFixture(await createTempRoot())
    const env = createTestEnv(fixture.workspace, fixture.home)
    const importedParent = await importNativeProjectHistory({
      adapters: ['cline'],
      cwd: fixture.workspace,
      env,
      homeDir: fixture.home,
      sourcePaths: [fixture.parentMessagesPath]
    })
    const runtimeRoot = resolveWorkspaceRuntimeStoreRoot(
      fixture.workspace,
      createWorkspaceRuntimeEnv(fixture.workspace, env)
    )
    const parentMetaPath = path.join(
      runtimeRoot,
      'sessions',
      importedParent.sessions[0]!.sessionId,
      'meta.json'
    )
    const parentMeta = JSON.parse(await readFile(parentMetaPath, 'utf8')) as {
      historyImport: Record<string, unknown>
    }
    parentMeta.historyImport.nativeCwd = path.join(fixture.workspace, 'different-project')
    await writeFile(parentMetaPath, `${JSON.stringify(parentMeta, null, 2)}\n`, 'utf8')

    const importedChild = await importNativeProjectHistory({
      adapters: ['cline'],
      cwd: fixture.workspace,
      env,
      homeDir: fixture.home,
      sourcePaths: [fixture.childMessagesPath],
      threadScope: 'subagent'
    })
    expect(importedChild.importedSessions).toBe(1)
    const childMeta = JSON.parse(
      await readFile(
        path.join(runtimeRoot, 'sessions', importedChild.sessions[0]!.sessionId, 'meta.json'),
        'utf8'
      )
    ) as Record<string, unknown>
    expect(childMeta.parentSessionId).toBeUndefined()
  })

  it('fails closed when durable imported parent identity is ambiguous', async () => {
    const fixture = await createParentChildFixture(await createTempRoot())
    const env = createTestEnv(fixture.workspace, fixture.home)
    const importedParent = await importNativeProjectHistory({
      adapters: ['cline'],
      cwd: fixture.workspace,
      env,
      homeDir: fixture.home,
      sourcePaths: [fixture.parentMessagesPath]
    })
    const runtimeRoot = resolveWorkspaceRuntimeStoreRoot(
      fixture.workspace,
      createWorkspaceRuntimeEnv(fixture.workspace, env)
    )
    const parentSessionId = importedParent.sessions[0]!.sessionId
    const duplicateSessionId = `${parentSessionId}-duplicate`
    const parentMeta = JSON.parse(
      await readFile(path.join(runtimeRoot, 'sessions', parentSessionId, 'meta.json'), 'utf8')
    ) as Record<string, unknown>
    const duplicateSessionDir = path.join(runtimeRoot, 'sessions', duplicateSessionId)
    await mkdir(duplicateSessionDir, { recursive: true })
    await writeFile(
      path.join(duplicateSessionDir, 'meta.json'),
      `${JSON.stringify({ ...parentMeta, sessionId: duplicateSessionId }, null, 2)}\n`,
      'utf8'
    )
    const indexPath = path.join(runtimeRoot, 'index.json')
    const index = JSON.parse(await readFile(indexPath, 'utf8')) as {
      sessions: Record<string, Record<string, unknown>>
    }
    index.sessions[duplicateSessionId] = {
      ...index.sessions[parentSessionId],
      storePath: path.join('sessions', duplicateSessionId)
    }
    await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8')

    const importedChild = await importNativeProjectHistory({
      adapters: ['cline'],
      cwd: fixture.workspace,
      env,
      homeDir: fixture.home,
      sourcePaths: [fixture.childMessagesPath],
      threadScope: 'subagent'
    })
    expect(importedChild).toEqual(expect.objectContaining({ importedEvents: 0, importedSessions: 0 }))
    expect(existsSync(path.join(
      runtimeRoot,
      'sessions',
      importedChild.sessions[0]?.sessionId ?? 'missing-child',
      'meta.json'
    ))).toBe(false)
  })

  it('fails closed for duplicate native ids across different Cline source roots', async () => {
    const firstRoot = await createTempRoot()
    const secondRoot = await createTempRoot()
    const first = await createReleasedFixture(firstRoot)
    const second = await createReleasedFixture(secondRoot)
    const workspace = '/workspace/example'
    const env = createTestEnv(workspace, first.home)
    const preview = await previewNativeProjectHistory({
      adapters: ['cline'],
      cwd: workspace,
      env,
      homeDir: first.home,
      sourceDirs: { cline: [first.dataRoot, second.dataRoot] }
    })
    const imported = await importNativeProjectHistory({
      adapters: ['cline'],
      cwd: workspace,
      env,
      homeDir: first.home,
      sourceDirs: { cline: [first.dataRoot, second.dataRoot] }
    })
    expect(preview).toEqual(expect.objectContaining({ matchedFiles: 0, scannedFiles: 0 }))
    expect(preview.adapters[0]!.diagnostics).toEqual(expect.arrayContaining([
      expect.stringContaining('Ambiguous Cline native session id across data roots')
    ]))
    expect(imported).toEqual(expect.objectContaining({ importedEvents: 0, importedSessions: 0, scannedFiles: 0 }))
  })

  it('fails closed for unsafe paths, size limits, sidecars, corrupt databases, and schema drift', async () => {
    const root = await createTempRoot()
    const fixture = await createReleasedFixture(root)
    const workspace = '/workspace/example'
    const env = createTestEnv(workspace, fixture.home)

    const oversized = await importNativeProjectHistory({
      adapters: ['cline'],
      cwd: workspace,
      env,
      homeDir: fixture.home,
      maxFileSizeBytes: 16
    })
    expect(oversized.importedSessions).toBe(0)
    const oversizedPreview = await previewNativeProjectHistory({
      adapters: ['cline'],
      cwd: workspace,
      env,
      homeDir: fixture.home,
      maxFileSizeBytes: 16
    })
    expect(oversizedPreview).toEqual(expect.objectContaining({ matchedFiles: 0, scannedFiles: 0 }))

    await Promise.all([
      writeFile(`${fixture.databasePath}-wal`, 'wal-sentinel'),
      writeFile(`${fixture.databasePath}-shm`, 'shm-sentinel')
    ])
    const sidecarHashes = await Promise.all([
      hashFile(`${fixture.databasePath}-wal`),
      hashFile(`${fixture.databasePath}-shm`)
    ])
    const withSidecar = await previewNativeProjectHistory({
      adapters: ['cline'],
      cwd: workspace,
      env,
      homeDir: fixture.home
    })
    expect(withSidecar.scannedFiles).toBe(0)
    expect(
      await Promise.all([
        hashFile(`${fixture.databasePath}-wal`),
        hashFile(`${fixture.databasePath}-shm`)
      ])
    ).toEqual(sidecarHashes)
    await Promise.all([
      rm(`${fixture.databasePath}-wal`),
      rm(`${fixture.databasePath}-shm`)
    ])

    const outsideMessages = path.join(root, 'outside.messages.json')
    await writeFile(outsideMessages, await readFile(messagesFixturePath))
    const database = new DatabaseSync(fixture.databasePath)
    database.prepare('UPDATE sessions SET messages_path = ? WHERE session_id = ?')
      .run('../outside.messages.json', nativeParentId)
    database.close()
    const traversal = await previewNativeProjectHistory({
      adapters: ['cline'],
      cwd: workspace,
      env,
      homeDir: fixture.home
    })
    expect(traversal.scannedFiles).toBe(0)

    const symlinkPath = path.join(fixture.dataRoot, 'fixtures', 'cline', 'linked.messages.json')
    await symlink(outsideMessages, symlinkPath)
    const symlinkDatabase = new DatabaseSync(fixture.databasePath)
    symlinkDatabase.prepare('UPDATE sessions SET messages_path = ? WHERE session_id = ?')
      .run(symlinkPath, nativeParentId)
    symlinkDatabase.close()
    const symlinked = await previewNativeProjectHistory({
      adapters: ['cline'],
      cwd: workspace,
      env,
      homeDir: fixture.home
    })
    expect(symlinked.scannedFiles).toBe(0)

    const malformedMessagesPath = path.join(fixture.dataRoot, 'sessions', 'malformed.messages.json')
    await mkdir(path.dirname(malformedMessagesPath), { recursive: true })
    await writeFile(malformedMessagesPath, '{malformed')
    const malformedDatabase = new DatabaseSync(fixture.databasePath)
    malformedDatabase.prepare('UPDATE sessions SET messages_path = ? WHERE session_id = ?')
      .run(malformedMessagesPath, nativeParentId)
    malformedDatabase.close()
    const malformedMessages = await previewNativeProjectHistory({
      adapters: ['cline'],
      cwd: workspace,
      env,
      homeDir: fixture.home
    })
    expect(malformedMessages.scannedFiles).toBe(0)

    const linkedRoot = path.join(root, 'linked-database')
    await mkdir(path.join(linkedRoot, 'db'), { recursive: true })
    await symlink(fixture.databasePath, path.join(linkedRoot, 'db', 'sessions.db'))
    const linkedDatabase = await previewNativeProjectHistory({
      adapters: ['cline'],
      cwd: workspace,
      env,
      homeDir: fixture.home,
      sourceDirs: { cline: [linkedRoot] }
    })
    expect(linkedDatabase.scannedFiles).toBe(0)

    const driftRoot = path.join(root, 'drift')
    const driftDatabasePath = path.join(driftRoot, 'db', 'sessions.db')
    await mkdir(path.dirname(driftDatabasePath), { recursive: true })
    const driftDatabase = new DatabaseSync(driftDatabasePath)
    driftDatabase.exec('CREATE TABLE sessions (session_id TEXT PRIMARY KEY)')
    driftDatabase.close()
    const schemaDrift = await previewNativeProjectHistory({
      adapters: ['cline'],
      cwd: workspace,
      env,
      homeDir: fixture.home,
      sourceDirs: { cline: [driftRoot] }
    })
    expect(schemaDrift.scannedFiles).toBe(0)

    const corruptRoot = path.join(root, 'corrupt')
    const corruptDatabasePath = path.join(corruptRoot, 'db', 'sessions.db')
    await mkdir(path.dirname(corruptDatabasePath), { recursive: true })
    await writeFile(corruptDatabasePath, 'not sqlite')
    const corrupt = await previewNativeProjectHistory({
      adapters: ['cline'],
      cwd: workspace,
      env,
      homeDir: fixture.home,
      sourceDirs: { cline: [corruptRoot] }
    })
    expect(corrupt.scannedFiles).toBe(0)

    const oversizedDatabaseRoot = path.join(root, 'oversized-database')
    const oversizedDatabasePath = path.join(oversizedDatabaseRoot, 'db', 'sessions.db')
    await mkdir(path.dirname(oversizedDatabasePath), { recursive: true })
    await writeFile(oversizedDatabasePath, '')
    await truncate(oversizedDatabasePath, CLINE_HISTORY_DATABASE_MAX_BYTES + 1)
    const oversizedDatabase = await previewNativeProjectHistory({
      adapters: ['cline'],
      cwd: workspace,
      env,
      homeDir: fixture.home,
      sourceDirs: { cline: [oversizedDatabaseRoot] }
    })
    expect(oversizedDatabase.scannedFiles).toBe(0)
  })

  it('gates the exact released messages discriminator without partial import', async () => {
    const root = await createTempRoot()
    const fixture = await createReleasedFixture(root)
    const workspace = '/workspace/example'
    const env = createTestEnv(workspace, fixture.home)
    const valid = JSON.parse(await readFile(fixture.messagesPath, 'utf8')) as Record<string, unknown>
    const invalidArtifacts = [
      { ...valid, version: 2 },
      Object.fromEntries(Object.entries(valid).filter(([key]) => key !== 'version')),
      { ...valid, origin: { ...(valid.origin as object), version: '3.0.55' } },
      { ...valid, origin: { ...(valid.origin as object), source: 'extension' } },
      Object.fromEntries(Object.entries(valid).filter(([key]) => key !== 'agent')),
      { ...valid, sessionId: 'different-session' }
    ]

    for (const artifact of invalidArtifacts) {
      await writeFile(fixture.messagesPath, `${JSON.stringify(artifact)}\n`)
      const preview = await previewNativeProjectHistory({
        adapters: ['cline'],
        cwd: workspace,
        env,
        homeDir: fixture.home
      })
      const imported = await importNativeProjectHistory({
        adapters: ['cline'],
        cwd: workspace,
        env,
        homeDir: fixture.home
      })
      expect(preview).toEqual(expect.objectContaining({ matchedFiles: 0, scannedFiles: 0 }))
      expect(preview.adapters[0]!.diagnostics).not.toHaveLength(0)
      expect(imported).toEqual(expect.objectContaining({ importedEvents: 0, importedSessions: 0 }))
    }
  })

  it.each(
    [
      ['missing', [
        { id: 'result', role: 'user', content: [{ type: 'tool_result', tool_use_id: 'missing', content: 'x' }], ts: 1 }
      ]],
      ['future', [
        {
          id: 'result',
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'future-tool', content: 'x' }],
          ts: 1
        },
        {
          id: 'tool',
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'future-tool', name: 'read_file', input: {} }],
          ts: 2
        }
      ]],
      ['duplicate-tool-use', [
        {
          id: 'tool-a',
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'duplicate-tool', name: 'read_file', input: {} }],
          ts: 1
        },
        {
          id: 'tool-b',
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'duplicate-tool', name: 'read_file', input: {} }],
          ts: 2
        }
      ]],
      ['dropped-tool-use', [
        { id: 'duplicate-message', role: 'user', content: 'retained message', ts: 1 },
        {
          id: 'result',
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'dropped-tool', content: 'x' }],
          ts: 2
        },
        {
          id: 'duplicate-message',
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'dropped-tool', name: 'read_file', input: {} }],
          ts: 3
        }
      ]],
      ['mismatched', [
        {
          id: 'tool',
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'actual-tool', name: 'read_file', input: {} }],
          ts: 1
        },
        {
          id: 'result',
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'different-tool', content: 'x' }],
          ts: 2
        }
      ]],
      ['duplicate-result', [
        {
          id: 'tool',
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'single-tool', name: 'read_file', input: {} }],
          ts: 1
        },
        {
          id: 'result-a',
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'single-tool', content: 'first' }],
          ts: 2
        },
        {
          id: 'result-b',
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'single-tool', content: 'second' }],
          ts: 3
        }
      ]]
    ] as const
  )('fails closed for %s native tool alignment', async (_caseName, messages) => {
    const sourceHashBefore = await hashFile(messagesFixturePath)
    const root = await createTempRoot()
    const fixture = await createReleasedFixture(root)
    const workspace = '/workspace/example'
    const env = createTestEnv(workspace, fixture.home)
    await writeMessages(fixture.messagesPath, nativeParentId, [...messages])
    const preview = await previewNativeProjectHistory({
      adapters: ['cline'],
      cwd: workspace,
      env,
      homeDir: fixture.home
    })
    const imported = await importNativeProjectHistory({
      adapters: ['cline'],
      cwd: workspace,
      env,
      homeDir: fixture.home
    })
    expect(preview).toEqual(expect.objectContaining({ matchedFiles: 0, scannedFiles: 0 }))
    expect(preview.adapters[0]!.diagnostics).not.toHaveLength(0)
    expect(imported).toEqual(expect.objectContaining({ importedEvents: 0, importedSessions: 0 }))
    expect(await hashFile(messagesFixturePath)).toBe(sourceHashBefore)
  })

  it('keeps every released fixture free of captured prompts, private paths, and credential shapes', async () => {
    const fixtureFiles = (await readdir(fixtureRoot)).sort()
    expect(fixtureFiles).toEqual([
      '1786606633588_XQOWO_cli.messages.json',
      'README.md',
      'cline-3.0.54-sanitized-sessions.db.base64'
    ])
    const releasedFixtureText = (await Promise.all(fixtureFiles.map(async (name) => {
      const content = await readFile(path.join(fixtureRoot, name), 'utf8')
      return name.endsWith('.base64') ? Buffer.from(content.trim(), 'base64').toString('utf8') : content
    }))).join('\n')
    const messages = await readFile(messagesFixturePath, 'utf8')
    expect(JSON.parse(messages)).toEqual(expect.objectContaining({ system_prompt: '[sanitized]' }))
    expect(releasedFixtureText).not.toMatch(
      /\/Users\/|\\Users\\|AKIA[A-Z0-9]{16}|\bsk-[\w-]{8,}|Bearer\s+[\w.-]{8,}/u
    )
    expect(releasedFixtureText).not.toContain('You are Cline, an AI coding agent')
  })

  it('accepts optional-column drift but rejects missing required session columns', async () => {
    const root = await createTempRoot()
    const workspace = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    const dataRoot = path.join(home, '.cline', 'data')
    const databasePath = path.join(dataRoot, 'db', 'sessions.db')
    const messagesPath = path.join(dataRoot, 'sessions', 'minimal.messages.json')
    await Promise.all([
      mkdir(workspace, { recursive: true }),
      mkdir(path.dirname(databasePath), { recursive: true })
    ])
    await writeMessages(messagesPath, 'minimal-session', [
      { id: 'minimal-user', role: 'user', content: 'Minimal dynamic schema', ts: 1786606635000 }
    ])
    const database = new DatabaseSync(databasePath)
    database.exec(`
      CREATE TABLE sessions (
        session_id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL,
        cwd TEXT NOT NULL,
        messages_path TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `)
    database.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?)').run(
      'minimal-session',
      '2026-08-13T07:37:15.000Z',
      workspace,
      messagesPath,
      '2026-08-13T07:37:18.000Z'
    )
    database.close()

    const preview = await previewNativeProjectHistory({
      adapters: ['cline'],
      cwd: workspace,
      env: createTestEnv(workspace, home),
      homeDir: home
    })
    expect(preview).toEqual(expect.objectContaining({ matchedFiles: 1, scannedFiles: 1 }))
    expect(preview.adapters[0]!.candidates[0]).toEqual(expect.objectContaining({
      nativeSessionId: 'minimal-session',
      title: 'Minimal dynamic schema'
    }))
  })

  it('fails closed while the sessions database is exclusively locked', async () => {
    const root = await createTempRoot()
    const fixture = await createReleasedFixture(root)
    const workspace = '/workspace/example'
    const env = createTestEnv(workspace, fixture.home)
    const lock = new DatabaseSync(fixture.databasePath)
    lock.exec('BEGIN EXCLUSIVE')
    try {
      const preview = await previewNativeProjectHistory({
        adapters: ['cline'],
        cwd: workspace,
        env,
        homeDir: fixture.home
      })
      expect(preview.scannedFiles).toBe(0)
    } finally {
      lock.exec('ROLLBACK')
      lock.close()
    }
  })
})
