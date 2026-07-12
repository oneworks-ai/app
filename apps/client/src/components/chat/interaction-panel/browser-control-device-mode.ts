import type {
  BrowserControlDeviceModeState,
  BrowserControlPageCommand,
  BrowserControlViewportZoom
} from '@oneworks/types'

export interface BrowserControlDevicePreset {
  height?: number
  id: string
  label: string
  width?: number
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value))

const normalizeZoom = (
  value: BrowserControlViewportZoom | undefined,
  fallback: BrowserControlViewportZoom
): BrowserControlViewportZoom => value == null
  ? fallback
  : value === 'auto'
  ? value
  : clamp(value, 0.25, 2)

export const resolveBrowserControlDeviceMode = ({
  command,
  current,
  presets
}: {
  command: Extract<BrowserControlPageCommand, { type: 'set_device_mode' }>
  current: BrowserControlDeviceModeState
  presets: readonly BrowserControlDevicePreset[]
}): BrowserControlDeviceModeState | { error: { code: string; message: string } } => {
  const preset = command.preset_id == null
    ? undefined
    : presets.find(item => item.id === command.preset_id)
  if (command.preset_id != null && preset == null) {
    return {
      error: {
        code: 'INVALID_DEVICE_PRESET',
        message: `Unknown device preset: ${command.preset_id}`
      }
    }
  }

  const explicitSize = command.width != null || command.height != null
  return {
    device_pixel_ratio: clamp(command.device_pixel_ratio ?? current.device_pixel_ratio, 1, 3),
    device_type: command.device_type ?? current.device_type,
    enabled: command.enabled,
    height: Math.round(clamp(command.height ?? preset?.height ?? current.height, 1, 4096)),
    preset_id: explicitSize ? 'responsive' : preset?.id ?? current.preset_id,
    width: Math.round(clamp(command.width ?? preset?.width ?? current.width, 1, 4096)),
    zoom: normalizeZoom(command.zoom, current.zoom)
  }
}
