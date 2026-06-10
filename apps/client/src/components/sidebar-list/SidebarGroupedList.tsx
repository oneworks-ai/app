import './SidebarGroupedList.scss'

import { Dropdown } from 'antd'
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { renderIconAsset } from '#~/components/icons/IconAsset'
import type { IconAsset } from '#~/components/icons/IconAsset'
import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'
import type {
  RouteSidebarListContextMenuItems,
  RouteSidebarListContextMenuTarget,
  RouteSidebarListGroup,
  RouteSidebarListItem
} from '#~/components/layout/route-sidebar-context'

const normalizeContextMenu = (
  contextMenuItems: RouteSidebarListContextMenuItems | undefined,
  target: RouteSidebarListContextMenuTarget
) => {
  if (contextMenuItems == null) return undefined

  const resolvedContextMenuItems = typeof contextMenuItems === 'function'
    ? contextMenuItems(target)
    : contextMenuItems
  if (resolvedContextMenuItems == null) return undefined

  return Array.isArray(resolvedContextMenuItems)
    ? {
      items: resolvedContextMenuItems,
      selectedKeys: []
    }
    : {
      items: resolvedContextMenuItems.items,
      selectedKeys: resolvedContextMenuItems.selectedKeys ?? []
    }
}

interface SidebarGroupedListProps {
  activeKey?: string
  contextMenuItems?: RouteSidebarListContextMenuItems
  emptyText: ReactNode
  groups: RouteSidebarListGroup[]
  onSelect: (item: RouteSidebarListItem) => void
}

