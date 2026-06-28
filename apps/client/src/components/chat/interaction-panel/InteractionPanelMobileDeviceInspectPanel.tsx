import type { CSSProperties, MouseEvent } from 'react'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { InteractionPanelMobileDeviceElementDetails } from './InteractionPanelMobileDeviceElementDetails'
import { InteractionPanelMobileDeviceLunaDomViewer } from './InteractionPanelMobileDeviceLunaDomViewer'
import type { FlattenedElementNode } from './mobile-device-preview-utils'
import { useMobileDeviceElementSplitter } from './use-mobile-device-element-splitter'

interface ElementPathItem {
  label: string
  node: DesktopMobileElementNode
}

const getElementNodeName = (node: DesktopMobileElementNode) => node.type.split('.').at(-1) ?? node.type

const getElementNodeIndexSuffix = (node: DesktopMobileElementNode) => {
  const rawIndex = node.id.split(':').at(-1)?.split('/').at(-1)
  if (rawIndex == null || !/^\d+$/u.test(rawIndex)) return ''
  return `[${Number(rawIndex) + 1}]`
}

const getElementNodePathSegment = (node: DesktopMobileElementNode) =>
  `${getElementNodeName(node)}${getElementNodeIndexSuffix(node)}`

const getSelectedElementPathItems = (
  flattenedNodes: FlattenedElementNode[],
  selectedNode: DesktopMobileElementNode | undefined,
  selectedNodeId: string | undefined
): ElementPathItem[] => {
  if (selectedNodeId == null) return []

  const pathStack: FlattenedElementNode[] = []
  for (const item of flattenedNodes) {
    pathStack[item.depth] = item
    pathStack.length = item.depth + 1
    if (item.node.id === selectedNodeId) {
      return pathStack.map(pathItem => ({
        label: getElementNodePathSegment(pathItem.node),
        node: pathItem.node
      }))
    }
  }

  return selectedNode == null
    ? []
    : [{
      label: getElementNodePathSegment(selectedNode),
      node: selectedNode
    }]
}

export function InteractionPanelMobileDeviceInspectPanel({
  elementTree,
  flattenedNodes,
  selectedNode,
  selectedNodeId,
  onSelectNode
}: {
  elementTree: DesktopMobileElementTreeResponse | null
  flattenedNodes: FlattenedElementNode[]
  selectedNode: DesktopMobileElementNode | undefined
  selectedNodeId: string | undefined
  onSelectNode: (nodeId: string | undefined) => void
}) {
  const { t } = useTranslation()
  const elementPathAutoScrollRef = useRef(false)
  const elementPathUserScrolledRef = useRef(false)
  const previousSelectedElementPathRef = useRef('')
  const elementPathValueRef = useRef<HTMLSpanElement>(null)
  const {
    elementDetailsColumn,
    elementListColumn,
    handleSplitterKeyDown,
    handleSplitterPointerDown,
    inspectWorkspaceRef
  } = useMobileDeviceElementSplitter()
  const selectedElementPathItems = useMemo(
    () => getSelectedElementPathItems(flattenedNodes, selectedNode, selectedNodeId),
    [flattenedNodes, selectedNode, selectedNodeId]
  )
  const selectedElementPath = useMemo(
    () => selectedElementPathItems.map(item => item.label).join(' > '),
    [selectedElementPathItems]
  )

  useLayoutEffect(() => {
    if (previousSelectedElementPathRef.current !== selectedElementPath) {
      previousSelectedElementPathRef.current = selectedElementPath
      elementPathUserScrolledRef.current = false
    }

    const element = elementPathValueRef.current
    if (element == null || selectedElementPath === '' || elementPathUserScrolledRef.current) return

    elementPathAutoScrollRef.current = true
    element.scrollLeft = element.scrollWidth
    const frameId = window.requestAnimationFrame(() => {
      elementPathAutoScrollRef.current = false
    })

    return () => {
      window.cancelAnimationFrame(frameId)
      elementPathAutoScrollRef.current = false
    }
  }, [selectedElementPath])

  const handleElementListClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!(event.target instanceof Element)) return
    if (event.target.closest('.chat-interaction-panel-mobile-debug__element-row') != null) return
    if (event.target.closest('.luna-dom-viewer-tree-item') != null) return
    if (event.target.closest('.chat-interaction-panel-mobile-debug__element-path-bar') != null) return
    onSelectNode(undefined)
  }
  const handleElementPathScroll = () => {
    if (elementPathAutoScrollRef.current) return
    elementPathUserScrolledRef.current = true
  }

  return (
    <div className='chat-interaction-panel-mobile-debug__inspect-column'>
      <div
        ref={inspectWorkspaceRef}
        className='chat-interaction-panel-mobile-debug__inspect-workspace'
        style={elementListColumn == null || elementDetailsColumn == null
          ? undefined
          : {
            '--mobile-debug-element-details-column': elementDetailsColumn,
            '--mobile-debug-element-list-column': elementListColumn
          } as CSSProperties}
      >
        <div className='chat-interaction-panel-mobile-debug__element-list' onClick={handleElementListClick}>
          <div className='chat-interaction-panel-mobile-debug__element-tree-scroll'>
            {elementTree?.root == null
              ? (
                <div className='chat-interaction-panel-mobile-debug__element-empty'>
                  {t('chat.interactionPanel.mobileDebugNoElements')}
                </div>
              )
              : (
                <InteractionPanelMobileDeviceLunaDomViewer
                  rootNode={elementTree.root}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={onSelectNode}
                />
              )}
          </div>
          <div className='chat-interaction-panel-mobile-debug__element-path-bar'>
            <span
              ref={elementPathValueRef}
              className={`chat-interaction-panel-mobile-debug__element-path-value ${
                selectedElementPath === '' ? 'is-empty' : ''
              }`}
              onScroll={handleElementPathScroll}
              tabIndex={selectedElementPath === '' ? undefined : 0}
              title={selectedElementPath}
            >
              {selectedElementPathItems.length === 0
                ? t('chat.interactionPanel.mobileDebugSelectElement')
                : selectedElementPathItems.map((item, index) => (
                  <span
                    key={`${item.node.id}:${index}`}
                    className='chat-interaction-panel-mobile-debug__element-path-item'
                  >
                    {index > 0 && (
                      <span className='chat-interaction-panel-mobile-debug__element-path-separator' aria-hidden='true'>
                        &gt;
                      </span>
                    )}
                    <button
                      type='button'
                      className='chat-interaction-panel-mobile-debug__element-path-node'
                      title={item.label}
                      onClick={() => onSelectNode(item.node.id)}
                    >
                      {item.label}
                    </button>
                  </span>
                ))}
            </span>
          </div>
        </div>
        <div
          className='chat-interaction-panel-mobile-debug__element-splitter'
          role='separator'
          aria-label={t('chat.interactionPanel.mobileDebugResizeElementDetails')}
          aria-orientation='vertical'
          tabIndex={0}
          onKeyDown={handleSplitterKeyDown}
          onPointerDown={handleSplitterPointerDown}
        />
        <InteractionPanelMobileDeviceElementDetails elementTree={elementTree} node={selectedNode} />
      </div>
    </div>
  )
}
