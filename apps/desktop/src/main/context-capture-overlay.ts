/* eslint-disable max-lines -- overlay model, static markup, and window lifecycle stay together for capture safety. */
import process from 'node:process'

import { BrowserWindow, screen } from 'electron'
import type { BrowserWindowConstructorOptions, Rectangle } from 'electron'

import type { DesktopContextCaptureOverlayPlacement } from './desktop-settings-types'

const overlayDefaultSize = {
  height: 64,
  width: 520
} as const
const overlayGap = 10
const overlayMargin = 12
const maxOverlayTextLength = 4000

export interface DesktopContextCapturePoint {
  x: number
  y: number
}

export interface DesktopContextCaptureScreenRect extends DesktopContextCapturePoint {
  height: number
  width: number
}

export interface DesktopContextCaptureSourceApplication {
  bundleId?: string
  name?: string
  path?: string
}

export interface DesktopContextCaptureSnapshot {
  capturedAt: string
  cursorPoint?: DesktopContextCapturePoint
  selectionRect?: DesktopContextCaptureScreenRect
  sourceApplication?: DesktopContextCaptureSourceApplication
  text: string
  trust: 'untrusted'
}

export interface DesktopContextCaptureOverlayInput {
  placement?: DesktopContextCaptureOverlayPlacement
  snapshot: {
    capturedAt?: unknown
    cursorPoint?: unknown
    selectionRect?: unknown
    sourceApplication?: unknown
    text?: unknown
  }
}

export interface DesktopContextCaptureOverlayShowOptions {
  defaultPlacement?: DesktopContextCaptureOverlayPlacement
}