export function SidebarGroupedList({
  activeKey,
  contextMenuItems,
  emptyText,
  groups,
  onSelect
}: SidebarGroupedListProps) {
  const { t } = useTranslation()
  const [collapsedGroupKeys, setCollapsedGroupKeys] = useState(() => new Set<string>())
  const rootContextMenu = normalizeContextMenu(contextMenuItems, { kind: 'root' })
  const visibleGroups = useMemo(
    () => groups.filter(group => group.selectable === true || group.items.length > 0),
    [groups]
  )
  const visibleGroupKeySet = useMemo(
    () => new Set(visibleGroups.map(group => group.key)),
    [visibleGroups]
  )

  const isGroupCollapsed = (groupKey: string) => visibleGroupKeySet.has(groupKey) && collapsedGroupKeys.has(groupKey)
  const toGroupItem = (group: RouteSidebarListGroup): RouteSidebarListItem => ({
    activeIcon: group.activeIcon,
    contextMenuItems: group.contextMenuItems,
    icon: group.icon,
    key: group.key,
    label: group.label ?? group.key,
    searchText: group.searchableText
  })
  const renderSidebarIcon = ({
    active,
    activeIcon,
    className,
    icon
  }: {
    active: boolean
    activeIcon?: IconAsset
    className: string
    icon?: IconAsset
  }) =>
    renderIconAsset({
      active,
      className,
      icon: active && activeIcon != null ? activeIcon : icon
    })

  const toggleGroup = (groupKey: string) => {
    setCollapsedGroupKeys(previous => {
      const next = new Set(previous)
      if (next.has(groupKey)) {
        next.delete(groupKey)
      } else {
        next.add(groupKey)
      }
      return next
    })
  }

  const resolveTargetContextMenu = (
    target: RouteSidebarListContextMenuTarget,
    ownContextMenuItems?: RouteSidebarListContextMenuItems
  ) => {
    const inheritedContextMenu = typeof contextMenuItems === 'function'
      ? normalizeContextMenu(contextMenuItems, target)
      : undefined
    const ownContextMenu = normalizeContextMenu(ownContextMenuItems, target)

    if (inheritedContextMenu == null) return ownContextMenu
    if (ownContextMenu == null) return inheritedContextMenu

    return {
      items: [
        ...ownContextMenu.items,
        ...inheritedContextMenu.items
      ],
      selectedKeys: Array.from(
        new Set([
          ...ownContextMenu.selectedKeys,
          ...inheritedContextMenu.selectedKeys
        ])
      )
    }
  }

  const scrollContent = (
    <div className='sidebar-grouped-list-scroll'>
      {visibleGroups.length === 0
        ? <div className='sidebar-grouped-list-empty'>{emptyText}</div>
        : (
          <div className='sidebar-grouped-list' role='list'>
            {visibleGroups.map(group => {
              const isCollapsed = isGroupCollapsed(group.key)
              const isSelectable = group.selectable === true
              const isActiveGroup = isSelectable && activeKey === group.key
              const toggleLabel = isCollapsed ? t('common.expandGroup') : t('common.collapseGroup')
              const groupButtonLabel = isSelectable ? String(group.label ?? '') : toggleLabel
              const groupLabel = group.label == null
                ? null
                : (
                  <button
                    type='button'
                    className={[
                      'sidebar-grouped-list__group-label',
                      isSelectable ? 'is-selectable' : '',
                      isActiveGroup ? 'is-active' : ''
                    ].filter(Boolean).join(' ')}
                    aria-expanded={group.items.length > 0 ? !isCollapsed : undefined}
                    aria-haspopup={group.contextMenuItems == null ? undefined : 'menu'}
                    title={groupButtonLabel}
                    onClick={() => {
                      if (isSelectable) {
                        onSelect(toGroupItem(group))
                        return
                      }
                      toggleGroup(group.key)
                    }}
                  >
                    <span className='sidebar-grouped-list__group-title'>
                      {renderSidebarIcon({
                        active: isActiveGroup,
                        activeIcon: group.activeIcon,
                        className: 'sidebar-grouped-list__group-icon',
                        icon: group.icon
                      })}
                      <span className='sidebar-grouped-list__group-text'>{group.label}</span>
                    </span>
                    {group.items.length > 0 && (
                      <span className='sidebar-grouped-list__group-toggle' aria-hidden='true'>
                        <MaterialSymbol className='sidebar-grouped-list__group-toggle-icon' name='expand_more' />
                      </span>
                    )}
                  </button>
                )

              return (
                <section
                  key={group.key}
                  className={[
                    'sidebar-grouped-list__group',
                    group.label == null ? 'sidebar-grouped-list__group--unlabeled' : '',
                    isCollapsed ? 'is-collapsed' : ''
                  ].filter(Boolean).join(' ')}
                >
                  {(() => {
                    const groupContextMenu = resolveTargetContextMenu({
                      groupKey: group.key,
                      kind: 'group'
                    }, group.contextMenuItems)
                    if (groupContextMenu == null || groupContextMenu.items.length === 0 || groupLabel == null) {
                      return groupLabel
                    }
                    return (
                      <Dropdown
                        trigger={['contextMenu']}
                        destroyOnHidden
                        menu={{
                          items: groupContextMenu.items,
                          selectedKeys: groupContextMenu.selectedKeys
                        }}
                      >
                        {groupLabel}
                      </Dropdown>
                    )
                  })()}
                  {!isCollapsed && (
                    <div className='sidebar-grouped-list__items'>
                      {group.items.map(item => {
                        const isActiveItem = activeKey === item.key
                        const itemContextMenu = resolveTargetContextMenu({
                          groupKey: group.key,
                          itemKey: item.key,
                          kind: 'item'
                        }, item.contextMenuItems)
                        const itemButton = (
                          <button
                            key={item.key}
                            type='button'
                            className={[
                              'sidebar-grouped-list__item',
                              isActiveItem ? 'is-active' : ''
                            ].filter(Boolean).join(' ')}
                            aria-haspopup={itemContextMenu == null ? undefined : 'menu'}
                            onClick={() => onSelect(item)}
                          >
                            {renderSidebarIcon({
                              active: isActiveItem,
                              activeIcon: item.activeIcon,
                              className: 'sidebar-grouped-list__item-icon',
                              icon: item.icon
                            })}
                            <span className='sidebar-grouped-list__item-label'>{item.label}</span>
                          </button>
                        )

                        if (itemContextMenu == null || itemContextMenu.items.length === 0) {
                          return itemButton
                        }

                        return (
                          <Dropdown
                            key={item.key}
                            trigger={['contextMenu']}
                            destroyOnHidden
                            menu={{
                              items: itemContextMenu.items,
                              selectedKeys: itemContextMenu.selectedKeys
                            }}
                          >
                            {itemButton}
                          </Dropdown>
                        )
                      })}
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        )}
    </div>
  )

  return (
    <div className='sidebar-grouped-list-container'>
      {rootContextMenu != null && rootContextMenu.items.length > 0
        ? (
          <Dropdown
            trigger={['contextMenu']}
            destroyOnHidden
            menu={{
              items: rootContextMenu.items,
              selectedKeys: rootContextMenu.selectedKeys
            }}
          >
            {scrollContent}
          </Dropdown>
        )
        : scrollContent}
    </div>
  )
}
