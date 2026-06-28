/* eslint-disable max-lines -- Luna DOM viewer adapter keeps synthetic DOM patching, selection, and expansion state together. */

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import type { MouseEvent } from 'react'

import 'luna-dom-viewer/luna-dom-viewer.css'
import type LunaDomViewer from 'luna-dom-viewer'
import LunaDomViewerReact from 'luna-dom-viewer/react'

interface SyntheticDomTree {
  childNodeIdsById: Map<string, string[]>
  document: XMLDocument
  key: string
  nodeById: Map<string, Element>
  nodeIdByElement: WeakMap<Node, string>
  parentNodeIdById: Map<string, string | undefined>
  root: Element
}

type LunaDomViewerRuntime = LunaDomViewer & {
  $tag?: {
    get: (index: number) => HTMLElement | undefined
  }
  childNodeDomViewers?: LunaDomViewerRuntime[]
  endTagDomViewer?: LunaDomViewerRuntime
  expand: () => void
  getOption?: (name: string) => unknown
  isExpanded?: boolean
  toggle: () => void
}

let nextSyntheticDomTreeKey = 0

const validXmlNamePattern = /^[A-Za-z_][\w.-]*$/u

const toSyntheticTagName = (type: string) => {
  const trimmedType = type.trim()
  if (validXmlNamePattern.test(trimmedType)) return trimmedType
  const fallbackName = trimmedType
    .split('.')
    .at(-1)
    ?.replace(/[^\w.-]/gu, '-')
    .replace(/^[^A-Za-z_]+/u, '') ?? ''
  return validXmlNamePattern.test(fallbackName) ? fallbackName : 'node'
}

const setSyntheticAttribute = (element: Element, name: string, value: string | number | boolean | null | undefined) => {
  if (value == null || value === '') return
  if (!validXmlNamePattern.test(name)) return
  try {
    element.setAttribute(name, String(value))
  } catch {
    // Some platform attributes are not valid XML names. Dropping them keeps the viewer stable.
  }
}

const getBoundsLabel = (bounds: DesktopMobileElementBounds | undefined) =>
  bounds == null ? undefined : `${bounds.x},${bounds.y} ${bounds.width}x${bounds.height}`

const collectSyntheticAttributes = (node: DesktopMobileElementNode) => {
  const attributes = new Map<string, string>()
  const setAttribute = (name: string, value: string | number | boolean | null | undefined) => {
    if (value == null || value === '') return
    if (!validXmlNamePattern.test(name)) return
    attributes.set(name, String(value))
  }

  const tagName = toSyntheticTagName(node.type)
  if (tagName !== node.type) setAttribute('type', node.type)
  setAttribute('label', node.label)
  setAttribute('bounds', getBoundsLabel(node.bounds))
  setAttribute('source', node.source)
  for (const [name, value] of Object.entries(node.attributes)) {
    setAttribute(name, value)
  }
  return attributes
}

const syncSyntheticAttributes = (element: Element, node: DesktopMobileElementNode) => {
  const nextAttributes = collectSyntheticAttributes(node)
  for (const attribute of Array.from(element.attributes)) {
    if (!nextAttributes.has(attribute.name)) element.removeAttribute(attribute.name)
  }
  for (const [name, value] of nextAttributes) {
    if (element.getAttribute(name) !== value) {
      setSyntheticAttribute(element, name, value)
    }
  }
}

const populateSyntheticElement = (
  document: XMLDocument,
  element: Element,
  node: DesktopMobileElementNode,
  syntheticTree: SyntheticDomTree,
  parentNodeId: string | undefined
) => {
  syntheticTree.nodeById.set(node.id, element)
  syntheticTree.nodeIdByElement.set(element, node.id)
  syntheticTree.parentNodeIdById.set(node.id, parentNodeId)
  if (parentNodeId != null) {
    const siblingIds = syntheticTree.childNodeIdsById.get(parentNodeId) ?? []
    siblingIds.push(node.id)
    syntheticTree.childNodeIdsById.set(parentNodeId, siblingIds)
  }

  syncSyntheticAttributes(element, node)

  for (const childNode of node.children) {
    const childElement = document.createElement(toSyntheticTagName(childNode.type))
    populateSyntheticElement(document, childElement, childNode, syntheticTree, node.id)
    element.appendChild(childElement)
  }
}

