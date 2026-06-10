import type { CSSProperties, MouseEvent, ReactNode } from 'react'

export type OverlaySubmenuPlacement = 'left' | 'right'
export type OverlaySubmenuTrigger = 'click' | 'hover'

export interface OverlayMenuActionItem {
  className?: string
  confirmLabel?: ReactNode
  description?: ReactNode
  disabled?: boolean
  icon?: ReactNode
  key: string
  label: ReactNode
  selected?: boolean
  shortcut?: ReactNode
  style?: CSSProperties
  submenuPlacement?: OverlaySubmenuPlacement
  tone?: 'danger'
  trailing?: ReactNode
  children?: OverlayMenuItem[]
  onSelect?: () => void
}

export interface OverlayMenuDividerItem {
  className?: string
  key: string
  type: 'divider'
}

export interface OverlayMenuSectionItem {
  className?: string
  key: string
  label: ReactNode
  type: 'section'
}

export interface OverlayMenuCustomItem {
  className?: string
  content: ReactNode
  key: string
  type: 'custom'
  onClick?: (event: MouseEvent<HTMLElement>) => void
}

export type OverlayMenuItem =
  | OverlayMenuActionItem
  | OverlayMenuCustomItem
  | OverlayMenuDividerItem
  | OverlayMenuSectionItem

export const isOverlayMenuAction = (item: OverlayMenuItem): item is OverlayMenuActionItem => !('type' in item)

export const isOverlayMenuCustom = (item: OverlayMenuItem): item is OverlayMenuCustomItem =>
  'type' in item && item.type === 'custom'

export const isOverlayMenuDivider = (item: OverlayMenuItem): item is OverlayMenuDividerItem =>
  'type' in item && item.type === 'divider'

export const isOverlayMenuSection = (item: OverlayMenuItem): item is OverlayMenuSectionItem =>
  'type' in item && item.type === 'section'

export interface OverlayTreeNode<TData = unknown> {
  children?: Array<OverlayTreeNode<TData>>
  className?: string
  collapsedIcon?: ReactNode
  confirmLabel?: ReactNode
  data?: TData
  disabled?: boolean
  expandedIcon?: ReactNode
  icon?: ReactNode
  key: string
  label: ReactNode
  meta?: ReactNode
  rowClassName?: string
  selected?: boolean
  title?: string
  trailing?: ReactNode
}
