import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import {
  getBoundsLabel,
  getNodeDisplayLabel,
  maxVisibleElementRows,
  stringifyAttributeValue
} from './mobile-device-preview-utils'
import type { FlattenedElementNode } from './mobile-device-preview-utils'

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
  const visibleNodes = flattenedNodes.slice(0, maxVisibleElementRows)

  return (
    <div className='chat-interaction-panel-mobile-debug__inspect-column'>
      <div className='chat-interaction-panel-mobile-debug__section-title'>
        {t('chat.interactionPanel.mobileDebugElementTree')}
        {elementTree != null && (
          <span className='chat-interaction-panel-mobile-debug__node-count'>{elementTree.nodeCount}</span>
        )}
      </div>
      <div className='chat-interaction-panel-mobile-debug__element-list'>
        {visibleNodes.length === 0
          ? (
            <div className='chat-interaction-panel-mobile-debug__element-empty'>
              {t('chat.interactionPanel.mobileDebugNoElements')}
            </div>
          )
          : visibleNodes.map(({ depth, node }) => (
            <button
              key={node.id}
              type='button'
              className={`chat-interaction-panel-mobile-debug__element-row ${
                selectedNodeId === node.id ? 'is-selected' : ''
              }`}
              style={{ '--mobile-debug-node-depth': `${Math.min(depth, 12) * 10}px` } as CSSProperties}
              onClick={() => onSelectNode(node.id)}
            >
              <span className='chat-interaction-panel-mobile-debug__element-label'>
                {getNodeDisplayLabel(node)}
              </span>
              <span className='chat-interaction-panel-mobile-debug__element-type'>
                {node.type.split('.').at(-1)}
              </span>
            </button>
          ))}
      </div>
      <ElementAttributesPanel node={selectedNode} />
    </div>
  )
}

function ElementAttributesPanel({ node }: { node: DesktopMobileElementNode | undefined }) {
  const { t } = useTranslation()
  const attributes = Object.entries(node?.attributes ?? {})
    .filter(([, value]) => value != null && String(value) !== '')
    .slice(0, 48)

  return (
    <div className='chat-interaction-panel-mobile-debug__attributes'>
      <div className='chat-interaction-panel-mobile-debug__section-title'>
        {t('chat.interactionPanel.mobileDebugElementAttributes')}
      </div>
      {node == null
        ? (
          <div className='chat-interaction-panel-mobile-debug__element-empty'>
            {t('chat.interactionPanel.mobileDebugSelectElement')}
          </div>
        )
        : (
          <>
            <div className='chat-interaction-panel-mobile-debug__attribute-row'>
              <span>type</span>
              <code>{node.type}</code>
            </div>
            {node.bounds != null && (
              <div className='chat-interaction-panel-mobile-debug__attribute-row'>
                <span>bounds</span>
                <code>{getBoundsLabel(node.bounds)}</code>
              </div>
            )}
            {attributes.map(([name, value]) => (
              <div key={name} className='chat-interaction-panel-mobile-debug__attribute-row'>
                <span>{name}</span>
                <code>{stringifyAttributeValue(value)}</code>
              </div>
            ))}
          </>
        )}
    </div>
  )
}
