import './Overlay.scss'

import type { CSSProperties, KeyboardEvent, ReactNode } from 'react'
import { useState } from 'react'

import { OverlayConfirmActions } from './OverlayConfirmActions'
import { OverlayIcon } from './OverlayPrimitives'
import type { OverlayTreeNode } from './overlay-types'
import { mergeClassNames } from './overlay-utils'

const getTreeRowStyle = (depth: number): CSSProperties => ({
  '--oneworks-overlay-tree-depth': depth
} as CSSProperties)

export function OverlayTree<TData = unknown>({
  className,
  collapsedKeys,
  expandAll = false,
  nodes,
  onNodeActivate,
  onNodeToggle
}: {
  className?: string
  collapsedKeys: string[]
  expandAll?: boolean
  nodes: Array<OverlayTreeNode<TData>>
  onNodeActivate?: (node: OverlayTreeNode<TData>) => void
  onNodeToggle: (key: string) => void
}) {
  const [pendingConfirmKey, setPendingConfirmKey] = useState<string | null>(null)
  const collapsedKeySet = new Set(collapsedKeys)
  const activateNode = (node: OverlayTreeNode<TData>) => {
    if (node.disabled === true) return
    if (node.children != null && node.children.length > 0) {
      setPendingConfirmKey(null)
      onNodeToggle(node.key)
      return
    }
    if (node.confirmLabel != null) {
      setPendingConfirmKey(currentKey => currentKey === node.key ? null : node.key)
      return
    }

    setPendingConfirmKey(null)
    onNodeActivate?.(node)
  }
  const handleTreeRowKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    node: OverlayTreeNode<TData>
  ) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    activateNode(node)
  }
  const renderNode = (node: OverlayTreeNode<TData>, depth = 0): ReactNode => {
    const hasChildren = node.children != null && node.children.length > 0
    const expanded = expandAll || !collapsedKeySet.has(node.key)
    const confirming = pendingConfirmKey === node.key
    const icon = hasChildren
      ? expanded
        ? node.expandedIcon ?? node.icon ?? node.collapsedIcon
        : node.collapsedIcon ?? node.icon ?? node.expandedIcon
      : node.icon

    return (
      <div key={node.key} className={mergeClassNames('oneworks-overlay-tree-node', node.className)}>
        <div
          role='treeitem'
          tabIndex={node.disabled === true ? -1 : 0}
          className={mergeClassNames(
            'oneworks-overlay-tree-row',
            'oneworks-overlay-action',
            node.rowClassName,
            node.selected === true && 'is-selected',
            node.disabled === true && 'is-disabled',
            confirming && 'is-confirming',
            hasChildren && 'has-children'
          )}
          title={node.title}
          aria-disabled={node.disabled === true ? true : undefined}
          aria-expanded={hasChildren ? expanded : undefined}
          aria-selected={node.selected === true ? true : undefined}
          style={getTreeRowStyle(depth)}
          onClick={() => activateNode(node)}
          onKeyDown={event => handleTreeRowKeyDown(event, node)}
        >
          <span className='oneworks-overlay-tree-row__main'>
            {icon != null && <OverlayIcon className='oneworks-overlay-tree-row__icon' icon={icon} />}
            <span className='oneworks-overlay-tree-row__content'>
              <span className='oneworks-overlay-tree-row__label'>{confirming ? node.confirmLabel : node.label}</span>
              {node.meta != null && !confirming && <span className='oneworks-overlay-tree-row__meta'>{node.meta}</span>}
            </span>
          </span>
          {confirming
            ? (
              <OverlayConfirmActions
                label={node.label}
                onCancel={() => setPendingConfirmKey(null)}
                onConfirm={() => {
                  setPendingConfirmKey(null)
                  onNodeActivate?.(node)
                }}
              />
            )
            : node.trailing}
        </div>
        {hasChildren && (
          <div
            className={mergeClassNames('oneworks-overlay-tree-collapse', !expanded && 'is-collapsed')}
            aria-hidden={!expanded}
          >
            <div className='oneworks-overlay-tree-collapse__inner'>
              <div className='oneworks-overlay-tree-children'>
                {node.children?.map(child => renderNode(child, depth + 1))}
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={mergeClassNames('oneworks-overlay-tree', className)} role='tree'>
      {nodes.map(node => renderNode(node))}
    </div>
  )
}
