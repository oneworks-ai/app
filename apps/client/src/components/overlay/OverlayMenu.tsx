import './Overlay.scss'

import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { OverlayMenuList } from './OverlayMenuList'
import type { OverlayMenuProps } from './overlay-menu-props'
import { getFirstSelectedChildPath, getMenuColumns, hasChildren } from './overlay-menu-utils'
import type { OverlayMenuActionItem } from './overlay-types'
import { mergeClassNames } from './overlay-utils'
import { useOverlayMenuBoundaryOffsets } from './use-overlay-menu-boundary-offsets'
import { useOverlayMenuColumnOffsets } from './use-overlay-menu-column-offsets'

export function OverlayMenu({
  alignSubmenus = true,
  className,
  defaultOpenKeys,
  itemClassName,
  items,
  labelledBy,
  menuClassName,
  multi = false,
  openKeys,
  panelClassName,
  primaryFooter,
  primaryHeader,
  primaryMenuClassName,
  primaryPanelClassName,
  selectedKeys,
  submenuPlacement = 'right',
  submenuTrigger = 'hover',
  surface = false,
  width,
  onItemClick,
  onOpenKeysChange
}: OverlayMenuProps) {
  const selectedKeySet = useMemo(() => new Set(selectedKeys ?? []), [selectedKeys])
  const [uncontrolledOpenKeys, setUncontrolledOpenKeys] = useState(() =>
    defaultOpenKeys ?? getFirstSelectedChildPath(items, selectedKeySet)
  )
  const [pendingConfirmKey, setPendingConfirmKey] = useState<string | null>(null)
  const activeOpenKeys = openKeys ?? uncontrolledOpenKeys
  const columns = getMenuColumns(items, activeOpenKeys, alignSubmenus)
  const renderedColumns = columns.map((column, level) => ({ column, level }))
  if (submenuPlacement === 'left') {
    renderedColumns.reverse()
  }
  const compositeStyle = {
    '--oneworks-overlay-menu-column-count': renderedColumns.length,
    '--oneworks-overlay-menu-column-gap-count': Math.max(renderedColumns.length - 1, 0)
  } as CSSProperties
  const setOpenKeys = (keys: string[]) => {
    if (openKeys == null) {
      setUncontrolledOpenKeys(keys)
    }
    onOpenKeysChange?.(keys)
  }
  const openSubmenu = (level: number, item: OverlayMenuActionItem, options?: { toggle?: boolean }) => {
    if (item.disabled === true) return
    if (!hasChildren(item)) {
      setOpenKeys(activeOpenKeys.slice(0, level))
      return
    }
    if (options?.toggle === true && activeOpenKeys[level] === item.key) {
      setOpenKeys(activeOpenKeys.slice(0, level))
      return
    }
    setOpenKeys([...activeOpenKeys.slice(0, level), item.key])
  }
  const activateItem = (item: OverlayMenuActionItem, level: number) => {
    if (item.disabled === true) return
    if (hasChildren(item)) {
      openSubmenu(level, item)
      return
    }
    if (item.confirmLabel != null) {
      setPendingConfirmKey(currentKey => currentKey === item.key ? null : item.key)
      return
    }

    setPendingConfirmKey(null)
    onItemClick?.(item)
  }
  const confirmItem = (item: OverlayMenuActionItem) => {
    setPendingConfirmKey(null)
    onItemClick?.(item)
  }
  const compositeRef = useRef<HTMLDivElement | null>(null)
  const columnSignature = columns
    .map(column => `${column.activeKey ?? ''}:${column.offsetRows}:${column.items.length}`)
    .join('|')
  const columnOffsets = useOverlayMenuColumnOffsets(compositeRef, columnSignature)
  const columnOffsetSignature = Object.entries(columnOffsets)
    .map(([level, offset]) => `${level}:${offset}`)
    .join('|')
  const boundaryOffsets = useOverlayMenuBoundaryOffsets(
    compositeRef,
    `${columnSignature}|${columnOffsetSignature}`
  )
  useEffect(() => {
    if (submenuTrigger !== 'hover' || activeOpenKeys.length === 0) return

    const handleDocumentPointerMove = (event: PointerEvent) => {
      const composite = compositeRef.current
      if (composite == null) return
      if (event.target instanceof Node && composite.contains(event.target)) return
      setOpenKeys([])
    }

    document.addEventListener('pointermove', handleDocumentPointerMove)
    return () => document.removeEventListener('pointermove', handleDocumentPointerMove)
  }, [activeOpenKeys.length, setOpenKeys, submenuTrigger])

  const handleCompositeMouseLeave = () => {
    if (submenuTrigger === 'hover') {
      setOpenKeys([])
    }
  }
  const handleCompositePointerDownCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (submenuTrigger !== 'click' || activeOpenKeys.length === 0) return
    if (!(event.target instanceof Element)) return
    if (event.target.closest('.oneworks-overlay-menu-column.is-submenu') != null) return
    if (event.target.closest('.oneworks-overlay-action.has-submenu') != null) return

    window.setTimeout(() => setOpenKeys([]), 0)
  }

  return (
    <div
      ref={compositeRef}
      className={mergeClassNames(
        'oneworks-overlay-menu-composite',
        submenuPlacement === 'left' && 'is-submenu-left',
        className
      )}
      style={compositeStyle}
      onMouseLeave={handleCompositeMouseLeave}
      onPointerDownCapture={handleCompositePointerDownCapture}
      onPointerLeave={handleCompositeMouseLeave}
    >
      {renderedColumns.map(({ column, level }) => {
        const boundaryOffset = boundaryOffsets[level] ?? 0
        const alignedColumnOffset = columnOffsets[level]
        const fallbackColumnOffset = column.offsetRows > 0 || boundaryOffset !== 0
          ? `calc(${column.offsetRows} * var(--oneworks-overlay-nested-row-offset) + ${boundaryOffset}px)`
          : undefined
        const columnStyle = {
          '--oneworks-overlay-menu-level': level,
          '--oneworks-overlay-menu-offset-rows': column.offsetRows,
          '--oneworks-overlay-menu-boundary-offset-y': `${boundaryOffset}px`,
          ...(level > 0
            ? {
              marginTop: alignedColumnOffset == null
                ? fallbackColumnOffset
                : `${alignedColumnOffset + boundaryOffset}px`
            }
            : undefined)
        } as CSSProperties

        const resolvedMenuClassName = level === 0 && primaryMenuClassName != null
          ? primaryMenuClassName
          : menuClassName
        const resolvedPanelClassName = level === 0 && primaryPanelClassName != null
          ? primaryPanelClassName
          : panelClassName

        return (
          <div
            key={level}
            data-oneworks-overlay-menu-level={level}
            className={mergeClassNames('oneworks-overlay-menu-column', level > 0 && 'is-submenu')}
            style={columnStyle}
          >
            <OverlayMenuList
              column={column}
              itemClassName={itemClassName}
              labelledBy={labelledBy}
              level={level}
              menuClassName={resolvedMenuClassName}
              multi={multi}
              panelClassName={resolvedPanelClassName}
              pendingConfirmKey={pendingConfirmKey}
              primaryFooter={level === 0 ? primaryFooter : undefined}
              primaryHeader={level === 0 ? primaryHeader : undefined}
              selectedKeySet={selectedKeySet}
              submenuPlacement={submenuPlacement}
              submenuTrigger={submenuTrigger}
              surface={surface}
              width={width}
              onActivateItem={activateItem}
              onConfirmItem={confirmItem}
              onOpenSubmenu={openSubmenu}
              onResetConfirm={() => setPendingConfirmKey(null)}
            />
          </div>
        )
      })}
    </div>
  )
}
