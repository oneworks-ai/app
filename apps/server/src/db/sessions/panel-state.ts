/* eslint-disable max-lines -- session panel state parsing keeps all persisted tab variants normalized together. */
import type {
  SessionPanelAreaState,
  SessionPanelState,
  SessionPanelTab,
  SessionPanelWorkspaceDrawerView
} from '@oneworks/core'

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value)

const normalizeNonEmptyString = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

const uniqueTabs = (tabs: SessionPanelTab[]) => {
  const result: SessionPanelTab[] = []
  const seen = new Set<string>()
  for (const tab of tabs) {
    if (seen.has(tab.id)) continue
    seen.add(tab.id)
    result.push(tab)
  }
  return result
}

const normalizeHistory = (value: unknown) => {
  if (!Array.isArray(value)) return undefined
  const history = value
    .map(item => normalizeNonEmptyString(item))
    .filter((item): item is string => item != null)
  return history.length <= 0 ? undefined : history
}

const normalizeNumber = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return value
}

const normalizeViewport = (value: unknown) => {
  if (!isObjectRecord(value)) return undefined
  const height = normalizeNumber(value.height)
  const width = normalizeNumber(value.width)
  const presetId = normalizeNonEmptyString(value.presetId)
  if (height == null && presetId == null && width == null) return undefined
  return {
    ...(height == null ? {} : { height }),
    ...(presetId == null ? {} : { presetId }),
    ...(width == null ? {} : { width })
  }
}

const normalizePanelTab = (value: unknown): SessionPanelTab | null => {
  if (!isObjectRecord(value)) return null

  const id = normalizeNonEmptyString(value.id)
  const kind = normalizeNonEmptyString(value.kind)
  if (id == null || kind == null) return null

  if (kind === 'web') {
    const url = typeof value.url === 'string' ? value.url.trim() : undefined
    if (url == null) return null
    const title = (normalizeNonEmptyString(value.title) ?? url) || id
    const faviconUrl = normalizeNonEmptyString(value.faviconUrl)
    const history = normalizeHistory(value.history)
    const historyIndex = normalizeNumber(value.historyIndex)
    const variant = value.variant === 'mobile-debug-devtools' ? value.variant : undefined
    const viewport = normalizeViewport(value.viewport)
    return {
      id,
      kind,
      title,
      url,
      ...(value.deviceToolbarOpen === true ? { deviceToolbarOpen: true } : {}),
      ...(faviconUrl == null ? {} : { faviconUrl }),
      ...(history == null ? {} : { history }),
      ...(historyIndex == null ? {} : { historyIndex }),
      ...(value.inspectOpen === true ? { inspectOpen: true } : {}),
      ...(variant == null ? {} : { variant }),
      ...(viewport == null ? {} : { viewport })
    }
  }

  if (kind === 'terminal') {
    const terminalId = normalizeNonEmptyString(value.terminalId) ?? id
    const title = normalizeNonEmptyString(value.title) ?? terminalId
    const shellKind = normalizeNonEmptyString(value.shellKind)
    return {
      id,
      kind,
      terminalId,
      title,
      ...(value.runCommand === undefined ? {} : { runCommand: value.runCommand }),
      ...(shellKind == null ? {} : { shellKind })
    }
  }

  if (kind === 'file') {
    const path = normalizeNonEmptyString(value.path)
    if (path == null) return null
    return {
      id,
      kind,
      path,
      title: normalizeNonEmptyString(value.title) ?? path.split('/').filter(Boolean).at(-1) ?? path
    }
  }

  if (kind === 'session') {
    const title = normalizeNonEmptyString(value.title) ?? 'Session'
    const focusRequestId = normalizeNonEmptyString(value.focusRequestId)
    const sessionId = normalizeNonEmptyString(value.sessionId)
    return {
      id,
      kind,
      title,
      ...(focusRequestId == null ? {} : { focusRequestId }),
      ...(sessionId == null ? {} : { sessionId })
    }
  }

  if (kind === 'mobile-debug') {
    return {
      id,
      kind,
      title: normalizeNonEmptyString(value.title) ?? 'Mobile Debug',
      ...(value.state === undefined ? {} : { state: value.state })
    }
  }

  if (kind === 'page-debugger') {
    return {
      id,
      kind,
      title: normalizeNonEmptyString(value.title) ?? 'Page Debugger'
    }
  }

  if (kind === 'workspace-drawer') {
    const view = normalizeNonEmptyString(value.view)
    if (view == null) return null
    return {
      id,
      kind,
      title: normalizeNonEmptyString(value.title) ?? view,
      view: view as SessionPanelWorkspaceDrawerView
    }
  }

  if (kind === 'plugin') {
    const pluginScope = normalizeNonEmptyString(value.pluginScope)
    const tabId = normalizeNonEmptyString(value.tabId)
    const viewId = normalizeNonEmptyString(value.viewId)
    if (pluginScope == null || tabId == null || viewId == null) return null
    const icon = normalizeNonEmptyString(value.icon)
    const stateVersion = normalizeNumber(value.stateVersion)
    return {
      id,
      kind,
      pluginScope,
      tabId,
      viewId,
      title: normalizeNonEmptyString(value.title) ?? tabId,
      ...(icon == null ? {} : { icon }),
      ...(value.state === undefined ? {} : { state: value.state }),
      ...(stateVersion == null ? {} : { stateVersion })
    }
  }

  return null
}

const normalizePanelAreaState = (value: unknown): SessionPanelAreaState => {
  const input = isObjectRecord(value) ? value : {}
  const tabs = uniqueTabs(
    (Array.isArray(input.tabs) ? input.tabs : [])
      .map(normalizePanelTab)
      .filter((tab): tab is SessionPanelTab => tab != null)
  )
  const activeTabId = normalizeNonEmptyString(input.activeTabId)
  const layout = isObjectRecord(input.layout) ? input.layout : undefined
  return {
    tabs,
    ...(layout == null ? {} : { layout }),
    ...(activeTabId == null || !tabs.some(tab => tab.id === activeTabId) ? {} : { activeTabId })
  }
}

export const normalizeSessionPanelState = (value: unknown): SessionPanelState => {
  const input = isObjectRecord(value) ? value : {}
  const bottom = normalizePanelAreaState(input.bottom)
  const right = normalizePanelAreaState(input.right)

  return { bottom, right }
}

export const parseSessionPanelState = (value: string | null): SessionPanelState | undefined => {
  if (value == null || value.trim() === '') {
    return undefined
  }

  try {
    return normalizeSessionPanelState(JSON.parse(value))
  } catch {
    return undefined
  }
}
