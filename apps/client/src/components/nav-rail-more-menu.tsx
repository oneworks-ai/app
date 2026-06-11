import { ShortcutDisplay } from '@oneworks/components/route-layout'
import { Button, Dropdown } from 'antd'
import type { MenuProps } from 'antd'
import type React from 'react'
import type { ReactNode } from 'react'

import { renderIconAsset } from '#~/components/icons/IconAsset'
import type { IconAsset } from '#~/components/icons/IconAsset'

export const NAV_RAIL_MORE_DROPDOWN_CLASS = 'nav-rail-more-dropdown'
export const NAV_RAIL_MORE_CLOSE_DEFER_MS = 16
export const NAV_RAIL_MORE_CONTEXT_DROPDOWN_CLASS = 'nav-rail-more-context-dropdown'
export const NAV_RAIL_MORE_SUBMENU_DROPDOWN_CLASS = 'nav-rail-more-submenu-dropdown'

export interface NavRailMoreMenuBaseItem {
  icon?: IconAsset
  key: string
  label: ReactNode
  active?: boolean
  activeIcon?: IconAsset
  className?: string
  danger?: boolean
  disabled?: boolean
  popupClassName?: string
  selected?: boolean
  shortcut?: string
  title?: string
  children?: NavRailMoreMenuItem[]
  menuChildren?: MenuProps['items']
  onSelect?: () => void
}

export interface NavRailMoreMenuCustomItem {
  content: ReactNode
  key: string
  type: 'custom'
  className?: string
  onClick?: (event: React.MouseEvent<HTMLElement>) => void
}

export type NavRailMoreMenuItem = NavRailMoreMenuBaseItem | NavRailMoreMenuCustomItem

export interface NavRailMoreMenuSection {
  items: NavRailMoreMenuItem[]
  key: string
  label?: ReactNode
}

const isCustomMenuItem = (item: NavRailMoreMenuItem): item is NavRailMoreMenuCustomItem => (
  'type' in item && item.type === 'custom'
)

const renderMenuItemLabel = (
  item: NavRailMoreMenuBaseItem,
  isMac: boolean
) => {
  if (item.shortcut == null) return item.label

  return (
    <span className='nav-menu-shortcut-label'>
      <span className='nav-menu-shortcut-title'>{item.label}</span>
      <ShortcutDisplay className='nav-menu-shortcut' isMac={isMac} shortcut={item.shortcut} />
    </span>
  )
}

const renderMenuItemIcon = (item: NavRailMoreMenuBaseItem) => {
  const icon = item.active === true && item.activeIcon != null ? item.activeIcon : item.icon
  if (icon == null) return undefined

  return renderIconAsset({
    active: item.active === true,
    className: 'nav-menu-icon',
    icon
  })
}

const buildNavRailMoreMenuItem = ({
  closeMenu,
  isMac,
  item
}: {
  closeMenu: (animated?: boolean) => void
  isMac: boolean
  item: NavRailMoreMenuItem
}): NonNullable<MenuProps['items']>[number] => {
  if (isCustomMenuItem(item)) {
    return {
      className: item.className,
      key: item.key,
      label: item.content,
      onClick: ({ domEvent }) => {
        item.onClick?.(domEvent as React.MouseEvent<HTMLElement>)
      }
    }
  }

  const hasSubmenu = item.children != null || item.menuChildren != null

  return {
    children: item.menuChildren ?? item.children?.map(child =>
      buildNavRailMoreMenuItem({
        closeMenu,
        isMac,
        item: child
      })
    ),
    className: item.className,
    danger: item.danger,
    disabled: item.disabled,
    icon: renderMenuItemIcon(item),
    key: item.key,
    label: renderMenuItemLabel(item, isMac),
    popupClassName: hasSubmenu
      ? item.popupClassName ?? NAV_RAIL_MORE_SUBMENU_DROPDOWN_CLASS
      : item.popupClassName,
    title: item.title,
    onClick: !hasSubmenu
      ? () => {
        closeMenu(false)
        item.onSelect?.()
      }
      : undefined
  }
}

