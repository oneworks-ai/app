import { webContents as electronWebContents } from 'electron'
import type { WebContents } from 'electron'

import type { BrowserControlDeviceModeState } from '@oneworks/types'

import type { InteractionPanelWebviewScope } from './browser-activity'
import { sendBrowserControlPageCommand } from './browser-control-page-commands'
import type { SendBrowserControlPageCommand } from './browser-control-page-commands'

export interface NativeDeviceEmulationState extends BrowserControlDeviceModeState {
  enabled: true
}

interface RestoreDeviceEmulationOptions {
  getWebContentsById?: (id: number) => WebContents | undefined
  sendPageCommand?: SendBrowserControlPageCommand
}

const appliedStates = new Map<number, NativeDeviceEmulationState>()
const cleanupRegistered = new Set<number>()

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

export const readBrowserControlDeviceModeState = (
  result: unknown
): BrowserControlDeviceModeState | undefined => {
  const resultRecord = isRecord(result) ? result : {}
  const state = isRecord(resultRecord.device_mode) ? resultRecord.device_mode : undefined
  if (state == null || typeof state.enabled !== 'boolean') return undefined
  if (
    typeof state.device_pixel_ratio !== 'number' || !Number.isFinite(state.device_pixel_ratio) ||
    (state.device_type !== 'desktop' && state.device_type !== 'mobile') ||
    typeof state.height !== 'number' || !Number.isFinite(state.height) ||
    typeof state.preset_id !== 'string' ||
    typeof state.width !== 'number' || !Number.isFinite(state.width) ||
    (state.zoom !== 'auto' && (typeof state.zoom !== 'number' || !Number.isFinite(state.zoom)))
  ) return undefined
  return state as unknown as BrowserControlDeviceModeState
}

export const getAppliedBrowserControlDeviceEmulation = (webContentsId: number) => (
  appliedStates.get(webContentsId)
)

export const applyBrowserControlDeviceEmulation = (
  contents: WebContents,
  state?: NativeDeviceEmulationState
) => {
  if (state == null) {
    contents.disableDeviceEmulation()
    appliedStates.delete(contents.id)
    return
  }
  contents.enableDeviceEmulation({
    deviceScaleFactor: state.device_pixel_ratio,
    scale: 1,
    screenPosition: state.device_type,
    screenSize: { height: state.height, width: state.width },
    viewPosition: { x: 0, y: 0 },
    viewSize: { height: state.height, width: state.width }
  })
  appliedStates.set(contents.id, state)
  if (!cleanupRegistered.has(contents.id)) {
    cleanupRegistered.add(contents.id)
    contents.once('destroyed', () => {
      appliedStates.delete(contents.id)
      cleanupRegistered.delete(contents.id)
    })
  }
}

export const restoreBrowserControlDeviceEmulationForScope = async (
  scope: InteractionPanelWebviewScope,
  options: RestoreDeviceEmulationOptions = {}
) => {
  if (scope.panelPageId == null || scope.hostWebContentsId == null) return { restored: false }
  const getWebContentsById = options.getWebContentsById ?? (id => electronWebContents.fromId(id) ?? undefined)
  const guest = getWebContentsById(scope.webContentsId)
  const host = getWebContentsById(scope.hostWebContentsId)
  if (guest == null || guest.isDestroyed() || host == null || host.isDestroyed()) {
    throw Object.assign(new Error('The internal browser page is unavailable while restoring device emulation.'), {
      code: 'PAGE_NOT_FOUND',
      statusCode: 404
    })
  }
  let result: unknown
  try {
    result = await (options.sendPageCommand ?? sendBrowserControlPageCommand)(host, {
      command: { type: 'get_page_view_state' },
      pageId: `page_${scope.webContentsId}`,
      panelPageId: scope.panelPageId,
      ...(scope.sessionKey == null ? {} : { sessionId: scope.sessionKey })
    })
  } catch (error) {
    try {
      applyBrowserControlDeviceEmulation(guest)
    } catch {}
    return {
      restored: false,
      warning: {
        code: 'DEVICE_EMULATION_STATE_UNAVAILABLE',
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }
  const state = readBrowserControlDeviceModeState(result)
  if (state == null) {
    try {
      applyBrowserControlDeviceEmulation(guest)
    } catch {}
    return {
      restored: false,
      warning: {
        code: 'INVALID_DEVICE_MODE_STATE',
        message: 'The browser page returned an invalid persisted device-mode state.'
      }
    }
  }
  try {
    applyBrowserControlDeviceEmulation(guest, state.enabled ? state as NativeDeviceEmulationState : undefined)
  } catch (error) {
    appliedStates.delete(guest.id)
    try {
      guest.disableDeviceEmulation()
    } catch {}
    return {
      restored: false,
      state,
      warning: {
        code: 'DEVICE_EMULATION_RESTORE_FAILED',
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }
  return { restored: true, state }
}
