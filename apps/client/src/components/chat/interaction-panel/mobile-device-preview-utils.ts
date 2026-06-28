/* eslint-disable max-lines -- Mobile preview geometry, tree normalization, and structural merge helpers share one contract. */

import type { CSSProperties, PointerEvent, WheelEvent } from 'react'

export interface FlattenedElementNode {
  depth: number
  node: DesktopMobileElementNode
}

export interface PointerDevicePoint {
  x: number
  y: number
}

export interface MobileDeviceScreenDimensions {
  height?: number
  width?: number
  x?: number
  y?: number
}

export interface ElementCommentTarget {
  ariaLabel: string
  node: DesktopMobileElementNode
  style: CSSProperties
  title: string
}

export const screenshotRefreshDelayMs = 250
export const elementTreeRefreshDelayMs = 1500
export const iosScreenshotRefreshDelayMs = 1400
export const iosElementTreeRefreshDelayMs = 4500
export const dragThresholdPx = 10
export const maxVisibleElementRows = 160

export const getReadyDevice = (devices: DesktopMobileDebugDevice[]) => devices.find(device => device.state === 'device')

export const getDeviceWindowTitle = (device: DesktopMobileDebugDevice) => {
  if (device.platform === 'ios') return `iOS Device - ${device.label}`
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

const areElementBoundsEqual = (
  left: DesktopMobileElementBounds | undefined,
  right: DesktopMobileElementBounds | undefined
) => {
  if (left == null || right == null) return left == null && right == null
  return left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
}

const areElementAttributesEqual = (
  left: DesktopMobileElementNode['attributes'],
  right: DesktopMobileElementNode['attributes']
) => {
  const leftEntries = Object.entries(left)
  const rightEntries = Object.entries(right)
  if (leftEntries.length !== rightEntries.length) return false
  return leftEntries.every(([name, value]) => right[name] === value)
}

const areElementNodeShallowEqual = (
  left: DesktopMobileElementNode,
  right: DesktopMobileElementNode
) =>
  left.id === right.id &&
  left.type === right.type &&
  left.label === right.label &&
  left.source === right.source &&
  areElementBoundsEqual(left.bounds, right.bounds) &&
  areElementAttributesEqual(left.attributes, right.attributes)

export const hasElementNodeId = (
  node: DesktopMobileElementNode | undefined,
  nodeId: string
): boolean => {
  if (node == null) return false
  if (node.id === nodeId) return true
  return node.children.some(child => hasElementNodeId(child, nodeId))
}

export const mergeElementNodeTree = (
  currentNode: DesktopMobileElementNode | undefined,
  nextNode: DesktopMobileElementNode
): DesktopMobileElementNode => {
  if (currentNode == null || currentNode.id !== nextNode.id) return nextNode

  const currentChildById = new Map(currentNode.children.map(child => [child.id, child]))
  let childrenChanged = currentNode.children.length !== nextNode.children.length
  const children = nextNode.children.map((nextChild, index) => {
    const mergedChild = mergeElementNodeTree(currentChildById.get(nextChild.id), nextChild)
    if (mergedChild !== currentNode.children[index]) childrenChanged = true
    return mergedChild
  })

  if (!childrenChanged && areElementNodeShallowEqual(currentNode, nextNode)) {
    return currentNode
  }

  return {
    ...nextNode,
    children
  }
}

export const containsPoint = (bounds: DesktopMobileElementBounds | undefined, point: PointerDevicePoint) => {
  if (bounds == null || bounds.width <= 0 || bounds.height <= 0) return false
  return point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
}

const getBooleanAttribute = (node: DesktopMobileElementNode, name: string) => {
  const value = node.attributes[name]
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return undefined
  const normalizedValue = value.trim().toLowerCase()
  if (normalizedValue === 'true') return true
  if (normalizedValue === 'false') return false
  return undefined
}

const hasNonEmptyAttribute = (node: DesktopMobileElementNode, name: string) => {
  const value = node.attributes[name]
  return typeof value === 'string' && value.trim() !== ''
}

const isGenericContainerNode = (node: DesktopMobileElementNode) =>
  node.type === 'hierarchy' ||
  node.type === 'AppiumAUT' ||
  node.type === 'XCUIElementTypeApplication' ||
  node.type === 'XCUIElementTypeWindow' ||
  node.type === 'XCUIElementTypeOther' ||
  node.type === 'XCUIElementTypeWebView'

const hasSemanticElementContent = (node: DesktopMobileElementNode) =>
  (node.label != null && node.label.trim() !== '') ||
  hasNonEmptyAttribute(node, 'text') ||
  hasNonEmptyAttribute(node, 'content-desc') ||
  hasNonEmptyAttribute(node, 'resource-id') ||
  hasNonEmptyAttribute(node, 'name') ||
  hasNonEmptyAttribute(node, 'label') ||
  hasNonEmptyAttribute(node, 'value')

const isInteractiveElement = (node: DesktopMobileElementNode) =>
  getBooleanAttribute(node, 'clickable') === true ||
  getBooleanAttribute(node, 'long-clickable') === true ||
  getBooleanAttribute(node, 'checkable') === true ||
  getBooleanAttribute(node, 'focusable') === true ||
  getBooleanAttribute(node, 'scrollable') === true ||
  getBooleanAttribute(node, 'hittable') === true ||
  getBooleanAttribute(node, 'accessible') === true ||
  [
    'XCUIElementTypeButton',
    'XCUIElementTypeCell',
    'XCUIElementTypeLink',
    'XCUIElementTypeSearchField',
    'XCUIElementTypeSecureTextField',
    'XCUIElementTypeSlider',
    'XCUIElementTypeSwitch',
    'XCUIElementTypeTabBar',
    'XCUIElementTypeTextField'
  ].includes(node.type)

const isLargeGenericContainerNode = (node: DesktopMobileElementNode) =>
  isGenericContainerNode(node) &&
  node.bounds != null &&
  node.bounds.width >= 180 &&
  node.bounds.height >= 180

export const isInspectableHitTestNode = (node: DesktopMobileElementNode) => {
  if (isLargeGenericContainerNode(node)) return false
  if (
    getBooleanAttribute(node, 'visible') === false &&
    !isInteractiveElement(node) &&
    !hasSemanticElementContent(node)
  ) return false
  if (isInteractiveElement(node)) return true
  if (isGenericContainerNode(node)) return true
  if (hasSemanticElementContent(node)) return true
  if (node.children.length === 0) return true
  return true
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
  return isInspectableHitTestNode(node) ? node : undefined
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
  screen: MobileDeviceScreenDimensions
): CSSProperties => ({
  height: `${bounds.height / Math.max(1, screen.height ?? bounds.height) * 100}%`,
  left: `${(bounds.x - (screen.x ?? 0)) / Math.max(1, screen.width ?? bounds.width) * 100}%`,
  top: `${(bounds.y - (screen.y ?? 0)) / Math.max(1, screen.height ?? bounds.height) * 100}%`,
  width: `${bounds.width / Math.max(1, screen.width ?? bounds.width) * 100}%`
})

const getElementCommentTargetLabel = (node: DesktopMobileElementNode) => {
  const labelParts = [getNodeDisplayLabel(node)]
  const boundsLabel = getBoundsLabel(node.bounds)
  if (node.type !== labelParts[0]) labelParts.push(node.type)
  if (boundsLabel !== '') labelParts.push(boundsLabel)
  return labelParts.join(' ')
}

const getVisibleScreenBounds = (
  screen: MobileDeviceScreenDimensions,
  fallback: DesktopMobileElementBounds | undefined
): DesktopMobileElementBounds | undefined => {
  const width = screen.width ?? fallback?.width
  const height = screen.height ?? fallback?.height
  if (width == null || height == null || width <= 0 || height <= 0) return undefined
  return {
    height,
    width,
    x: screen.x ?? fallback?.x ?? 0,
    y: screen.y ?? fallback?.y ?? 0
  }
}

const intersectsVisibleScreen = (
  bounds: DesktopMobileElementBounds,
  screen: MobileDeviceScreenDimensions
) => {
  const visibleBounds = getVisibleScreenBounds(screen, undefined)
  if (visibleBounds == null) return true
  return bounds.x + bounds.width > visibleBounds.x &&
    bounds.x < visibleBounds.x + visibleBounds.width &&
    bounds.y + bounds.height > visibleBounds.y &&
    bounds.y < visibleBounds.y + visibleBounds.height
}

export const getElementCommentTargets = (
  root: DesktopMobileElementNode | undefined,
  screen: MobileDeviceScreenDimensions | null
): ElementCommentTarget[] => {
  if (root == null || screen == null) return []
  const rootTitle = getElementCommentTargetLabel(root)
  const visibleScreenBounds = getVisibleScreenBounds(screen, root.bounds)
  const rootTarget = visibleScreenBounds == null
    ? []
    : [{
      ariaLabel: rootTitle,
      node: root,
      style: {
        ...getOverlayStyle(visibleScreenBounds, screen),
        zIndex: 3
      },
      title: rootTitle
    }]
  const nodeTargets = flattenElementNodes(root)
    .flatMap(({ depth, node }) => {
      const bounds = node.bounds
      if (bounds == null || !intersectsVisibleScreen(bounds, screen) || !isInspectableHitTestNode(node)) return []
      return [{
        area: bounds.width * bounds.height,
        bounds,
        depth,
        node
      }]
    })
    .sort((first, second) => second.area - first.area || first.depth - second.depth)
    .map(({ bounds, node }, index) => {
      const title = getElementCommentTargetLabel(node)
      return {
        ariaLabel: title,
        node,
        style: {
          ...getOverlayStyle(bounds, screen),
          zIndex: 4 + index
        },
        title
      }
    })
  return [...rootTarget, ...nodeTargets]
}

export const toPointerDevicePoint = (
  event: PointerEvent<HTMLDivElement> | WheelEvent<HTMLDivElement>,
  screen: MobileDeviceScreenDimensions
): PointerDevicePoint => {
  const rect = event.currentTarget.getBoundingClientRect()
  const width = screen.width ?? rect.width
  const height = screen.height ?? rect.height
  return {
    x: Math.max(0, Math.min(width, Math.round((event.clientX - rect.left) / rect.width * width))),
    y: Math.max(0, Math.min(height, Math.round((event.clientY - rect.top) / rect.height * height)))
  }
}

const toPhysicalInputCoordinate = ({
  rootBounds,
  screen,
  shouldScale,
  value,
  axis
}: {
  axis: 'x' | 'y'
  rootBounds: DesktopMobileElementBounds | undefined
  screen: MobileDeviceScreenDimensions | undefined
  shouldScale: boolean
  value: number | undefined
}) => {
  if (
    !shouldScale ||
    value == null ||
    screen == null ||
    rootBounds == null ||
    rootBounds.width <= 0 ||
    rootBounds.height <= 0
  ) {
    return value
  }

  const sourceSize = axis === 'x' ? screen.width : screen.height
  const targetSize = axis === 'x' ? rootBounds.width : rootBounds.height
  if (sourceSize == null || sourceSize <= 0) return value
  return Math.round(value / sourceSize * targetSize)
}

export const toPhysicalMobileDevicePoint = (
  point: PointerDevicePoint,
  options: {
    rootBounds: DesktopMobileElementBounds | undefined
    screen: MobileDeviceScreenDimensions | undefined
    shouldScale: boolean
  }
): PointerDevicePoint => ({
  x: toPhysicalInputCoordinate({ ...options, axis: 'x', value: point.x }) ?? point.x,
  y: toPhysicalInputCoordinate({ ...options, axis: 'y', value: point.y }) ?? point.y
})

export const withPhysicalMobileDeviceInput = (
  input: DesktopMobileDeviceInputEvent,
  options: {
    rootBounds: DesktopMobileElementBounds | undefined
    screen: MobileDeviceScreenDimensions | undefined
    shouldScale: boolean
  }
): DesktopMobileDeviceInputEvent => ({
  ...input,
  physicalEndX: toPhysicalInputCoordinate({ ...options, axis: 'x', value: input.endX }),
  physicalEndY: toPhysicalInputCoordinate({ ...options, axis: 'y', value: input.endY }),
  physicalX: toPhysicalInputCoordinate({ ...options, axis: 'x', value: input.x }),
  physicalY: toPhysicalInputCoordinate({ ...options, axis: 'y', value: input.y })
})
