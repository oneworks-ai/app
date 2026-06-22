import type { CSSProperties, PointerEvent } from 'react'

export interface FlattenedElementNode {
  depth: number
  node: DesktopMobileElementNode
}

export interface PointerDevicePoint {
  x: number
  y: number
}

export const screenshotRefreshMs = 1400
export const dragThresholdPx = 10
export const maxVisibleElementRows = 160

export const getReadyDevice = (devices: DesktopMobileDebugDevice[]) => devices.find(device => device.state === 'device')

export const getDeviceWindowTitle = (device: DesktopMobileDebugDevice) => {
  const emulatorPort = /^emulator-(\d+)$/u.exec(device.id)?.[1]
  const deviceKind = emulatorPort == null ? 'Android Device' : 'Android Emulator'
  return `${deviceKind} - ${device.label}:${emulatorPort ?? device.id}`
}

export const flattenElementNodes = (
  node: DesktopMobileElementNode | undefined,
  depth = 0,
  result: FlattenedElementNode[] = []
) => {
  if (node == null) return result
  result.push({ depth, node })
  for (const child of node.children) {
    flattenElementNodes(child, depth + 1, result)
  }
  return result
}

export const containsPoint = (bounds: DesktopMobileElementBounds | undefined, point: PointerDevicePoint) => {
  if (bounds == null || bounds.width <= 0 || bounds.height <= 0) return false
  return point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
}

export const findDeepestNodeAtPoint = (
  node: DesktopMobileElementNode | undefined,
  point: PointerDevicePoint
): DesktopMobileElementNode | undefined => {
  if (node == null || !containsPoint(node.bounds, point)) return undefined
  for (let index = node.children.length - 1; index >= 0; index -= 1) {
    const childMatch = findDeepestNodeAtPoint(node.children[index], point)
    if (childMatch != null) return childMatch
  }
  return node
}

export const getNodeDisplayLabel = (node: DesktopMobileElementNode) => {
  if (node.label != null && node.label.trim() !== '') return node.label
  const resourceId = node.attributes['resource-id']
  if (typeof resourceId === 'string' && resourceId.trim() !== '') return resourceId
  return node.type.split('.').at(-1) ?? node.type
}

export const getBoundsLabel = (bounds: DesktopMobileElementBounds | undefined) =>
  bounds == null
    ? ''
    : `${bounds.x},${bounds.y} ${bounds.width}x${bounds.height}`

export const stringifyAttributeValue = (value: string | number | boolean | null) => {
  if (value == null) return 'null'
  return String(value)
}

export const getOverlayStyle = (
  bounds: DesktopMobileElementBounds,
  screenshot: DesktopMobileDeviceScreenshotResponse
): CSSProperties => ({
  height: `${bounds.height / Math.max(1, screenshot.height ?? bounds.height) * 100}%`,
  left: `${bounds.x / Math.max(1, screenshot.width ?? bounds.width) * 100}%`,
  top: `${bounds.y / Math.max(1, screenshot.height ?? bounds.height) * 100}%`,
  width: `${bounds.width / Math.max(1, screenshot.width ?? bounds.width) * 100}%`
})

export const toPointerDevicePoint = (
  event: PointerEvent<HTMLDivElement>,
  screenshot: DesktopMobileDeviceScreenshotResponse
): PointerDevicePoint => {
  const rect = event.currentTarget.getBoundingClientRect()
  const width = screenshot.width ?? rect.width
  const height = screenshot.height ?? rect.height
  return {
    x: Math.max(0, Math.min(width, Math.round((event.clientX - rect.left) / rect.width * width))),
    y: Math.max(0, Math.min(height, Math.round((event.clientY - rect.top) / rect.height * height)))
  }
}