const buildSyntheticDomTree = (rootNode: DesktopMobileElementNode): SyntheticDomTree => {
  const document = window.document.implementation.createDocument('', toSyntheticTagName(rootNode.type))
  const syntheticTree: SyntheticDomTree = {
    childNodeIdsById: new Map(),
    document,
    key: String(nextSyntheticDomTreeKey += 1),
    nodeById: new Map(),
    nodeIdByElement: new WeakMap(),
    parentNodeIdById: new Map(),
    root: document.documentElement
  }
  populateSyntheticElement(document, syntheticTree.root, rootNode, syntheticTree, undefined)
  return syntheticTree
}

interface SyntheticDomTreePatchContext {
  childNodeIdsById: Map<string, string[]>
  nodeById: Map<string, Element>
  nodeIdByElement: WeakMap<Node, string>
  previousNodeIdByElement: WeakMap<Node, string>
  parentNodeIdById: Map<string, string | undefined>
}

const patchSyntheticElement = (
  element: Element,
  node: DesktopMobileElementNode,
  syntheticTree: SyntheticDomTree,
  context: SyntheticDomTreePatchContext,
  parentNodeId: string | undefined
) => {
  context.nodeById.set(node.id, element)
  context.nodeIdByElement.set(element, node.id)
  context.parentNodeIdById.set(node.id, parentNodeId)
  if (parentNodeId != null) {
    const siblingIds = context.childNodeIdsById.get(parentNodeId) ?? []
    siblingIds.push(node.id)
    context.childNodeIdsById.set(parentNodeId, siblingIds)
  }
  syncSyntheticAttributes(element, node)

  const currentChildren = Array.from(element.children)
  const currentChildByNodeId = new Map<string, Element>()
  for (const currentChild of currentChildren) {
    const currentChildNodeId = context.previousNodeIdByElement.get(currentChild)
    if (currentChildNodeId != null && !currentChildByNodeId.has(currentChildNodeId)) {
      currentChildByNodeId.set(currentChildNodeId, currentChild)
    }
  }

  const nextChildElements: Element[] = []
  for (const childNode of node.children) {
    const childTagName = toSyntheticTagName(childNode.type)
    const currentChild = currentChildByNodeId.get(childNode.id)
    const childElement = currentChild?.tagName === childTagName
      ? currentChild
      : syntheticTree.document.createElement(childTagName)
    patchSyntheticElement(childElement, childNode, syntheticTree, context, node.id)
    nextChildElements.push(childElement)
  }

  for (const [index, childElement] of nextChildElements.entries()) {
    if (element.children[index] !== childElement) {
      element.insertBefore(childElement, element.children[index] ?? null)
    }
  }
  for (const currentChild of Array.from(element.children)) {
    if (!nextChildElements.includes(currentChild)) {
      element.removeChild(currentChild)
    }
  }
}

const patchSyntheticDomTree = (syntheticTree: SyntheticDomTree, rootNode: DesktopMobileElementNode) => {
  const context: SyntheticDomTreePatchContext = {
    childNodeIdsById: new Map(),
    nodeById: new Map(),
    nodeIdByElement: new WeakMap(),
    parentNodeIdById: new Map(),
    previousNodeIdByElement: syntheticTree.nodeIdByElement
  }
  patchSyntheticElement(syntheticTree.root, rootNode, syntheticTree, context, undefined)
  syntheticTree.childNodeIdsById = context.childNodeIdsById
  syntheticTree.nodeById = context.nodeById
  syntheticTree.nodeIdByElement = context.nodeIdByElement
  syntheticTree.parentNodeIdById = context.parentNodeIdById
}

const clearLunaSelection = (container: HTMLElement | null) => {
  const selectedItems = container?.querySelectorAll('.luna-dom-viewer-selected') ?? []
  selectedItems.forEach(item => {
    item.classList.remove('luna-dom-viewer-selected')
    item.removeAttribute('tabindex')
  })
}

