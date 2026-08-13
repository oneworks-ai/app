import { Dropdown } from 'antd'

import { renderIconAsset } from './IconAsset.js'
import type { IconAsset } from './IconAsset.js'
import { RouteHeaderActionButton } from './RouteHeaderActionButton.js'

export interface RouteContainerHeaderActionMenuItem {
  key: string
  label: string
  danger?: boolean
  disabled?: boolean
  icon?: IconAsset
  onSelect?: () => void
}

export interface RouteContainerHeaderActionItem {
  icon: IconAsset
  key: string
  label: string
  active?: boolean
  activeIcon?: IconAsset
  activeLabel?: string
  activeTitle?: string
  danger?: boolean
  disabled?: boolean
  loading?: boolean
  menuItems?: RouteContainerHeaderActionMenuItem[]
  shortcut?: string
  title?: string
  onSelect?: () => void
}

export const readRouteHeaderIsMac = () => (
  typeof navigator !== 'undefined' && navigator.platform.includes('Mac')
)

export function RouteContainerHeaderActionButton({
  isMac = readRouteHeaderIsMac(),
  item
}: {
  isMac?: boolean
  item: RouteContainerHeaderActionItem
}) {
  const isActive = item.active === true
  const resolvedIcon = isActive && item.activeIcon != null ? item.activeIcon : item.icon
  const resolvedLabel = isActive ? item.activeLabel ?? item.label : item.label
  const resolvedTitle = isActive
    ? item.activeTitle ?? item.activeLabel ?? item.title ?? item.label
    : item.title ?? item.label

  const actionButton = (
    <RouteHeaderActionButton
      isMac={isMac}
      shortcut={item.shortcut}
      tooltipTitle={resolvedTitle}
      tooltipEnabled={resolvedTitle != null}
      active={isActive}
      danger={item.danger}
      disabled={item.disabled}
      loading={item.loading}
      label={resolvedLabel}
      pressed={item.active == null ? undefined : isActive}
      onClick={item.onSelect}
      icon={renderIconAsset({
        active: isActive,
        className: 'route-container-header__action-icon',
        icon: resolvedIcon,
        materialFilled: false
      })}
    />
  )

  if (item.menuItems == null || item.menuItems.length === 0) return actionButton

  return (
    <Dropdown
      menu={{
        items: item.menuItems.map(menuItem => ({
          danger: menuItem.danger,
          disabled: menuItem.disabled,
          icon: menuItem.icon == null
            ? undefined
            : renderIconAsset({
              active: false,
              className: 'route-container-header__action-menu-icon',
              icon: menuItem.icon,
              materialFilled: false
            }),
          key: menuItem.key,
          label: menuItem.label,
          onClick: menuItem.onSelect
        }))
      }}
      placement='bottomRight'
      trigger={['click']}
    >
      {actionButton}
    </Dropdown>
  )
}
