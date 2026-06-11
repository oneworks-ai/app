import { isOverlayMenuAction, isOverlayMenuDivider } from './overlay-types'
import type { OverlayMenuActionItem, OverlayMenuItem } from './overlay-types'

export interface OverlayMenuColumn {
  activeKey?: string
  items: OverlayMenuItem[]
  offsetRows: number
}

export const getFirstSelectedChildPath = (items: OverlayMenuItem[], selectedKeySet: Set<string>): string[] => {
  for (const item of items) {
    if (!isOverlayMenuAction(item) || item.children == null) continue
    if (item.children.some(child => !isOverlayMenuDivider(child) && selectedKeySet.has(child.key))) {
      return [item.key]
    }

    const childPath = getFirstSelectedChildPath(item.children, selectedKeySet)
    if (childPath.length > 0) {
      return [item.key, ...childPath]
    }
  }

  return []
}

export const getMenuColumns = (
  items: OverlayMenuItem[],
  openKeys: string[],
  alignSubmenus: boolean
): OverlayMenuColumn[] => {
  const columns: OverlayMenuColumn[] = [{ activeKey: openKeys[0], items, offsetRows: 0 }]
  let currentItems = items
  let offsetRows = 0

  for (const [level, key] of openKeys.entries()) {
    const selectedIndex = currentItems.findIndex(item => isOverlayMenuAction(item) && item.key === key)
    const selectedItem = currentItems.filter(isOverlayMenuAction).find(item => item.key === key)

    if (selectedIndex >= 0 && alignSubmenus) {
      offsetRows += selectedIndex
    }

    if (selectedItem?.children == null) {
      break
    }

    currentItems = selectedItem.children
    columns.push({
      activeKey: openKeys[level + 1],
      items: currentItems,
      offsetRows
    })
  }

  return columns
}

export const getSelectedItemIndexes = (
  items: OverlayMenuItem[],
  selectedKeySet: Set<string>
) =>
  items
    .map((item, index) =>
      isOverlayMenuAction(item) && (selectedKeySet.has(item.key) || item.selected === true)
        ? index
        : -1
    )
    .filter(index => index >= 0)

export const hasChildren = (item: OverlayMenuActionItem) => item.children != null && item.children.length > 0
