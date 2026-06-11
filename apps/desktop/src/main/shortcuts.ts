import process from 'node:process'

import { BrowserWindow } from 'electron'

import { TOGGLE_SIDEBAR_CHANNEL, VIEW_SHORTCUT_ACTIONS, VIEW_SHORTCUT_CHANNEL, VIEW_SHORTCUT_INPUTS } from './constants'
import type { ViewShortcutAction } from './constants'
import type { WindowRecord } from './types'
import { isWindowLoadFailureScreenUrl } from './window-load-failure'

export const openOneWorksDevTools = (window = BrowserWindow.getFocusedWindow()) => {
  if (window == null || window.isDestroyed()) return

  window.webContents.openDevTools({ mode: 'detach' })
}

export const reloadOneWorksWindow = (
  windowRecord?: WindowRecord,
  window = BrowserWindow.getFocusedWindow()
) => {
  const targetWindow = windowRecord?.window ?? window
  if (targetWindow == null || targetWindow.isDestroyed()) return

  const currentUrl = targetWindow.webContents.getURL()
  if (windowRecord?.loadFailureUrl != null && isWindowLoadFailureScreenUrl(currentUrl)) {
    void targetWindow.loadURL(windowRecord.loadFailureUrl).catch((error) => {
      console.warn('[oneworks-desktop] failed to reload window from load failure screen', error)
    })
    return
  }

  targetWindow.webContents.reloadIgnoringCache()
}

export const sendViewShortcut = (action: ViewShortcutAction, window = BrowserWindow.getFocusedWindow()) => {
  if (window == null || window.isDestroyed()) return

  window.webContents.send(VIEW_SHORTCUT_CHANNEL, action)
  if (action === VIEW_SHORTCUT_ACTIONS.toggleSidebar) {
    window.webContents.send(TOGGLE_SIDEBAR_CHANNEL)
  }
}

export const isDevToolsShortcutInput = (input: Electron.Input) => {
  if (input?.type !== 'keyDown') return false

  const key = String(input.key ?? '').toLowerCase()
  if (key === 'f12') return true
  if (key !== 'i') return false

  const hasCommandOrControl = process.platform === 'darwin'
    ? input.meta === true
    : input.control === true
  const hasMacDevToolsShortcut = process.platform === 'darwin' && input.meta === true && input.alt === true
  const hasCrossPlatformDevToolsShortcut = hasCommandOrControl && input.shift === true

  return hasMacDevToolsShortcut || hasCrossPlatformDevToolsShortcut
}

export const isReloadWindowShortcutInput = (input: Electron.Input) => {
  if (input?.type !== 'keyDown') return false

  const key = String(input.key ?? '').toLowerCase()
  if (key !== 'r') return false

  const hasCommandOrControl = process.platform === 'darwin'
    ? input.meta === true
    : input.control === true
  const hasUnexpectedCommandModifier = process.platform === 'darwin'
    ? input.control === true
    : input.meta === true

  return hasCommandOrControl &&
    !hasUnexpectedCommandModifier &&
    input.shift === true &&
    input.alt !== true
}

const normalizeViewShortcutInputKey = (key: string) => {
  if (key === '{') return '['
  if (key === '}') return ']'
  return key
}

export const getViewShortcutInputAction = (input: Electron.Input): ViewShortcutAction | null => {
  if (input?.type !== 'keyDown') return null

  const key = normalizeViewShortcutInputKey(String(input.key ?? '').toLowerCase())
  const hasCommandOrControl = process.platform === 'darwin'
    ? input.meta === true
    : input.control === true
  const hasUnexpectedCommandModifier = process.platform === 'darwin'
    ? input.control === true
    : input.meta === true

  if (!hasCommandOrControl || hasUnexpectedCommandModifier) return null

  const shortcut = VIEW_SHORTCUT_INPUTS.find(candidate => (
    key === candidate.key &&
    input.alt === (candidate.alt === true) &&
    input.shift === (candidate.shift === true)
  ))

  return shortcut?.action ?? null
}
