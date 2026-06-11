import type { CSSProperties, ReactNode } from 'react'

import type {
  OverlayMenuActionItem,
  OverlayMenuItem,
  OverlaySubmenuPlacement,
  OverlaySubmenuTrigger
} from './overlay-types'

export interface OverlayMenuProps {
  alignSubmenus?: boolean
  className?: string
  itemClassName?: string
  defaultOpenKeys?: string[]
  items: OverlayMenuItem[]
  labelledBy?: string
  menuClassName?: string
  multi?: boolean
  openKeys?: string[]
  panelClassName?: string
  primaryFooter?: ReactNode
  primaryHeader?: ReactNode
  primaryMenuClassName?: string
  primaryPanelClassName?: string
  selectedKeys?: string[]
  submenuPlacement?: OverlaySubmenuPlacement
  submenuTrigger?: OverlaySubmenuTrigger
  surface?: boolean
  width?: CSSProperties['width']
  onItemClick?: (item: OverlayMenuActionItem) => void
  onOpenKeysChange?: (keys: string[]) => void
}
