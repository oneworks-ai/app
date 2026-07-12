/* eslint-disable max-lines -- browser activity keeps history, downloads, and webview scope tracking together. */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { app, session, shell, webContents as electronWebContents } from 'electron'
import type { DownloadItem, WebContents } from 'electron'

export const interactionPanelWebviewPartition = 'persist:oneworks-interaction-panel'

type BrowserActivityScopeFilter = 'all' | 'project' | 'session'
type BrowserDownloadState = 'cancelled' | 'completed' | 'interrupted' | 'progressing'

export interface BrowserActivityListOptions {
  query?: string
  scope?: BrowserActivityScopeFilter
}

export interface BrowserActivityScopeInput {
  projectKey?: string
  sessionKey?: string
}

export interface InteractionPanelWebviewScope extends BrowserActivityScopeInput {
  controlRequestId?: string
  hostWebContentsId?: number
  panelPageId?: string
  registeredAt: number
  webContentsId: number
  workspaceFolder?: string
}

export interface BrowserHistoryRecord extends BrowserActivityScopeInput {
  faviconUrl?: string
  firstVisitedAt: string
  id: string
  lastVisitedAt: string
  title?: string
  url: string
  visitCount: number
}

export interface BrowserHistoryRecordInput extends BrowserActivityScopeInput {
  faviconUrl?: string
  incrementVisit?: boolean
  title?: string
  url?: string
}

export interface BrowserDownloadRecord extends BrowserActivityScopeInput {
  completedAt?: string
  fileName: string
  filePath?: string
  id: string
  mimeType?: string
  receivedBytes: number
  startedAt: string
  state: BrowserDownloadState
  totalBytes: number
  updatedAt: string
  url: string
}

interface BrowserActivityStore {
  downloads: BrowserDownloadRecord[]
  history: BrowserHistoryRecord[]
  updatedAt?: string
  version: 1
}

interface InteractionPanelWebviewScopeInput extends BrowserActivityScopeInput {
  controlRequestId?: string
  hostWebContentsId?: number
  panelPageId?: string
  webContentsId?: number
  workspaceFolder?: string
}

const browserActivityStoreVersion = 1 as const
const browserHistoryLimit = 2_000
const browserDownloadLimit = 1_000
const webviewScopesByWebContentsId = new Map<number, InteractionPanelWebviewScope>()

let writeQueue: Promise<unknown> = Promise.resolve()
let downloadTrackingInstalled = false

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const normalizeText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const normalizeOptionalText = (value: unknown) => {
  const text = normalizeText(value)
  return text === '' ? undefined : text
}

const normalizeHttpUrl = (value: unknown) => {
  const text = normalizeText(value)
  if (text === '') return undefined

  try {
    const url = new URL(text)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    return url.href
  } catch {
    return undefined
  }
}

const normalizeScopeFilter = (value: unknown): BrowserActivityScopeFilter => (
  value === 'project' || value === 'session' ? value : 'all'
)

const normalizeScopeInput = (input: unknown): BrowserActivityScopeInput => {
  if (!isRecord(input)) return {}
  const projectKey = normalizeOptionalText(input.projectKey)
  const sessionKey = normalizeOptionalText(input.sessionKey)
  return {
    ...(projectKey == null ? {} : { projectKey }),
    ...(sessionKey == null ? {} : { sessionKey })
  }
}

const normalizeListOptions = (input: unknown): Required<BrowserActivityListOptions> => {
  if (!isRecord(input)) {
    return { query: '', scope: 'all' }
  }
  return {
    query: normalizeText(input.query),
    scope: normalizeScopeFilter(input.scope)
  }
}

const getBrowserActivityStorePath = () => path.join(app.getPath('userData'), 'browser-activity.json')

const createEmptyBrowserActivityStore = (): BrowserActivityStore => ({
  downloads: [],
  history: [],
  version: browserActivityStoreVersion
})

const normalizeDateString = (value: unknown) => {
  const text = normalizeText(value)
  if (text === '') return undefined
  const time = Date.parse(text)
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined
}

const normalizeNumber = (value: unknown, fallback = 0) => (
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
)

const normalizeHistoryRecord = (value: unknown): BrowserHistoryRecord | null => {
  if (!isRecord(value)) return null
  const url = normalizeHttpUrl(value.url)
  const id = normalizeOptionalText(value.id)
  if (url == null || id == null) return null
  const now = new Date().toISOString()
  const title = normalizeOptionalText(value.title)
  const faviconUrl = normalizeOptionalText(value.faviconUrl)
  return {
    id,
    url,
    firstVisitedAt: normalizeDateString(value.firstVisitedAt) ?? now,
    lastVisitedAt: normalizeDateString(value.lastVisitedAt) ?? now,
    visitCount: Math.max(1, Math.round(normalizeNumber(value.visitCount, 1))),
    ...(title == null ? {} : { title }),
    ...(faviconUrl == null ? {} : { faviconUrl }),
    ...normalizeScopeInput(value)
  }
}

