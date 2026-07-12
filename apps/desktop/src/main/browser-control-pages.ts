import { webContents as electronWebContents } from 'electron'
import type { WebContents } from 'electron'

import { listInteractionPanelWebviewScopes } from './browser-activity'
import type { InteractionPanelWebviewScope } from './browser-activity'

export interface BrowserControlPage {
  hostWebContentsId?: number
  id: string
  panelPageId?: string
  registered_at: string
  session_id?: string
  title: string
  url: string
  webContents: WebContents
}

export interface BrowserControlPageOptions {
  getWebContentsById?: (id: number) => WebContents | undefined
  listWebviewScopes?: () => InteractionPanelWebviewScope[]
}

export interface BrowserControlPageRequest {
  page_id?: string
  session_id?: string
}

const normalizeText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const webContentsIdFromPageId = (pageId: unknown) => {
  const match = /^page_(\d+)$/u.exec(normalizeText(pageId))
  if (match == null) return undefined
  const id = Number.parseInt(match[1], 10)
  return Number.isFinite(id) ? id : undefined
}

export const pageSummary = (page: BrowserControlPage) => ({
  id: page.id,
  title: page.title,
  url: page.url,
  registered_at: page.registered_at,
  ...(page.session_id == null ? {} : { session_id: page.session_id })
})

export const createBrowserControlPages = (options: BrowserControlPageOptions) => {
  const listScopes = () => options.listWebviewScopes?.() ?? listInteractionPanelWebviewScopes()

  const listPages = (workspaceFolder: string, sessionId?: string): BrowserControlPage[] => (
    listScopes()
      .filter(scope => scope.workspaceFolder === workspaceFolder)
      .filter(scope => sessionId == null || scope.sessionKey === sessionId)
      .flatMap(scope => {
        const webContents = options.getWebContentsById?.(scope.webContentsId) ??
          electronWebContents.fromId(scope.webContentsId) ?? undefined
        if (webContents == null || webContents.isDestroyed()) return []
        return [{
          ...(scope.hostWebContentsId == null ? {} : { hostWebContentsId: scope.hostWebContentsId }),
          id: `page_${scope.webContentsId}`,
          ...(scope.panelPageId == null ? {} : { panelPageId: scope.panelPageId }),
          registered_at: new Date(scope.registeredAt).toISOString(),
          ...(scope.sessionKey == null ? {} : { session_id: scope.sessionKey }),
          title: webContents.getTitle(),
          url: webContents.getURL(),
          webContents
        }]
      })
      .sort((left, right) => right.registered_at.localeCompare(left.registered_at))
  )

  const resolvePage = (workspaceFolder: string, input: BrowserControlPageRequest) => {
    const pages = listPages(workspaceFolder, normalizeText(input.session_id) || undefined)
    const pageId = normalizeText(input.page_id)
    if (pageId === '') {
      throw Object.assign(new Error('Pass page_id from in_app_browser_open or in_app_browser_list_pages.'), {
        code: 'PAGE_ID_REQUIRED',
        statusCode: 400
      })
    }
    const requestedId = webContentsIdFromPageId(input.page_id)
    if (requestedId == null) {
      throw Object.assign(new Error('page_id must use the page_<number> format.'), {
        code: 'INVALID_PAGE_ID',
        statusCode: 400
      })
    }
    const page = pages.find(candidate => candidate.webContents.id === requestedId)
    if (page == null) {
      throw Object.assign(new Error('The requested browser page is unavailable in this session.'), {
        code: 'PAGE_NOT_FOUND',
        statusCode: 404
      })
    }
    return page
  }

  return { listPages, listScopes, resolvePage }
}

export type BrowserControlPages = ReturnType<typeof createBrowserControlPages>
