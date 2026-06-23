import type { CSSProperties, MouseEvent } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { InteractionPanelMobileDeviceElementDetails } from './InteractionPanelMobileDeviceElementDetails'
import { InteractionPanelMobileDeviceElementTreeRow } from './InteractionPanelMobileDeviceElementTreeRow'
import { maxVisibleElementRows } from './mobile-device-preview-utils'
import type { FlattenedElementNode } from './mobile-device-preview-utils'
import { useMobileDeviceElementSplitter } from './use-mobile-device-element-splitter'

const getVisibleElementRows = (
  flattenedNodes: FlattenedElementNode[],
  collapsedNodeIds: Set<string>
) => {
  const visibleNodes: FlattenedElementNode[] = []
  let hiddenAncestorDepth: number | undefined

  for (const item of flattenedNodes) {
    if (hiddenAncestorDepth != null) {
      if (item.depth > hiddenAncestorDepth) continue
      hiddenAncestorDepth = undefined
    }

    visibleNodes.push(item)

    if (item.node.children.length > 0 && collapsedNodeIds.has(item.node.id)) {
      hiddenAncestorDepth = item.depth
    }
  }

  return visibleNodes
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
  const [collapsedNodeIds, setCollapsedNodeIds] = useState(() => new Set<string>())
  const {
    elementDetailsColumn,
    elementListColumn,
    handleSplitterKeyDown,
    handleSplitterPointerDown,
    inspectWorkspaceRef
  } = useMobileDeviceElementSplitter()
  const visibleNodes = useMemo(
    () => getVisibleElementRows(flattenedNodes, collapsedNodeIds).slice(0, maxVisibleElementRows),
    [collapsedNodeIds, flattenedNodes]
  )
  const handleToggleNode = (nodeId: string) => {
    setCollapsedNodeIds(previousNodeIds => {
      const nextNodeIds = new Set(previousNodeIds)
      if (nextNodeIds.has(nodeId)) {
        nextNodeIds.delete(nodeId)
      } else {
        nextNodeIds.add(nodeId)
      }
      return nextNodeIds
    })
  }
  const handleElementListClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!(event.target instanceof Element)) return
    if (event.target.closest('.chat-interaction-panel-mobile-debug__element-row') != null) return
    onSelectNode(undefined)
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
          {visibleNodes.length === 0
            ? (
              <div className='chat-interaction-panel-mobile-debug__element-empty'>
                {t('chat.interactionPanel.mobileDebugNoElements')}
              </div>
            )
            : (
              <div className='chat-interaction-panel-mobile-debug__element-tree' role='tree'>
                {visibleNodes.map(({ depth, node }) => (
                  <InteractionPanelMobileDeviceElementTreeRow
                    key={node.id}
                    depth={depth}
                    isCollapsed={collapsedNodeIds.has(node.id)}
                    isSelected={selectedNodeId === node.id}
                    node={node}
                    onSelectNode={onSelectNode}
                    onToggleNode={handleToggleNode}
                  />
                ))}
              </div>
            )}
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
