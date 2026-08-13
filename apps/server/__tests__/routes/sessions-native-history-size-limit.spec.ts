import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, symlink, truncate, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { getDb } from '#~/db/index.js'
import { sessionsRouter } from '#~/routes/sessions.js'
import { rememberLauncherWorkspaces } from '#~/services/launcher/manager.js'
import { DEFAULT_NATIVE_HISTORY_IMPORT_MAX_FILE_SIZE_BYTES } from '#~/services/runtime-store/history-import.js'

const { scanAndReplayMock } = vi.hoisted(() => ({
  scanAndReplayMock: vi.fn()
}))

vi.mock('#~/db/index.js', () => ({
  getDb: vi.fn()
}))

vi.mock('#~/services/launcher/manager.js', () => ({
  rememberLauncherWorkspaces: vi.fn()
}))

vi.mock('#~/services/runtime-store/watcher.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#~/services/runtime-store/watcher.js')>()
  return {
    ...actual,
    getRuntimeStoreWatcher: () => ({ scanAndReplay: scanAndReplayMock })
  }
})

const tempDirs: string[] = []

const findRouteHandler = (pathName: string, method: string) => {
  vi.mocked(getDb).mockReturnValue({} as never)
  const layer = sessionsRouter().stack.find(item => (
    item.path === pathName && item.methods.includes(method)
  ))
  if (layer == null) throw new Error(`Missing route ${method} ${pathName}`)
  const handler = layer.stack.at(-1)
  if (handler == null) throw new Error(`Missing handler ${method} ${pathName}`)
  return handler
}

const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex')

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

