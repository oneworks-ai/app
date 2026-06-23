import type { CSSProperties } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { InteractionPanelMobileDeviceElementDetails } from './InteractionPanelMobileDeviceElementDetails'
import { getBoundsLabel, maxVisibleElementRows, stringifyAttributeValue } from './mobile-device-preview-utils'
import type { FlattenedElementNode } from './mobile-device-preview-utils'

const visibleAttributeNames = [
  'resource-id',
  'text',
  'content-desc',
  'clickable',
  'enabled',
  'selected',
  'checked'
]

const getElementNodeName = (node: DesktopMobileElementNode) => node.type.split('.').at(-1) ?? node.type

const getElementNodeAttributes = (node: DesktopMobileElementNode) =>
  visibleAttributeNames
    .map(name => [name, node.attributes[name]] as const)
    .filter(([name, value]) => {
      if (value == null || String(value).trim() === '') return false
      if (typeof value !== 'boolean') return true
      if (name === 'enabled') return !value
      return value
    })
    .slice(0, 4)

function ElementTreeRow({
  depth,
  isCollapsed,
  isSelected,
  node,
  onSelectNode,
  onToggleNode
}: {
  depth: number
  isCollapsed: boolean
  isSelected: boolean
  node: DesktopMobileElementNode
  onSelectNode: (nodeId: string) => void
  onToggleNode: (nodeId: string) => void
}) {
  const nodeName = getElementNodeName(node)
  const attributes = getElementNodeAttributes(node)
  const hasChildren = node.children.length > 0

  return (
    <button
      type='button'
      role='treeitem'
      aria-level={depth + 1}
      aria-expanded={hasChildren ? !isCollapsed : undefined}
      aria-selected={isSelected}
      className={`chat-interaction-panel-mobile-debug__element-row ${isSelected ? 'is-selected' : ''}`}
      style={{ '--mobile-debug-node-depth': `${Math.min(depth, 12) * 14}px` } as CSSProperties}
      onClick={() => onSelectNode(node.id)}
    >
      <span
        className={`chat-interaction-panel-mobile-debug__element-disclosure ${hasChildren ? 'has-children' : ''} ${
          hasChildren && !isCollapsed ? 'is-expanded' : ''
        }`}
        onClick={event => {
          if (!hasChildren) return
          event.stopPropagation()
          onToggleNode(node.id)
        }}
        aria-hidden='true'
      />
      <span className='chat-interaction-panel-mobile-debug__element-source'>
        <span className='chat-interaction-panel-mobile-debug__syntax-punctuation'>&lt;</span>
        <span className='chat-interaction-panel-mobile-debug__syntax-tag'>{nodeName}</span>
        {attributes.map(([name, value]) => (
          <span key={name} className='chat-interaction-panel-mobile-debug__syntax-attribute'>
            <span className='chat-interaction-panel-mobile-debug__syntax-attribute-name'>{name}</span>
            <span className='chat-interaction-panel-mobile-debug__syntax-punctuation'>=</span>
            <span className='chat-interaction-panel-mobile-debug__syntax-attribute-value'>
              "{stringifyAttributeValue(value)}"
            </span>
          </span>
        ))}
        <span className='chat-interaction-panel-mobile-debug__syntax-punctuation'>&gt;</span>
      </span>
      {node.bounds != null && (
        <span className='chat-interaction-panel-mobile-debug__element-bounds'>
          {getBoundsLabel(node.bounds)}
        </span>
      )}
    </button>
  )
}

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
  onSelectNode: (nodeId: string) => void
}) {
  const { t } = useTranslation()
  const [collapsedNodeIds, setCollapsedNodeIds] = useState(() => new Set<string>())
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

  return (
    <div className='chat-interaction-panel-mobile-debug__inspect-column'>
      <div className='chat-interaction-panel-mobile-debug__inspect-workspace'>
        <div className='chat-interaction-panel-mobile-debug__element-list'>
          {visibleNodes.length === 0
            ? (
              <div className='chat-interaction-panel-mobile-debug__element-empty'>
                {t('chat.interactionPanel.mobileDebugNoElements')}
              </div>
            )
            : (
              <div className='chat-interaction-panel-mobile-debug__element-tree' role='tree'>
                {visibleNodes.map(({ depth, node }) => (
                  <ElementTreeRow
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
        <InteractionPanelMobileDeviceElementDetails elementTree={elementTree} node={selectedNode} />
      </div>
    </div>
  )
}
