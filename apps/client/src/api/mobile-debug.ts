import { fetchApiJson, jsonHeaders } from './base'

const buildMobileDebugApiUrl = (path: string) => new URL(path, window.location.origin).toString()

export async function listMobileDebugTargets(
  config?: DesktopMobileDebugConfig
): Promise<DesktopMobileDebugTargetsResponse> {
  return fetchApiJson<DesktopMobileDebugTargetsResponse>(buildMobileDebugApiUrl('/api/mobile-debug/targets'), {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(config ?? {})
  })
}

export async function captureMobileDeviceScreenshot(
  deviceId: string
): Promise<DesktopMobileDeviceScreenshotResponse> {
  return fetchApiJson<DesktopMobileDeviceScreenshotResponse>(buildMobileDebugApiUrl('/api/mobile-debug/screenshots'), {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ deviceId }),
    timeoutMs: 6000
  })
}

export async function dumpMobileElementTree(deviceId: string): Promise<DesktopMobileElementTreeResponse> {
  return fetchApiJson<DesktopMobileElementTreeResponse>(buildMobileDebugApiUrl('/api/mobile-debug/elements'), {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ deviceId }),
    timeoutMs: 12000
  })
}

export async function readMobileDeviceLogs(
  deviceId: string,
  lineLimit = 400
): Promise<DesktopMobileDeviceLogsResponse> {
  return fetchApiJson<DesktopMobileDeviceLogsResponse>(buildMobileDebugApiUrl('/api/mobile-debug/logs'), {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ deviceId, lineLimit }),
    timeoutMs: 8000
  })
}

export async function sendMobileDeviceInput(
  deviceId: string,
  input: DesktopMobileDeviceInputEvent
): Promise<{ deviceId: string; sentAt: number }> {
  return fetchApiJson<{ deviceId: string; sentAt: number }>(buildMobileDebugApiUrl('/api/mobile-debug/input'), {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ deviceId, input }),
    timeoutMs: 6000
  })
}

export async function applyMobileDeviceEnvironmentAction(
  deviceId: string,
  action: DesktopMobileDeviceEnvironmentAction
): Promise<DesktopMobileDeviceEnvironmentActionResponse> {
  return fetchApiJson<DesktopMobileDeviceEnvironmentActionResponse>(
    buildMobileDebugApiUrl('/api/mobile-debug/environment'),
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ action, deviceId }),
      timeoutMs: 8000
    }
  )
}
