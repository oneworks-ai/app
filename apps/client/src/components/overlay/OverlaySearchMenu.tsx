import './Overlay.scss'

import type { ReactNode } from 'react'

import { OverlayMenu } from './OverlayMenu'
import { OverlayIcon, OverlayPanel } from './OverlayPrimitives'
import { OverlaySearchRow } from './OverlaySearchRow'
import type { OverlayMenuActionItem, OverlayMenuItem } from './overlay-types'
import { mergeClassNames } from './overlay-utils'

export function OverlaySearchMenu({
  accessory,
  className,
  emptyLabel = 'No results',
  items,
  onItemClick,
  onSearchChange,
  placeholder = 'Search',
  searchPlacement = 'top',
  searchValue,
  selectedKeys
}: {
  accessory?: ReactNode
  className?: string
  emptyLabel?: ReactNode
  items: OverlayMenuItem[]
  onItemClick?: (item: OverlayMenuActionItem) => void
  onSearchChange: (value: string) => void
  placeholder?: string
  searchPlacement?: 'bottom' | 'top'
  searchValue: string
  selectedKeys?: string[]
}) {
  const searchRow = (
    <OverlaySearchRow
      accessory={accessory}
      placeholder={placeholder}
      value={searchValue}
      onChange={onSearchChange}
    />
  )

  if (items.length > 0) {
    return (
      <OverlayMenu
        className='oneworks-overlay-search-menu-composite'
        items={items}
        primaryFooter={searchPlacement === 'bottom' ? searchRow : undefined}
        primaryHeader={searchPlacement === 'top' ? searchRow : undefined}
        primaryMenuClassName='oneworks-overlay-search-menu__list'
        primaryPanelClassName={mergeClassNames(
          'oneworks-overlay-search-menu',
          `is-search-${searchPlacement}`,
          className
        )}
        selectedKeys={selectedKeys}
        surface
        onItemClick={onItemClick}
      />
    )
  }

  return (
    <OverlayPanel
      className={mergeClassNames('oneworks-overlay-search-menu', `is-search-${searchPlacement}`, className)}
    >
      {searchPlacement === 'top' && searchRow}
      <div className='oneworks-overlay-search-menu__list'>
        <div className='oneworks-overlay-search-empty'>
          <OverlayIcon className='oneworks-overlay-search-empty__icon' icon='search_off' />
          <span>{emptyLabel}</span>
        </div>
      </div>
      {searchPlacement === 'bottom' && searchRow}
    </OverlayPanel>
  )
}