const scrollSelectedRowIntoVerticalView = (container: HTMLElement | null) => {
  const selectedRow = container?.querySelector<HTMLElement>('.luna-dom-viewer-selected')
  const scrollContainer = container?.closest<HTMLElement>('.chat-interaction-panel-mobile-debug__element-tree-scroll')
  if (selectedRow == null || scrollContainer == null) return

  const rowTop = selectedRow.offsetTop
  const rowBottom = rowTop + selectedRow.offsetHeight
  const visibleTop = scrollContainer.scrollTop
  const visibleBottom = visibleTop + scrollContainer.clientHeight

  if (rowTop < visibleTop) {
    scrollContainer.scrollTop = rowTop
  } else if (rowBottom > visibleBottom) {
    scrollContainer.scrollTop = rowBottom - scrollContainer.clientHeight
  }
}

const getViewerRow = (viewer: LunaDomViewerRuntime) => viewer.$tag?.get(0)

const findViewerByRow = (
  viewer: LunaDomViewerRuntime | undefined,
  row: HTMLElement
): LunaDomViewerRuntime | undefined => {
  if (viewer == null) return undefined
  if (getViewerRow(viewer) === row) return viewer
  for (const childViewer of viewer.childNodeDomViewers ?? []) {
    const match = findViewerByRow(childViewer, row)
    if (match != null) return match
  }
  return findViewerByRow(viewer.endTagDomViewer, row)
}

const findViewerByNode = (
  viewer: LunaDomViewerRuntime | undefined,
  node: ChildNode
): LunaDomViewerRuntime | undefined => {
  if (viewer == null) return undefined
  if (viewer.getOption?.('node') === node) return viewer
  for (const childViewer of viewer.childNodeDomViewers ?? []) {
    const match = findViewerByNode(childViewer, node)
    if (match != null) return match
  }
  return undefined
}

const getNodeIdFromViewer = (viewer: LunaDomViewerRuntime, syntheticTree: SyntheticDomTree) => {
  const node = viewer.getOption?.('node')
  return node instanceof window.Node ? syntheticTree.nodeIdByElement.get(node) : undefined
}

const removeExpandedNodeId = (
  expandedNodeIds: Set<string>,
  syntheticTree: SyntheticDomTree,
  nodeId: string
) => {
  expandedNodeIds.delete(nodeId)
  for (const childNodeId of syntheticTree.childNodeIdsById.get(nodeId) ?? []) {
    removeExpandedNodeId(expandedNodeIds, syntheticTree, childNodeId)
  }
}

const getNodePathIds = (syntheticTree: SyntheticDomTree, nodeId: string) => {
  const pathIds: string[] = []
  let currentNodeId: string | undefined = nodeId
  while (currentNodeId != null) {
    pathIds.unshift(currentNodeId)
    currentNodeId = syntheticTree.parentNodeIdById.get(currentNodeId)
  }
  return pathIds
}

const restoreExpandedNodeIds = (
  viewer: LunaDomViewerRuntime,
  syntheticTree: SyntheticDomTree,
  expandedNodeIds: Set<string>
) => {
  const expandedNodeIdsByDepth = [...expandedNodeIds]
    .map(nodeId => ({ nodeId, pathIds: getNodePathIds(syntheticTree, nodeId) }))
    .filter(({ nodeId, pathIds }) =>
      syntheticTree.nodeById.has(nodeId) &&
      pathIds.slice(0, -1).every(parentNodeId => expandedNodeIds.has(parentNodeId))
    )
    .sort((left, right) => left.pathIds.length - right.pathIds.length)

  for (const { nodeId, pathIds } of expandedNodeIdsByDepth) {
    for (const pathNodeId of pathIds) {
      const node = syntheticTree.nodeById.get(pathNodeId)
      if (node == null) break
      const nodeViewer = findViewerByNode(viewer, node)
      if (nodeViewer == null) break
      if (pathNodeId === nodeId || expandedNodeIds.has(pathNodeId)) {
        nodeViewer.expand()
      }
    }
  }
}

const selectNodeInViewer = (
  viewer: LunaDomViewerRuntime,
  syntheticTree: SyntheticDomTree,
  selectedNodeId: string | undefined
) => {
  if (selectedNodeId == null) return false
  const selectedElement = syntheticTree.nodeById.get(selectedNodeId)
  if (selectedElement == null) return false
  viewer.select(selectedElement)
  return true
}