export interface NormalizedDesktopContextCaptureOverlayInput {
  placement: DesktopContextCaptureOverlayPlacement
  snapshot: DesktopContextCaptureSnapshot
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const clamp = (value: number, min: number, max: number) => (
  Math.min(Math.max(value, min), Math.max(min, max))
)

const normalizeFiniteNumber = (value: unknown) => (
  typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined
)

const normalizeOverlayPlacement = (
  value: unknown,
  fallback: DesktopContextCaptureOverlayPlacement
): DesktopContextCaptureOverlayPlacement => (
  value === 'above' || value === 'below' || value === 'auto'
    ? value
    : fallback
)

const normalizePoint = (value: unknown): DesktopContextCapturePoint | undefined => {
  if (!isRecord(value)) return undefined
  const x = normalizeFiniteNumber(value.x)
  const y = normalizeFiniteNumber(value.y)
  if (x == null || y == null) return undefined
  return { x, y }
}

const normalizeSelectionRect = (value: unknown): DesktopContextCaptureScreenRect | undefined => {
  if (!isRecord(value)) return undefined
  const x = normalizeFiniteNumber(value.x)
  const y = normalizeFiniteNumber(value.y)
  const width = normalizeFiniteNumber(value.width)
  const height = normalizeFiniteNumber(value.height)
  if (x == null || y == null || width == null || height == null) return undefined
  if (width <= 0 || height <= 0) return undefined
  return { height, width, x, y }
}

const normalizeOptionalText = (value: unknown, maxLength = 160) => {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (text === '') return undefined
  return text.slice(0, maxLength)
}

const normalizeSourceApplication = (value: unknown): DesktopContextCaptureSourceApplication | undefined => {
  if (!isRecord(value)) return undefined
  const sourceApplication = {
    bundleId: normalizeOptionalText(value.bundleId),
    name: normalizeOptionalText(value.name),
    path: normalizeOptionalText(value.path, 500)
  }
  return Object.values(sourceApplication).some(item => item != null)
    ? sourceApplication
    : undefined
}

export const normalizeDesktopContextCaptureOverlayInput = (
  value: unknown,
  options: DesktopContextCaptureOverlayShowOptions = {}
): NormalizedDesktopContextCaptureOverlayInput => {
  if (!isRecord(value) || !isRecord(value.snapshot)) {
    throw new TypeError('A desktop context capture snapshot is required.')
  }

  const text = typeof value.snapshot.text === 'string'
    ? value.snapshot.text.slice(0, maxOverlayTextLength)
    : ''
  if (text.trim() === '') {
    throw new TypeError('Desktop context capture text is required.')
  }
  const cursorPoint = normalizePoint(value.snapshot.cursorPoint)
  const selectionRect = normalizeSelectionRect(value.snapshot.selectionRect)
  const sourceApplication = normalizeSourceApplication(value.snapshot.sourceApplication)

  return {
    placement: normalizeOverlayPlacement(
      value.placement,
      options.defaultPlacement ?? 'auto'
    ),
    snapshot: {
      ...(typeof value.snapshot.capturedAt === 'string' && value.snapshot.capturedAt.trim() !== ''
        ? { capturedAt: value.snapshot.capturedAt }
        : { capturedAt: new Date().toISOString() }),
      ...(cursorPoint == null ? {} : { cursorPoint }),
      ...(selectionRect == null ? {} : { selectionRect }),
      ...(sourceApplication == null ? {} : { sourceApplication }),
      text,
      trust: 'untrusted'
    }
  }
}

const resolveAnchorPoint = (
  snapshot: Pick<DesktopContextCaptureSnapshot, 'cursorPoint' | 'selectionRect'>
): DesktopContextCapturePoint => {
  if (snapshot.selectionRect != null) {
    return {
      x: snapshot.selectionRect.x + snapshot.selectionRect.width / 2,
      y: snapshot.selectionRect.y + snapshot.selectionRect.height / 2
    }
  }

  return snapshot.cursorPoint ?? { x: 0, y: 0 }
}

export const resolveDesktopContextCaptureOverlayBounds = (input: {
  placement: DesktopContextCaptureOverlayPlacement
  snapshot: Pick<DesktopContextCaptureSnapshot, 'cursorPoint' | 'selectionRect'>
  workArea: Rectangle
}): Rectangle => {
  const width = Math.max(
    180,
    Math.min(overlayDefaultSize.width, input.workArea.width - overlayMargin * 2)
  )
  const height = Math.max(
    48,
    Math.min(overlayDefaultSize.height, input.workArea.height - overlayMargin * 2)
  )
  const anchorPoint = resolveAnchorPoint(input.snapshot)
  const anchorRect = input.snapshot.selectionRect ?? {
    height: 1,
    width: 1,
    x: anchorPoint.x,
    y: anchorPoint.y
  }
  const minX = input.workArea.x + overlayMargin
  const maxX = input.workArea.x + input.workArea.width - width - overlayMargin
  const minY = input.workArea.y + overlayMargin
  const maxY = input.workArea.y + input.workArea.height - height - overlayMargin
  const belowY = anchorRect.y + anchorRect.height + overlayGap
  const aboveY = anchorRect.y - height - overlayGap
  const autoY = belowY <= maxY
    ? belowY
    : aboveY >= minY
    ? aboveY
    : belowY

  return {
    height,
    width,
    x: Math.round(clamp(anchorPoint.x - width / 2, minX, maxX)),
    y: Math.round(clamp(
      input.placement === 'above'
        ? aboveY
        : input.placement === 'below'
        ? belowY
        : autoY,
      minY,
      maxY
    ))
  }
}

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

const getOverlayTextPreview = (value: string) => {
  const preview = value.replace(/\s+/g, ' ').trim()
  return preview.length > 160 ? `${preview.slice(0, 157)}...` : preview
}

const getSourceApplicationLabel = (snapshot: DesktopContextCaptureSnapshot) => (
  snapshot.sourceApplication?.name ??
    snapshot.sourceApplication?.bundleId ??
    'Desktop selection'
)

const buildOverlayDataUrl = (snapshot: DesktopContextCaptureSnapshot) => {
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
    <style>
      :root {
        color-scheme: light dark;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      html,
      body {
        background: transparent;
        margin: 0;
        overflow: hidden;
      }
      .bar {
        align-items: center;
        background: rgba(250, 252, 249, 0.96);
        border: 1px solid rgba(86, 96, 89, 0.2);
        border-radius: 14px;
        box-shadow: 0 16px 42px rgba(21, 25, 22, 0.2), 0 3px 10px rgba(21, 25, 22, 0.12);
        box-sizing: border-box;
        color: #1e2721;
        display: flex;
        gap: 12px;
        height: 64px;
        padding: 10px 14px;
        width: 100vw;
      }
      .mark {
        align-items: center;
        background: #0f766e;
        border-radius: 10px;
        color: white;
        display: flex;
        flex: 0 0 36px;
        font-size: 13px;
        font-weight: 700;
        height: 36px;
        justify-content: center;
      }
      .content {
        min-width: 0;
      }
      .source {
        color: #59645c;
        font-size: 12px;
        line-height: 16px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .text {
        color: #162019;
        font-size: 14px;
        line-height: 20px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      @media (prefers-color-scheme: dark) {
        .bar {
          background: rgba(30, 35, 31, 0.95);
          border-color: rgba(233, 238, 229, 0.16);
          color: #edf4ec;
        }
        .source {
          color: #aab5ab;
        }
        .text {
          color: #f4faf2;
        }
      }
    </style>
  </head>
  <body>
    <main class="bar" aria-label="Context capture preview">
      <div class="mark">AI</div>
      <div class="content">
        <div class="source">${escapeHtml(getSourceApplicationLabel(snapshot))} - untrusted evidence</div>
        <div class="text">${escapeHtml(getOverlayTextPreview(snapshot.text))}</div>
      </div>
    </main>
  </body>
</html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

const createOverlayWindow = () => {
  const options: BrowserWindowConstructorOptions = {
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    focusable: false,
    frame: false,
    fullscreenable: false,
    hasShadow: true,
    height: overlayDefaultSize.height,
    maximizable: false,
    minimizable: false,
    movable: false,
    resizable: false,
    show: false,
    skipTaskbar: true,
    transparent: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    },
    width: overlayDefaultSize.width,
    ...(process.platform === 'darwin'
      ? {
        hiddenInMissionControl: true,
        type: 'panel',
        vibrancy: 'popover',
        visualEffectState: 'active'
      }
      : {})
  }
  return new BrowserWindow(options)
}

export const createDesktopContextCaptureOverlayController = () => {
  let overlayWindow: BrowserWindow | undefined

  const ensureOverlayWindow = () => {
    if (overlayWindow != null && !overlayWindow.isDestroyed()) return overlayWindow

    overlayWindow = createOverlayWindow()
    overlayWindow.once('closed', () => {
      overlayWindow = undefined
    })
    overlayWindow.setAlwaysOnTop(true, process.platform === 'darwin' ? 'floating' : 'pop-up-menu')
    overlayWindow.setVisibleOnAllWorkspaces(true)
    overlayWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    return overlayWindow
  }

  const hide = () => {
    if (overlayWindow == null || overlayWindow.isDestroyed()) return
    overlayWindow.hide()
  }

  return {
    dispose: () => {
      if (overlayWindow == null || overlayWindow.isDestroyed()) return
      overlayWindow.destroy()
      overlayWindow = undefined
    },
    hide,
    show: async (input: unknown, options: DesktopContextCaptureOverlayShowOptions = {}) => {
      const normalizedInput = normalizeDesktopContextCaptureOverlayInput(input, options)
      const snapshotWithAnchor = normalizedInput.snapshot.selectionRect != null ||
          normalizedInput.snapshot.cursorPoint != null
        ? normalizedInput.snapshot
        : {
          ...normalizedInput.snapshot,
          cursorPoint: screen.getCursorScreenPoint()
        }
      const anchorPoint = resolveAnchorPoint(snapshotWithAnchor)
      const display = screen.getDisplayNearestPoint(anchorPoint)
      const bounds = resolveDesktopContextCaptureOverlayBounds({
        placement: normalizedInput.placement,
        snapshot: snapshotWithAnchor,
        workArea: display.workArea
      })
      const window = ensureOverlayWindow()

      window.setBounds(bounds)
      await window.loadURL(buildOverlayDataUrl(normalizedInput.snapshot))
      if (!window.isDestroyed()) {
        window.showInactive()
      }

      return normalizedInput
    }
  }
}
