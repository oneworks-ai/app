import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { stringifyAttributeValue } from './mobile-device-preview-utils'

type ElementDetailTabKey = 'overview' | 'attributes' | 'bounds'
type ElementDetailValue = string | number | boolean | null
type ElementDetailRow = readonly [string, ElementDetailValue]

const elementDetailTabs: Array<{ key: ElementDetailTabKey; labelKey: string }> = [
  { key: 'overview', labelKey: 'mobileDebugElementOverview' },
  { key: 'attributes', labelKey: 'mobileDebugElementAttributes' },
  { key: 'bounds', labelKey: 'mobileDebugElementBounds' }
]

const stateAttributeNames = [
  'clickable',
  'enabled',
  'focused',
  'selected',
  'checked',
  'scrollable',
  'long-clickable'
]

const getElementNodeName = (node: DesktopMobileElementNode) => node.type.split('.').at(-1) ?? node.type

const getAttributeString = (node: DesktopMobileElementNode, name: string) => {
  const value = node.attributes[name]
  return value == null || String(value).trim() === '' ? undefined : stringifyAttributeValue(value)
}

const compactDetailRows = (
  rows: Array<readonly [string, ElementDetailValue | undefined]>
): ElementDetailRow[] => rows.filter((row): row is ElementDetailRow => row[1] != null && String(row[1]) !== '')

const getElementStateRows = (node: DesktopMobileElementNode): ElementDetailRow[] =>
  compactDetailRows(stateAttributeNames.map(name => [name, node.attributes[name]] as const))

const getOverviewRows = (
  node: DesktopMobileElementNode,
  elementTree: DesktopMobileElementTreeResponse | null
) =>
  compactDetailRows([
    ['node', getElementNodeName(node)],
    ['type', node.type],
    ['resource-id', getAttributeString(node, 'resource-id')],
    ['text', getAttributeString(node, 'text')],
    ['content-desc', getAttributeString(node, 'content-desc')],
    ['package', getAttributeString(node, 'package')],
    ['children', node.children.length],
    ...(elementTree == null ? [] : [['nodes', elementTree.nodeCount] as const]),
    ...getElementStateRows(node)
  ])

const getBoundsRows = (node: DesktopMobileElementNode | undefined): ElementDetailRow[] =>
  node?.bounds == null
    ? []
    : [
      ['x', node.bounds.x],
      ['y', node.bounds.y],
      ['width', node.bounds.width],
      ['height', node.bounds.height],
      ['right', node.bounds.x + node.bounds.width],
      ['bottom', node.bounds.y + node.bounds.height],
      ['center-x', Math.round(node.bounds.x + node.bounds.width / 2)],
      ['center-y', Math.round(node.bounds.y + node.bounds.height / 2)]
    ]

const getAttributeRows = (node: DesktopMobileElementNode | undefined): ElementDetailRow[] =>
  Object.entries(node?.attributes ?? {})
    .filter((row): row is ElementDetailRow => row[1] != null && String(row[1]) !== '')
    .slice(0, 48)

export function InteractionPanelMobileDeviceElementDetails({
  elementTree,
  node
}: {
  elementTree: DesktopMobileElementTreeResponse | null
  node: DesktopMobileElementNode | undefined
}) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<ElementDetailTabKey>('overview')
  const rows = node == null
    ? []
    : activeTab === 'overview'
    ? getOverviewRows(node, elementTree)
    : activeTab === 'bounds'
    ? getBoundsRows(node)
    : getAttributeRows(node)

  return (
    <div className='chat-interaction-panel-mobile-debug__element-details'>
      <div
        className='chat-interaction-panel-mobile-debug__element-detail-tabs'
        role='tablist'
        aria-label={t('chat.interactionPanel.mobileDebugElementDetails')}
      >
        {elementDetailTabs.map(tab => (
          <button
            key={tab.key}
            type='button'
            role='tab'
            id={`mobile-debug-element-detail-tab-${tab.key}`}
            aria-selected={activeTab === tab.key}
            aria-controls={`mobile-debug-element-detail-panel-${tab.key}`}
            className={`chat-interaction-panel-mobile-debug__element-detail-tab ${
              activeTab === tab.key ? 'is-active' : ''
            }`}
            onClick={() => setActiveTab(tab.key)}
          >
            {t(`chat.interactionPanel.${tab.labelKey}`)}
          </button>
        ))}
      </div>
      <div
        className='chat-interaction-panel-mobile-debug__element-detail-panel'
        role='tabpanel'
        id={`mobile-debug-element-detail-panel-${activeTab}`}
        aria-labelledby={`mobile-debug-element-detail-tab-${activeTab}`}
      >
        {node == null
          ? (
            <div className='chat-interaction-panel-mobile-debug__element-empty'>
              {t('chat.interactionPanel.mobileDebugSelectElement')}
            </div>
          )
          : (
            <ElementDetailRows rows={rows} />
          )}
      </div>
    </div>
  )
}

function ElementDetailRows({ rows }: { rows: ElementDetailRow[] }) {
  const { t } = useTranslation()

  if (rows.length === 0) {
    return (
      <div className='chat-interaction-panel-mobile-debug__element-empty'>
        {t('chat.interactionPanel.mobileDebugNotAvailable')}
      </div>
    )
  }

  return (
    <div className='chat-interaction-panel-mobile-debug__attribute-list'>
      {rows.map(([name, value]) => (
        <div key={name} className='chat-interaction-panel-mobile-debug__attribute-row'>
          <span>{name}</span>
          <code>{stringifyAttributeValue(value)}</code>
        </div>
      ))}
    </div>
  )
}