export const buildNavRailMoreMenuItems = ({
  closeMenu,
  isMac,
  sections
}: {
  closeMenu: (animated?: boolean) => void
  isMac: boolean
  sections: NavRailMoreMenuSection[]
}): MenuProps['items'] => {
  const filledSections = sections.filter(section => section.items.length > 0)

  return filledSections.flatMap((section, index) => {
    const items = section.items.map(item =>
      buildNavRailMoreMenuItem({
        closeMenu,
        isMac,
        item
      })
    )

    const sectionItems: NonNullable<MenuProps['items']> = section.label == null
      ? items
      : [
        {
          children: items,
          key: `${section.key}:group`,
          label: section.label,
          type: 'group' as const
        }
      ]

    if (index === 0) return sectionItems

    return [
      {
        key: `${section.key}:divider`,
        type: 'divider' as const
      },
      ...sectionItems
    ]
  })
}

export const getNavRailMoreMenuSelectedKeys = (
  sections: NavRailMoreMenuSection[]
): string[] => (
  sections.flatMap(section =>
    section.items.flatMap((item): string[] => {
      if (isCustomMenuItem(item)) return []

      return [
        item.selected === true ? item.key : undefined,
        ...getNavRailMoreMenuSelectedKeys([{ items: item.children ?? [], key: item.key }])
      ].filter((key): key is string => key != null)
    })
  )
)

export function NavRailMoreDropdown({
  active,
  buttonIconSrc,
  buttonLabel,
  buttonRef,
  contextMenuItems,
  items,
  open,
  selectedKeys,
  visuallyOpen,
  onOpenChange,
  onSelectItem,
  onTriggerFeedback
}: {
  active: boolean
  buttonIconSrc: string
  buttonLabel: string
  buttonRef: React.Ref<HTMLAnchorElement | HTMLButtonElement>
  contextMenuItems?: MenuProps['items']
  items: MenuProps['items']
  open: boolean
  selectedKeys: string[]
  visuallyOpen: boolean
  onOpenChange: (open: boolean) => void
  onSelectItem: () => void
  onTriggerFeedback: () => void
}) {
  const expandIcon = (
    <span className='material-symbols-rounded nav-menu-submenu-chevron'>
      keyboard_arrow_right
    </span>
  )
  return (
    <Dropdown
      destroyOnHidden
      overlayClassName={NAV_RAIL_MORE_DROPDOWN_CLASS}
      menu={{
        expandIcon,
        items,
        onClick: onSelectItem,
        selectedKeys,
        triggerSubMenuAction: 'click'
      }}
      open={open}
      onOpenChange={onOpenChange}
      popupRender={contextMenuItems == null || contextMenuItems.length === 0
        ? undefined
        : menus => (
          <Dropdown
            overlayClassName={`${NAV_RAIL_MORE_DROPDOWN_CLASS} ${NAV_RAIL_MORE_CONTEXT_DROPDOWN_CLASS}`}
            trigger={['contextMenu']}
            menu={{
              expandIcon,
              items: contextMenuItems,
              triggerSubMenuAction: 'click'
            }}
          >
            <div className='nav-rail-more-dropdown__context-target'>
              {menus}
            </div>
          </Dropdown>
        )}
      placement='topLeft'
      trigger={['click']}
      transitionName='ant-slide-down'
    >
      <Button
        ref={buttonRef}
        type='default'
        className={`nav-rail-more-button ${active ? 'is-active' : 'is-idle'}`}
        aria-haspopup='menu'
        aria-expanded={visuallyOpen}
        block
        onClick={onTriggerFeedback}
      >
        <span className='nav-rail-more-button__content'>
          <img
            className='nav-rail-vibe-icon nav-rail-vibe-icon--more'
            src={buttonIconSrc}
            alt=''
            aria-hidden='true'
          />
          <span>{buttonLabel}</span>
        </span>
      </Button>
    </Dropdown>
  )
}