const normalizeDownloadState = (value: unknown): BrowserDownloadState => (
  value === 'cancelled' || value === 'completed' || value === 'interrupted' ? value : 'progressing'
)

const normalizeDownloadRecord = (value: unknown): BrowserDownloadRecord | null => {
  if (!isRecord(value)) return null
  const id = normalizeOptionalText(value.id)
  const url = normalizeHttpUrl(value.url)
  const fileName = normalizeOptionalText(value.fileName)
  if (id == null || url == null || fileName == null) return null
  const now = new Date().toISOString()
  const completedAt = normalizeDateString(value.completedAt)
  const filePath = normalizeOptionalText(value.filePath)
  const mimeType = normalizeOptionalText(value.mimeType)
  return {
    id,
    url,
    fileName,
    receivedBytes: Math.max(0, normalizeNumber(value.receivedBytes)),
    startedAt: normalizeDateString(value.startedAt) ?? now,
    state: normalizeDownloadState(value.state),
    totalBytes: Math.max(0, normalizeNumber(value.totalBytes)),
    updatedAt: normalizeDateString(value.updatedAt) ?? now,
    ...(completedAt == null ? {} : { completedAt }),
    ...(filePath == null ? {} : { filePath }),
    ...(mimeType == null ? {} : { mimeType }),
    ...normalizeScopeInput(value)
  }
}

const isHistoryRecord = (record: BrowserHistoryRecord | null): record is BrowserHistoryRecord => record != null

const isDownloadRecord = (record: BrowserDownloadRecord | null): record is BrowserDownloadRecord => record != null

const normalizeBrowserActivityStore = (value: unknown): BrowserActivityStore => {
  if (!isRecord(value)) return createEmptyBrowserActivityStore()
  return {
    downloads: Array.isArray(value.downloads)
      ? value.downloads.map(normalizeDownloadRecord).filter(isDownloadRecord)
      : [],
    history: Array.isArray(value.history)
      ? value.history.map(normalizeHistoryRecord).filter(isHistoryRecord)
      : [],
    version: browserActivityStoreVersion,
    ...(normalizeDateString(value.updatedAt) == null ? {} : { updatedAt: normalizeDateString(value.updatedAt) })
  }
}

const readBrowserActivityStore = async () => {
  try {
    return normalizeBrowserActivityStore(JSON.parse(await readFile(getBrowserActivityStorePath(), 'utf8')))
  } catch {
    return createEmptyBrowserActivityStore()
  }
}