export function InteractionPanelMobileDeviceLunaDomViewer({
  rootNode,
  selectedNodeId,
  onSelectNode
}: {
  rootNode: DesktopMobileElementNode
  selectedNodeId: string | undefined
  onSelectNode: (nodeId: string | undefined) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<LunaDomViewerRuntime>()
  const viewerTreeKeyRef = useRef<string>()
  const expandedNodeIdsRef = useRef(new Set<string>())
  const syntheticTreeRef = useRef<SyntheticDomTree>()
  const rootTagName = toSyntheticTagName(rootNode.type)
  let syntheticTree = syntheticTreeRef.current
  if (syntheticTree == null || syntheticTree.root.tagName !== rootTagName) {
    syntheticTree = buildSyntheticDomTree(rootNode)
    syntheticTreeRef.current = syntheticTree
  }
  if (viewerTreeKeyRef.current !== syntheticTree.key) {
    viewerTreeKeyRef.current = syntheticTree.key
    viewerRef.current = undefined
  }
  const handleCreate = useCallback((viewer: LunaDomViewer) => {
    const runtimeViewer = viewer as LunaDomViewerRuntime
    viewerRef.current = runtimeViewer
    restoreExpandedNodeIds(runtimeViewer, syntheticTree, expandedNodeIdsRef.current)
    selectNodeInViewer(runtimeViewer, syntheticTree, selectedNodeId)
  }, [selectedNodeId, syntheticTree])
  const handleSelect = useCallback((element: Node) => {
    onSelectNode(syntheticTree.nodeIdByElement.get(element))
  }, [onSelectNode, syntheticTree])
  const handleTreeClickCapture = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const target = event.target
    const container = containerRef.current
    const rootViewer = viewerRef.current
    if (!(target instanceof Element) || container == null || rootViewer == null) return
    const row = target.closest<HTMLElement>('.luna-dom-viewer-tree-item')
    if (row == null || !container.contains(row)) return

    const viewer = findViewerByRow(rootViewer, row)
    if (viewer == null || viewer.getOption?.('isEndTag') === true) return

    event.preventDefault()
    event.stopPropagation()

    viewer.select()
    const nodeId = getNodeIdFromViewer(viewer, syntheticTree)
    onSelectNode(nodeId)

    if (nodeId == null || (syntheticTree.childNodeIdsById.get(nodeId)?.length ?? 0) === 0) return

    const shouldExpand = viewer.isExpanded !== true
    viewer.toggle()
    if (shouldExpand) {
      expandedNodeIdsRef.current.add(nodeId)
    } else {
      removeExpandedNodeId(expandedNodeIdsRef.current, syntheticTree, nodeId)
    }
  }, [onSelectNode, syntheticTree])

  useLayoutEffect(() => {
    patchSyntheticDomTree(syntheticTree, rootNode)
    const viewer = viewerRef.current
    if (viewer == null) return
    restoreExpandedNodeIds(viewer, syntheticTree, expandedNodeIdsRef.current)
    selectNodeInViewer(viewer, syntheticTree, selectedNodeId)
  }, [rootNode, selectedNodeId, syntheticTree])

  useEffect(() => {
    const viewer = viewerRef.current
    const container = containerRef.current
    if (viewer == null) return

    if (selectedNodeId == null) {
      clearLunaSelection(container)
      return
    }

    if (!selectNodeInViewer(viewer, syntheticTree, selectedNodeId)) return

    const frameId = window.requestAnimationFrame(() => {
      scrollSelectedRowIntoVerticalView(container)
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [selectedNodeId, syntheticTree])

  useEffect(() => () => {
    viewerRef.current = undefined
  }, [])

  return (
    <div
      ref={containerRef}
      className='chat-interaction-panel-mobile-debug__luna-dom-viewer'
      onClickCapture={handleTreeClickCapture}
    >
      <LunaDomViewerReact
        key={syntheticTree.key}
        hotkey
        lowerCaseTagName={false}
        node={syntheticTree.root}
        observe
        theme='dark'
        onCreate={handleCreate}
        onSelect={handleSelect}
      />
    </div>
  )
}
