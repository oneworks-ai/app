import type { CSSProperties, KeyboardEvent, ReactNode } from 'react'

import { OverlayConfirmActions } from './OverlayConfirmActions'
import { OverlayDivider, OverlayIcon, OverlayPanel } from './OverlayPrimitives'
import { getSelectedItemIndexes, hasChildren } from './overlay-menu-utils'
import type { OverlayMenuColumn } from './overlay-menu-utils'
import { isOverlayMenuCustom, isOverlayMenuDivider, isOverlayMenuSection } from './overlay-types'
import type { OverlayMenuActionItem, OverlaySubmenuPlacement, OverlaySubmenuTrigger } from './overlay-types'
import { mergeClassNames } from './overlay-utils'

export function OverlayMenuList({
  column,
  itemClassName,
  labelledBy,
  level,
  menuClassName,
  multi,
  panelClassName,
  pendingConfirmKey,
  primaryFooter,
  primaryHeader,
  selectedKeySet,
  submenuPlacement,
  submenuTrigger,
  surface,
  width,
  onActivateItem,
  onConfirmItem,
  onOpenSubmenu,
  onResetConfirm
}: {
  column: OverlayMenuColumn
  itemClassName?: string
  labelledBy?: string
  level: number
  menuClassName?: string
  multi: boolean
  panelClassName?: string
  pendingConfirmKey: string | null
  primaryFooter?: ReactNode
  primaryHeader?: ReactNode
  selectedKeySet: Set<string>
  submenuPlacement: OverlaySubmenuPlacement
  submenuTrigger: OverlaySubmenuTrigger
  surface: boolean
  width?: CSSProperties['width']
  onActivateItem: (item: OverlayMenuActionItem, level: number) => void
  onConfirmItem: (item: OverlayMenuActionItem) => void
  onOpenSubmenu: (level: number, item: OverlayMenuActionItem, options?: { toggle?: boolean }) => void
  onResetConfirm: () => void
}) {
  const selectedIndexes = getSelectedItemIndexes(column.items, selectedKeySet)
  const firstSelectedIndex = selectedIndexes[0]
  const lastSelectedIndex = selectedIndexes[selectedIndexes.length - 1]
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>, item: OverlayMenuActionItem) => {
    if (event.key !== 'Enter' && event.key !== ' ') return

    event.preventDefault()
    if (hasChildren(item)) {
      onOpenSubmenu(level, item)
      return
    }
    onActivateItem(item, level)
  }
  const list = (
    <div
      className={mergeClassNames('oneworks-overlay-menu-list', menuClassName)}
      role='menu'
      aria-labelledby={level === 0 ? labelledBy : undefined}
      style={{ '--oneworks-overlay-menu-width': width } as CSSProperties}
    >
      {column.items.map((item, index) => {
        if (isOverlayMenuDivider(item)) {
          return <OverlayDivider key={item.key} className={item.className} />
        }
        if (isOverlayMenuSection(item)) {
          return (
            <div key={item.key} className={mergeClassNames('oneworks-overlay-menu-section', item.className)}>
              {item.label}
            </div>
          )
        }
        if (isOverlayMenuCustom(item)) {
          return (
            <div
              key={item.key}
              className={mergeClassNames('oneworks-overlay-menu-custom', item.className)}
              onClick={event => item.onClick?.(event)}
            >
              {item.content}
            </div>
          )
        }

        const selected = selectedKeySet.has(item.key) || item.selected === true
        const active = column.activeKey === item.key
        const confirming = pendingConfirmKey === item.key
        const itemHasSubmenu = hasChildren(item)
        const directedPlacement = item.submenuPlacement ?? submenuPlacement
        const submenuOpensLeft = itemHasSubmenu && directedPlacement === 'left'
        const selectedClassName = selected
          ? [
            'is-selected',
            multi ? 'is-selected-chain' : '',
            index === firstSelectedIndex ? 'is-chain-start' : '',
            index === lastSelectedIndex ? 'is-chain-end' : ''
          ].filter(Boolean).join(' ')
          : ''

        return (
          <div
            key={item.key}
            className={mergeClassNames(
              'oneworks-overlay-menu-item',
              'oneworks-overlay-action',
              itemClassName,
              item.className,
              itemHasSubmenu && 'has-submenu',
              item.description != null && 'has-description',
              active && 'is-active',
              confirming && 'is-confirming',
              selectedClassName,
              item.disabled === true && 'is-disabled',
              item.tone === 'danger' && 'is-danger'
            )}
            style={item.style}
            tabIndex={item.disabled === true ? -1 : 0}
            role={multi ? 'menuitemcheckbox' : 'menuitem'}
            aria-checked={multi ? selected : undefined}
            aria-disabled={item.disabled === true ? true : undefined}
            aria-haspopup={itemHasSubmenu ? 'menu' : undefined}
            onMouseEnter={() => submenuTrigger === 'hover' && onOpenSubmenu(level, item)}
            onFocus={() => submenuTrigger === 'hover' && onOpenSubmenu(level, item)}
            onClick={() => {
              if (itemHasSubmenu && submenuTrigger === 'click') {
                onOpenSubmenu(level, item, { toggle: true })
                return
              }
              onActivateItem(item, level)
            }}
            onKeyDown={event => handleKeyDown(event, item)}
          >
            {submenuOpensLeft && <OverlayIcon className='oneworks-overlay-submenu-icon' icon='chevron_left' />}
            {item.icon != null && !submenuOpensLeft && <OverlayIcon icon={item.icon} />}
            <span
              className={mergeClassNames('oneworks-overlay-menu-label', item.description != null && 'has-description')}
            >
              <span className='oneworks-overlay-menu-label__title'>{confirming ? item.confirmLabel : item.label}</span>
              {item.description != null && !confirming && (
                <span className='oneworks-overlay-menu-label__description'>{item.description}</span>
              )}
            </span>
            {confirming
              ? <OverlayConfirmActions
                label={item.label}
                onCancel={onResetConfirm}
                onConfirm={() => onConfirmItem(item)}
              />
              : !itemHasSubmenu && item.shortcut != null &&
                <span className='oneworks-overlay-shortcut'>{item.shortcut}</span>}
            {!confirming && item.trailing}
            {!confirming && submenuOpensLeft && item.icon != null && (
              <OverlayIcon className='oneworks-overlay-icon--trailing' icon={item.icon} />
            )}
            {itemHasSubmenu && !confirming && !submenuOpensLeft && (
              <OverlayIcon
                className='oneworks-overlay-submenu-icon oneworks-overlay-submenu-icon--right'
                icon='chevron_right'
              />
            )}
          </div>
        )
      })}
    </div>
  )

  const content = primaryHeader == null && primaryFooter == null
    ? list
    : (
      <>
        {primaryHeader != null && <div className='oneworks-overlay-menu-header'>{primaryHeader}</div>}
        {list}
        {primaryFooter != null && <div className='oneworks-overlay-menu-footer'>{primaryFooter}</div>}
      </>
    )

  return level === 0 && !surface
    ? content
    : (
      <OverlayPanel
        className={mergeClassNames(
          panelClassName,
          primaryHeader != null && 'has-primary-header',
          primaryFooter != null && 'has-primary-footer'
        )}
      >
        {content}
      </OverlayPanel>
    )
}