const writeBrowserActivityStore = async (store: BrowserActivityStore) => {
  const filePath = getBrowserActivityStorePath()
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify({ ...store, updatedAt: new Date().toISOString() }, null, 2)}\n`)
}

const updateBrowserActivityStore = async <T>(updater: (store: BrowserActivityStore) => T | Promise<T>) => {
  const operation = writeQueue.then(async () => {
    const store = await readBrowserActivityStore()
    const result = await updater(store)
    await writeBrowserActivityStore(store)
    return result
  })
  writeQueue = operation.catch(() => undefined)
  return await operation
}

const readBrowserActivityStoreSnapshot = async () => {
  await writeQueue.catch(() => undefined)
  return await readBrowserActivityStore()
}

const getHistoryRecordId = (input: Pick<BrowserHistoryRecord, 'projectKey' | 'sessionKey' | 'url'>) =>
  createHash('sha256')
    .update(`${input.projectKey ?? ''}\n${input.sessionKey ?? ''}\n${input.url}`)
    .digest('hex')
    .slice(0, 24)

const matchesActivityScope = (record: BrowserActivityScopeInput, scope: BrowserActivityScopeFilter) => {
  if (scope === 'project') return record.projectKey != null && record.projectKey !== ''
  if (scope === 'session') return record.sessionKey != null && record.sessionKey !== ''
  return true
}

const matchesQuery = (query: string, values: Array<string | undefined>) => {
  const normalizedQuery = query.trim().toLowerCase()
  if (normalizedQuery === '') return true
  return values.some(value => value?.toLowerCase().includes(normalizedQuery))
}

const trimBrowserActivityStore = (store: BrowserActivityStore) => {
  store.history = store.history
    .sort((left, right) => Date.parse(right.lastVisitedAt) - Date.parse(left.lastVisitedAt))
    .slice(0, browserHistoryLimit)
  store.downloads = store.downloads
    .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))
    .slice(0, browserDownloadLimit)
}

export const recordBrowserHistory = async (input: unknown) => {
  if (!isRecord(input)) return undefined
  const url = normalizeHttpUrl(input.url)
  if (url == null) return undefined
  const scope = normalizeScopeInput(input)
  const id = getHistoryRecordId({ ...scope, url })
  const now = new Date().toISOString()
  const title = normalizeOptionalText(input.title)
  const faviconUrl = normalizeOptionalText(input.faviconUrl)
  const shouldIncrementVisit = input.incrementVisit !== false

  return await updateBrowserActivityStore((store) => {
    const current = store.history.find(record => record.id === id)
    if (current == null) {
      const nextRecord: BrowserHistoryRecord = {
        id,
        url,
        firstVisitedAt: now,
        lastVisitedAt: now,
        visitCount: 1,
        ...(title == null ? {} : { title }),
        ...(faviconUrl == null ? {} : { faviconUrl }),
        ...scope
      }
      store.history.unshift(nextRecord)
      trimBrowserActivityStore(store)
      return nextRecord
    }

    current.lastVisitedAt = now
    if (shouldIncrementVisit) {
      current.visitCount = Math.max(1, current.visitCount + 1)
    }
    if (title != null) current.title = title
    if (faviconUrl != null) current.faviconUrl = faviconUrl
    trimBrowserActivityStore(store)
    return current
  })
}

export const listBrowserHistory = async (input: unknown) => {
  const options = normalizeListOptions(input)
  const store = await readBrowserActivityStoreSnapshot()
  return store.history
    .filter(record => matchesActivityScope(record, options.scope))
    .filter(record =>
      matchesQuery(options.query, [
        record.title,
        record.url,
        record.projectKey,
        record.sessionKey
      ])
    )
    .sort((left, right) => Date.parse(right.lastVisitedAt) - Date.parse(left.lastVisitedAt))
}

export const listBrowserDownloads = async (input: unknown) => {
  const options = normalizeListOptions(input)
  const store = await readBrowserActivityStoreSnapshot()
  return store.downloads
    .filter(record => matchesActivityScope(record, options.scope))
    .filter(record =>
      matchesQuery(options.query, [
        record.fileName,
        record.url,
        record.filePath,
        record.mimeType,
        record.projectKey,
        record.sessionKey
      ])
    )
    .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))
}

export const registerInteractionPanelWebviewScope = (input: unknown) => {
  if (
    !isRecord(input) ||
    typeof input.webContentsId !== 'number' ||
    !Number.isFinite(input.webContentsId) ||
    typeof input.hostWebContentsId !== 'number' ||
    !Number.isFinite(input.hostWebContentsId)
  ) {
    throw new TypeError('A webContents id is required.')
  }

  const webContentsId = Math.round(input.webContentsId)
  const contents = electronWebContents.fromId(webContentsId)
  if (
    contents == null ||
    contents.getType() !== 'webview' ||
    contents.hostWebContents?.id !== Math.round(input.hostWebContentsId) ||
    contents.session !== session.fromPartition(interactionPanelWebviewPartition)
  ) {
    throw new TypeError('The webContents id is not an interaction-panel webview owned by this window.')
  }
  const alreadyRegistered = webviewScopesByWebContentsId.has(webContentsId)
  const workspaceFolder = normalizeOptionalText(input.workspaceFolder)
  const controlRequestId = normalizeOptionalText(input.controlRequestId)
  const panelPageId = normalizeOptionalText(input.panelPageId)
  const scope: InteractionPanelWebviewScope = {
    webContentsId,
    hostWebContentsId: Math.round(input.hostWebContentsId),
    registeredAt: Date.now(),
    ...normalizeScopeInput(input),
    ...(controlRequestId == null ? {} : { controlRequestId }),
    ...(panelPageId == null ? {} : { panelPageId }),
    ...(workspaceFolder == null ? {} : { workspaceFolder: path.resolve(workspaceFolder) })
  }
  webviewScopesByWebContentsId.set(webContentsId, scope)
  if (!alreadyRegistered) {
    contents.once('destroyed', () => {
      webviewScopesByWebContentsId.delete(webContentsId)
    })
  }
  return scope
}

export const listInteractionPanelWebviewScopes = (): InteractionPanelWebviewScope[] => (
  [...webviewScopesByWebContentsId.values()]
    .filter(scope => electronWebContents.fromId(scope.webContentsId) != null)
)

const getDownloadRecordId = (item: DownloadItem, startedAt: string) =>
  createHash('sha256')
    .update(`${startedAt}\n${item.getURL()}\n${item.getFilename()}\n${item.getSavePath()}`)
    .digest('hex')
    .slice(0, 24)

const getDownloadUrl = (item: DownloadItem) => {
  const urlChain = item.getURLChain()
  return normalizeHttpUrl(urlChain[urlChain.length - 1]) ?? normalizeHttpUrl(item.getURL()) ??
    'https://download.invalid/'
}

const getDownloadFileName = (item: DownloadItem) => {
  const filename = normalizeOptionalText(item.getFilename())
  if (filename != null) return filename
  const savePath = normalizeOptionalText(item.getSavePath())
  if (savePath != null) return path.basename(savePath)
  try {
    const url = new URL(getDownloadUrl(item))
    return path.basename(url.pathname) || 'download'
  } catch {
    return 'download'
  }
}

const upsertDownloadRecord = async (record: BrowserDownloadRecord) => {
  await updateBrowserActivityStore((store) => {
    const currentIndex = store.downloads.findIndex(item => item.id === record.id)
    if (currentIndex >= 0) {
      store.downloads[currentIndex] = {
        ...store.downloads[currentIndex],
        ...record
      }
    } else {
      store.downloads.unshift(record)
    }
    trimBrowserActivityStore(store)
  })
}

const updateDownloadRecord = async (
  id: string,
  patch: Partial<Pick<BrowserDownloadRecord, 'completedAt' | 'filePath' | 'receivedBytes' | 'state' | 'totalBytes'>>
) => {
  await updateBrowserActivityStore((store) => {
    const current = store.downloads.find(record => record.id === id)
    if (current == null) return
    Object.assign(current, patch, { updatedAt: new Date().toISOString() })
    trimBrowserActivityStore(store)
  })
}

const getDownloadRecordById = async (id: unknown) => {
  const normalizedId = normalizeOptionalText(id)
  if (normalizedId == null) throw new TypeError('A download id is required.')
  const store = await readBrowserActivityStoreSnapshot()
  const record = store.downloads.find(item => item.id === normalizedId)
  if (record == null) throw new Error('Download record was not found.')
  return record
}

export const openBrowserDownload = async (id: unknown) => {
  const record = await getDownloadRecordById(id)
  if (record.filePath == null || record.filePath.trim() === '') {
    throw new Error('Downloaded file path is unavailable.')
  }
  const errorMessage = await shell.openPath(record.filePath)
  if (errorMessage !== '') throw new Error(errorMessage)
}

export const revealBrowserDownload = async (id: unknown) => {
  const record = await getDownloadRecordById(id)
  if (record.filePath == null || record.filePath.trim() === '') {
    throw new Error('Downloaded file path is unavailable.')
  }
  shell.showItemInFolder(record.filePath)
}

const buildDownloadRecord = (
  item: DownloadItem,
  ownerWebContents: WebContents,
  startedAt: string
): BrowserDownloadRecord => {
  const id = getDownloadRecordId(item, startedAt)
  const scope = webviewScopesByWebContentsId.get(ownerWebContents.id) ?? {}
  const activityScope = normalizeScopeInput(scope)
  const mimeType = normalizeOptionalText(item.getMimeType())
  const filePath = normalizeOptionalText(item.getSavePath())
  return {
    id,
    url: getDownloadUrl(item),
    fileName: getDownloadFileName(item),
    receivedBytes: Math.max(0, item.getReceivedBytes()),
    startedAt,
    state: 'progressing',
    totalBytes: Math.max(0, item.getTotalBytes()),
    updatedAt: startedAt,
    ...(mimeType == null ? {} : { mimeType }),
    ...(filePath == null ? {} : { filePath }),
    ...activityScope
  }
}

export const installBrowserActivityDownloadTracking = () => {
  if (downloadTrackingInstalled) return
  downloadTrackingInstalled = true
  const webviewSession = session.fromPartition(interactionPanelWebviewPartition)

  webviewSession.on('will-download', (_event, item, ownerWebContents) => {
    const startedAt = new Date().toISOString()
    const initialRecord = buildDownloadRecord(item, ownerWebContents, startedAt)
    void upsertDownloadRecord(initialRecord).catch((error) => {
      console.warn('[browser-activity] failed to record download start', error)
    })

    item.on('updated', (_updatedEvent, state) => {
      void updateDownloadRecord(initialRecord.id, {
        filePath: normalizeOptionalText(item.getSavePath()),
        receivedBytes: Math.max(0, item.getReceivedBytes()),
        state: state === 'interrupted' ? 'interrupted' : 'progressing',
        totalBytes: Math.max(0, item.getTotalBytes())
      }).catch((error) => {
        console.warn('[browser-activity] failed to update download progress', error)
      })
    })

    item.once('done', (_doneEvent, state) => {
      const completedAt = new Date().toISOString()
      void updateDownloadRecord(initialRecord.id, {
        completedAt,
        filePath: normalizeOptionalText(item.getSavePath()),
        receivedBytes: Math.max(0, item.getReceivedBytes()),
        state,
        totalBytes: Math.max(0, item.getTotalBytes())
      }).catch((error) => {
        console.warn('[browser-activity] failed to update download result', error)
      })
    })
  })
}
