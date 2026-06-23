import {
  applyMobileDeviceEnvironmentAction as applyMobileDeviceEnvironmentActionFromServer,
  captureMobileDeviceScreenshot as captureMobileDeviceScreenshotFromServer,
  dumpMobileElementTree as dumpMobileElementTreeFromServer,
  listMobileDebugTargets as listMobileDebugTargetsFromServer,
  readMobileDeviceLogs as readMobileDeviceLogsFromServer,
  sendMobileDeviceInput as sendMobileDeviceInputFromServer
} from '#~/api/mobile-debug'

export const listMobileDebugTargets = (config?: DesktopMobileDebugConfig) => (
  window.oneworksDesktop?.listMobileDebugTargets?.(config) ?? listMobileDebugTargetsFromServer(config)
)

export const captureMobileDeviceScreenshot = (deviceId: string) => (
  window.oneworksDesktop?.captureMobileDeviceScreenshot?.(deviceId) ?? captureMobileDeviceScreenshotFromServer(deviceId)
)

export const dumpMobileElementTree = (deviceId: string) => (
  window.oneworksDesktop?.dumpMobileElementTree?.(deviceId) ?? dumpMobileElementTreeFromServer(deviceId)
)

export const readMobileDeviceLogs = (deviceId: string, lineLimit?: number) => (
  readMobileDeviceLogsFromServer(deviceId, lineLimit)
)

export const sendMobileDeviceInput = (deviceId: string, input: DesktopMobileDeviceInputEvent) => (
  window.oneworksDesktop?.sendMobileDeviceInput?.(deviceId, input) ?? sendMobileDeviceInputFromServer(deviceId, input)
)

export const applyMobileDeviceEnvironmentAction = (
  deviceId: string,
  action: DesktopMobileDeviceEnvironmentAction
) => applyMobileDeviceEnvironmentActionFromServer(deviceId, action)
