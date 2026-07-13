export type BrowserControlDeviceType = 'desktop' | 'mobile'

export type BrowserControlViewportZoom = 'auto' | number

export type BrowserControlDevtoolsDockSide = 'bottom' | 'left' | 'right'

export type BrowserControlAgentAction = 'click' | 'press_key' | 'scroll' | 'select' | 'type'

export type BrowserControlAgentActionState =
  | {
    action: BrowserControlAgentAction
    color: string
    operation_id: string
    phase: 'acting' | 'moving'
  }
  | {
    action: BrowserControlAgentAction
    color: string
    operation_id: string
    outcome: 'failed' | 'succeeded'
    phase: 'settle'
  }
  | {
    operation_id: string
    phase: 'idle'
  }

export interface BrowserControlDeviceModeState {
  device_pixel_ratio: number
  device_type: BrowserControlDeviceType
  enabled: boolean
  height: number
  preset_id: string
  width: number
  zoom: BrowserControlViewportZoom
}

export type BrowserControlPageCommand =
  | { type: 'clear_navigation_history' }
  | { type: 'close' }
  | { type: 'duplicate'; placement?: 'bottom' | 'right' }
  | { type: 'get_navigation_entries'; limit: number; offset: number }
  | { type: 'get_navigation_state' }
  | { type: 'get_page_view_state' }
  | { type: 'list_device_presets' }
  | { type: 'move'; placement: 'bottom' | 'right' }
  | { type: 'set_agent_action_state'; state: BrowserControlAgentActionState }
  | { type: 'set_devtools'; dock_side?: BrowserControlDevtoolsDockSide; enabled: boolean }
  | {
    type: 'set_device_mode'
    device_pixel_ratio?: number
    device_type?: BrowserControlDeviceType
    enabled: boolean
    height?: number
    preset_id?: string
    width?: number
    zoom?: BrowserControlViewportZoom
  }
  | { type: 'show' }
  | {
    type: 'sync_navigation_history'
    active_index: number
    current_url: string
    entries: Array<{ title?: string; url: string }>
  }

export interface BrowserControlPageCommandRequest {
  command: BrowserControlPageCommand
  pageId: string
  panelPageId: string
  requestId: string
  sessionId?: string
}

export interface BrowserControlPageCommandCompletion {
  error?: {
    code?: string
    message: string
  }
  ok: boolean
  requestId: string
  result?: unknown
}