describe('sessions native history public size limit', () => {
  it('enforces the server default before parsing and continues with other Qwen candidates', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ow-sessions-qwen-history-route-'))
    tempDirs.push(root)
    const workspace = process.cwd()
    const home = path.join(root, 'home')
    const runtimeDir = path.join(root, 'qwen-runtime')
    const chatsDir = path.join(runtimeDir, 'projects', '-fixture', 'chats')
    const projectHome = path.join(root, 'project-home')
    const oversizedPath = path.join(chatsDir, 'oversized-session.jsonl')
    const validPath = path.join(chatsDir, 'valid-session.jsonl')
    await mkdir(chatsDir, { recursive: true })

    const qwenRecord = (sessionId: string) => ({
      uuid: `${sessionId}-record`,
      parentUuid: null,
      sessionId,
      timestamp: '2026-08-13T07:50:15.529Z',
      type: 'user',
      provenance: 'real_user',
      cwd: workspace,
      version: '0.21.11',
      message: { role: 'user', parts: [{ text: `route ${sessionId}` }] }
    })
    await writeFile(oversizedPath, `${JSON.stringify(qwenRecord('oversized-session'))}\n`, 'utf8')
    await truncate(oversizedPath, DEFAULT_NATIVE_HISTORY_IMPORT_MAX_FILE_SIZE_BYTES + 1)
    await writeFile(validPath, `${JSON.stringify(qwenRecord('valid-session'))}\n`, 'utf8')
    const validBytes = await readFile(validPath)
    const validHash = sha256(validBytes)
    const oversizedSize = (await stat(oversizedPath)).size

    vi.stubEnv('HOME', home)
    vi.stubEnv('__ONEWORKS_PROJECT_REAL_HOME__', home)
    vi.stubEnv('__ONEWORKS_PROJECT_HOME_PROJECT_DIR__', projectHome)
    vi.stubEnv('__ONEWORKS_PROJECT_WORKSPACE_FOLDER__', workspace)
    vi.stubEnv('__ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__', workspace)
    vi.stubEnv('QWEN_RUNTIME_DIR', runtimeDir)

    const requestBody = {
      adapters: ['qwen-code'],
      sourcePaths: [oversizedPath, validPath]
    }
    const previewCtx = { request: { body: requestBody }, body: undefined as unknown }
    await findRouteHandler('/native-history-import/preview', 'POST')(previewCtx as never, async () => undefined)

    expect(previewCtx.body).toEqual(expect.objectContaining({
      aggregateLimitedBytes: 0,
      aggregateLimitedFiles: 0,
      largeFiles: 1,
      largestFileBytes: oversizedSize,
      matchedFiles: 1,
      maxFileSizeBytes: DEFAULT_NATIVE_HISTORY_IMPORT_MAX_FILE_SIZE_BYTES,
      perFileLimitedBytes: oversizedSize,
      perFileLimitedFiles: 1,
      rejectedFiles: 0,
      scannedFiles: 2,
      sizeLimitedBytes: oversizedSize,
      sizeLimitedFiles: 1,
      totalBytes: oversizedSize + validBytes.byteLength
    }))
    expect((previewCtx.body as any).adapters[0].candidates).toEqual([
      expect.objectContaining({
        fileSizeBytes: validBytes.byteLength,
        isLarge: false,
        nativeSessionId: 'valid-session',
        sourcePath: validPath
      })
    ])

    const importCtx = { request: { body: requestBody }, body: undefined as unknown }
    await findRouteHandler('/native-history-import/run', 'POST')(importCtx as never, async () => undefined)

    expect(importCtx.body).toEqual(expect.objectContaining({
      aggregateLimitedBytes: 0,
      aggregateLimitedFiles: 0,
      importedSessions: 1,
      matchedFiles: 1,
      perFileLimitedBytes: oversizedSize,
      perFileLimitedFiles: 1,
      rejectedFiles: 0,
      scannedFiles: 2,
      sizeLimitedBytes: oversizedSize,
      sizeLimitedFiles: 1
    }))
    expect(scanAndReplayMock).toHaveBeenCalledTimes(1)
    expect(rememberLauncherWorkspaces).toHaveBeenCalledWith([workspace])
    expect(sha256(await readFile(validPath))).toBe(validHash)
    expect((await stat(oversizedPath)).size).toBe(oversizedSize)
  })

  it('reports aggregate exhaustion for a small file and continues a later bounded public-route candidate', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ow-sessions-qwen-history-aggregate-route-'))
    tempDirs.push(root)
    const workspace = process.cwd()
    const home = path.join(root, 'home')
    const runtimeDir = path.join(root, 'qwen-runtime')
    const chatsDir = path.join(runtimeDir, 'projects', '-fixture', 'chats')
    const projectHome = path.join(root, 'project-home')
    await mkdir(chatsDir, { recursive: true })

    const qwenLine = (sessionId: string, message: string) =>
      JSON.stringify({
        cwd: workspace,
        message: { parts: [{ text: message }], role: 'user' },
        parentUuid: null,
        provenance: 'real_user',
        sessionId,
        timestamp: '2026-08-13T07:50:15.529Z',
        type: 'user',
        uuid: `${sessionId}-record`,
        version: '0.21.11'
      })
    const writePaddedHistory = async (filePath: string, sessionId: string, size: number) => {
      const line = Buffer.from(`${qwenLine(sessionId, `route ${sessionId}`)}\n`)
      expect(line.byteLength).toBeLessThan(size)
      await writeFile(filePath, Buffer.concat([line, Buffer.alloc(size - line.byteLength, 0x20)]))
    }
    const hardLimit = DEFAULT_NATIVE_HISTORY_IMPORT_MAX_FILE_SIZE_BYTES
    const firstPath = path.join(chatsDir, 'aggregate-first.jsonl')
    const skippedPath = path.join(chatsDir, 'aggregate-skipped.jsonl')
    const continuedPath = path.join(chatsDir, 'aggregate-continued.jsonl')
    const firstBytes = hardLimit - 2048
    const skippedBytes = 4096
    const continuedBytes = 1024
    await writePaddedHistory(firstPath, 'aggregate-first', firstBytes)
    await writePaddedHistory(skippedPath, 'aggregate-skipped', skippedBytes)
    await writePaddedHistory(continuedPath, 'aggregate-continued', continuedBytes)
    await utimes(firstPath, 300, 300)
    await utimes(skippedPath, 200, 200)
    await utimes(continuedPath, 100, 100)

    vi.stubEnv('HOME', home)
    vi.stubEnv('__ONEWORKS_PROJECT_REAL_HOME__', home)
    vi.stubEnv('__ONEWORKS_PROJECT_HOME_PROJECT_DIR__', projectHome)
    vi.stubEnv('__ONEWORKS_PROJECT_WORKSPACE_FOLDER__', workspace)
    vi.stubEnv('__ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__', workspace)
    vi.stubEnv('QWEN_RUNTIME_DIR', runtimeDir)
    const requestBody = {
      adapters: ['qwen-code'],
      sourcePaths: [firstPath, skippedPath, continuedPath]
    }

    const previewCtx = { request: { body: requestBody }, body: undefined as unknown }
    await findRouteHandler('/native-history-import/preview', 'POST')(
      previewCtx as never,
      async () => undefined
    )
    expect(previewCtx.body).toEqual(expect.objectContaining({
      aggregateLimitedBytes: skippedBytes,
      aggregateLimitedFiles: 1,
      matchedFiles: 2,
      perFileLimitedBytes: 0,
      perFileLimitedFiles: 0,
      rejectedFiles: 0,
      sizeLimitedBytes: skippedBytes,
      sizeLimitedFiles: 1
    }))
    expect((previewCtx.body as any).adapters[0].candidates).toEqual([
      expect.objectContaining({ nativeSessionId: 'aggregate-first' }),
      expect.objectContaining({ nativeSessionId: 'aggregate-continued' })
    ])

    const importCtx = { request: { body: requestBody }, body: undefined as unknown }
    await findRouteHandler('/native-history-import/run', 'POST')(
      importCtx as never,
      async () => undefined
    )
    expect(importCtx.body).toEqual(expect.objectContaining({
      aggregateLimitedBytes: skippedBytes,
      aggregateLimitedFiles: 1,
      importedSessions: 2,
      matchedFiles: 2,
      perFileLimitedFiles: 0,
      rejectedFiles: 0
    }))
    expect((await stat(firstPath)).size).toBe(firstBytes)
    expect((await stat(skippedPath)).size).toBe(skippedBytes)
    expect((await stat(continuedPath)).size).toBe(continuedBytes)
  })

  it('threads rejected malformed and symlink diagnostics through public preview and run routes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ow-sessions-qwen-history-rejected-route-'))
    tempDirs.push(root)
    const workspace = process.cwd()
    const home = path.join(root, 'home')
    const runtimeDir = path.join(root, 'qwen-runtime')
    const chatsDir = path.join(runtimeDir, 'projects', '-fixture', 'chats')
    const malformedPath = path.join(chatsDir, 'malformed.jsonl')
    const symlinkPath = path.join(chatsDir, 'unsafe-link.jsonl')
    const outsidePath = path.join(root, 'outside.jsonl')
    await mkdir(chatsDir, { recursive: true })
    const record = JSON.stringify({
      cwd: workspace,
      message: { parts: [{ text: 'must not import' }], role: 'user' },
      parentUuid: null,
      provenance: 'real_user',
      sessionId: 'rejected-route',
      timestamp: '2026-08-13T07:50:15.529Z',
      type: 'user',
      uuid: 'rejected-route-record',
      version: '0.21.11'
    })
    await writeFile(malformedPath, `${record}\n{not-json}\n`, 'utf8')
    await writeFile(outsidePath, `${record}\n`, 'utf8')
    await symlink(outsidePath, symlinkPath)
    const malformedHash = sha256(await readFile(malformedPath))
    const outsideHash = sha256(await readFile(outsidePath))

    vi.stubEnv('HOME', home)
    vi.stubEnv('__ONEWORKS_PROJECT_REAL_HOME__', home)
    vi.stubEnv('__ONEWORKS_PROJECT_WORKSPACE_FOLDER__', workspace)
    vi.stubEnv('__ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__', workspace)
    vi.stubEnv('QWEN_RUNTIME_DIR', runtimeDir)
    const requestBody = {
      adapters: ['qwen-code'],
      sourcePaths: [malformedPath, symlinkPath]
    }

    for (
      const [routePath, resultField] of [
        ['/native-history-import/preview', 'matchedFiles'],
        ['/native-history-import/run', 'importedSessions']
      ] as const
    ) {
      const ctx = { request: { body: requestBody }, body: undefined as unknown }
      await findRouteHandler(routePath, 'POST')(ctx as never, async () => undefined)
      expect(ctx.body).toEqual(expect.objectContaining({
        aggregateLimitedFiles: 0,
        [resultField]: 0,
        perFileLimitedFiles: 0,
        rejectedFiles: 2,
        scannedFiles: 2,
        sizeLimitedFiles: 0
      }))
    }
    expect(sha256(await readFile(malformedPath))).toBe(malformedHash)
    expect(sha256(await readFile(outsidePath))).toBe(outsideHash)
  })
})
