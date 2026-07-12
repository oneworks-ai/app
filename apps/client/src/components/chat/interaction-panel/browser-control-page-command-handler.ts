import type {
  BrowserControlDeviceModeState,
  BrowserControlPageCommandCompletion,
  BrowserControlPageCommandRequest
} from '@oneworks/types'

import { resolveBrowserControlDeviceMode } from './browser-control-device-mode'
import type { BrowserControlDevicePreset } from './browser-control-device-mode'
import { handleBrowserControlPageNavigationCommand } from './browser-control-page-navigation-command-handler'
import type { BrowserControlPageNavigationController } from './browser-control-page-navigation-command-handler'

export interface BrowserControlPageViewState {
  active: boolean
  deviceMode: BrowserControlDeviceModeState
  devtools: { dockSide: 'bottom' | 'left' | 'right'; enabled: boolean }
  history: string[]
  historyIndex: number
  panelPageId: string
  title: string
  url: string
}

export interface BrowserControlPageCommandController extends BrowserControlPageNavigationController {
  applyDeviceMode: (state: BrowserControlDeviceModeState) => Promise<BrowserControlDeviceModeState>
  applyDevtools: (input: {
    dockSide?: 'bottom' | 'left' | 'right'
    enabled: boolean
  }) => Promise<{ dockSide: 'bottom' | 'left' | 'right'; enabled: boolean }>
  devicePresets: readonly BrowserControlDevicePreset[]
  pageId: string
  sessionId?: string
  state: BrowserControlPageViewState
}

export const handleBrowserControlPageCommand = ({
  complete,
  controller,
  request
}: {
  complete: (completion: Omit<BrowserControlPageCommandCompletion, 'requestId'>) => void
  controller: BrowserControlPageCommandController
  request: BrowserControlPageCommandRequest
}) => {
  if (request.panelPageId !== controller.pageId) return false
  if (request.sessionId != null && request.sessionId !== controller.sessionId) {
    complete({
      ok: false,
      error: { code: 'SESSION_NOT_FOUND', message: 'The owning browser session is not active in this renderer.' }
    })
    return true
  }
  const command = request.command
  if (['show', 'close', 'duplicate', 'move'].includes(command.type)) return false

  let completed = false
  const completeOnce = (completion: Omit<BrowserControlPageCommandCompletion, 'requestId'>) => {
    if (completed) return
    completed = true
    complete(completion)
  }
  const current = controller.state
  if (handleBrowserControlPageNavigationCommand({ complete: completeOnce, controller, request })) return true

  if (command.type === 'list_device_presets') {
    completeOnce({
      ok: true,
      result: {
        page_id: request.pageId,
        presets: controller.devicePresets.map(preset => ({
          id: preset.id,
          label: preset.label,
          ...(preset.height == null ? {} : { height: preset.height }),
          ...(preset.width == null ? {} : { width: preset.width })
        }))
      }
    })
    return true
  }

  if (command.type === 'get_page_view_state') {
    completeOnce({
      ok: true,
      result: {
        active: current.active,
        device_mode: current.deviceMode,
        devtools: { dock_side: current.devtools.dockSide, enabled: current.devtools.enabled },
        page_id: request.pageId,
        panel_page_id: current.panelPageId,
        title: current.title,
        url: current.url
      }
    })
    return true
  }

  if (command.type === 'set_device_mode') {
    const nextState = resolveBrowserControlDeviceMode({
      command,
      current: current.deviceMode,
      presets: controller.devicePresets
    })
    if ('error' in nextState) {
      completeOnce({ ok: false, error: nextState.error })
      return true
    }
    void controller.applyDeviceMode(nextState)
      .then(applied => completeOnce({
        ok: true,
        result: { device_mode: applied, page_id: request.pageId }
      }))
      .catch(error => completeOnce({
        ok: false,
        error: {
          code: 'DEVICE_MODE_UPDATE_FAILED',
          message: error instanceof Error ? error.message : String(error)
        }
      }))
    return true
  }

  if (command.type === 'set_devtools') {
    void controller.applyDevtools({
      enabled: command.enabled,
      ...(command.dock_side == null ? {} : { dockSide: command.dock_side })
    }).then(applied => completeOnce({
      ok: true,
      result: {
        devtools: { dock_side: applied.dockSide, enabled: applied.enabled },
        page_id: request.pageId
      }
    })).catch(error => completeOnce({
      ok: false,
      error: {
        code: 'DEVTOOLS_UPDATE_FAILED',
        message: error instanceof Error ? error.message : String(error)
      }
    }))
    return true
  }

  return false
}
