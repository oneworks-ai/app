import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fromId: vi.fn(),
  getPath: vi.fn(),
  partition: { on: vi.fn() },
  fromPartition: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: mocks.getPath },
  session: { fromPartition: mocks.fromPartition },
  shell: { openPath: vi.fn(async () => ''), showItemInFolder: vi.fn() },
  webContents: { fromId: mocks.fromId }
}))

const {
  installBrowserActivityDownloadTracking,
  listBrowserHistory,
  listBrowserDownloads,
  openBrowserDownload,
  recordBrowserHistory,
  revealBrowserDownload,
  registerInteractionPanelWebviewScope
} = await import('../src/main/browser-activity.js')

describe('desktop browser activity filesystem scope identity', () => {
  let userData = ''

  beforeEach(async () => {
    userData = await mkdtemp(path.join(tmpdir(), 'oneworks-browser-activity-path-'))
    mocks.getPath.mockReturnValue(userData)
    mocks.fromPartition.mockReturnValue(mocks.partition)
  })

  afterEach(async () => {
    await rm(userData, { force: true, recursive: true })
    vi.clearAllMocks()
  })

  it('stores adjacent whitespace-distinct project keys as separate records', async () => {
    const exactProject = path.join(userData, 'project ')
    const adjacentProject = path.join(userData, 'project')

    await recordBrowserHistory({ projectKey: exactProject, title: 'Exact', url: 'https://exact.test/' })
    await recordBrowserHistory({ projectKey: adjacentProject, title: 'Adjacent', url: 'https://adjacent.test/' })

    const records = await listBrowserHistory({ scope: 'project' })
    expect(records).toHaveLength(2)
    expect(records.map(record => record.projectKey)).toEqual(expect.arrayContaining([exactProject, adjacentProject]))
    expect(new Set(records.map(record => record.id)).size).toBe(2)
  })

  it('registers a webview against the exact workspace and project paths', () => {
    const once = vi.fn()
    mocks.fromId.mockReturnValue({
      getType: () => 'webview',
      hostWebContents: { id: 7 },
      once,
      session: mocks.partition
    })
    const workspaceFolder = path.join(userData, 'workspace ')

    const scope = registerInteractionPanelWebviewScope({
      hostWebContentsId: 7,
      projectKey: workspaceFolder,
      webContentsId: 9,
      workspaceFolder
    })

    expect(scope.projectKey).toBe(workspaceFolder)
    expect(scope.workspaceFolder).toBe(workspaceFolder)
    expect(scope.workspaceFolder).not.toBe(workspaceFolder.trim())
  })

  it('persists exact DownloadItem paths through progress, completion, open, and reveal', async () => {
    const listeners = new Map<string, (...args: unknown[]) => void>()
    mocks.partition.on = vi.fn((_event: string, callback: (...args: unknown[]) => void) =>
      listeners.set('will-download', callback)
    )
    const exactPath = path.join(userData, 'report.pdf ')
    const adjacentPath = path.join(userData, 'report.pdf')
    const item = {
      getFilename: () => 'report.pdf ',
      getMimeType: () => 'application/pdf',
      getReceivedBytes: () => 3,
      getSavePath: () => exactPath,
      getTotalBytes: () => 5,
      getURL: () => 'https://downloads.example/report.pdf',
      getURLChain: () => ['https://downloads.example/report.pdf'],
      on: vi.fn((event: string, callback: (...args: unknown[]) => void) => listeners.set(event, callback)),
      once: vi.fn((event: string, callback: (...args: unknown[]) => void) => listeners.set(event, callback))
    }
    const owner = { id: 17 }

    installBrowserActivityDownloadTracking()
    listeners.get('will-download')?.({}, item, owner)
    listeners.get('updated')?.({}, 'progressing')
    listeners.get('done')?.({}, 'completed')
    await new Promise(resolve => setTimeout(resolve, 0))
    const [record] = await listBrowserDownloads()

    expect(record?.filePath).toBe(exactPath)
    expect(record?.filePath).not.toBe(adjacentPath)
    await openBrowserDownload(record?.id)
    await revealBrowserDownload(record?.id)
    const electron = await import('electron')
    expect(electron.shell.openPath).toHaveBeenCalledWith(exactPath)
    expect(electron.shell.showItemInFolder).toHaveBeenCalledWith(exactPath)
  })
})
