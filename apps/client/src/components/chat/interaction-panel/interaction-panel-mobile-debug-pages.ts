export interface InteractionPanelMobileDebugDeviceOption {
  id: string
  label: string
  state: string
}

export interface InteractionPanelMobileDebugPage {
  deviceOptions?: InteractionPanelMobileDebugDeviceOption[]
  id: string
  mode?: 'config' | 'targets'
  selectedDeviceId?: string
  selectedDeviceLabel?: string
  title: string
}

export const createInteractionPanelMobileDebugPage = (title: string): InteractionPanelMobileDebugPage => ({
  id: `mobile-debug-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  mode: 'targets',
  title
})
