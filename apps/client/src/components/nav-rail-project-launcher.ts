import { isDesktopClientMode } from '#~/runtime-config'

export const isWebProjectLauncherAvailable = ({
  desktopClientMode = isDesktopClientMode(),
  hasDesktopBridge = window.oneworksDesktop != null
}: {
  desktopClientMode?: boolean
  hasDesktopBridge?: boolean
} = {}) => !desktopClientMode && !hasDesktopBridge
