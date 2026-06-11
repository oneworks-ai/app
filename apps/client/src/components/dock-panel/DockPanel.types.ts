import type { ReactNode } from 'react'

export interface DockPanelControls {
  isFullscreen: boolean
  onToggleFullscreen: () => void
}

export type DockPanelHeightConstraint = number | `${number}%`
export type DockPanelLength = number | string

export interface DockPanelProps {
  actions?: ReactNode
  allowFullscreen?: boolean
  allowResize?: boolean
  children: ReactNode | ((controls: DockPanelControls) => ReactNode)
  className?: string
  closeIcon?: string
  closeLabel?: string
  defaultHeight?: number
  enterMotion?: 'none' | 'slide-up'
  footer?: ReactNode
  fullscreenEnterLabel?: string
  fullscreenExitLabel?: string
  fullscreenMinimizedIcon?: string
  fullscreenMinimizedLabel?: string
  hideHeader?: boolean
  isMinimized?: boolean
  isOpen?: boolean
  isResizeDisabled?: boolean
  maxHeight?: number
  meta?: ReactNode
  /**
   * Height used when the panel is minimized.
   *
   * Use this when the minimized chrome is supplied by panel content rather than
   * DockPanelHeader, for example a shared dock workspace tab bar. Keep this
   * value tied to the same design tokens as the rendered chrome so minimizing
   * preserves the expanded header styling and animation.
   */
  minimizedHeight?: DockPanelLength
  /**
   * Minimum panel height. Percentage values resolve against the panel's
   * immediate container height so bottom panels can use container-relative
   * limits without route-local resize logic.
   */
  minHeight?: DockPanelHeightConstraint
  onClose?: () => void
  onExpandMinimized?: () => void
  resizeLabel: string
  storageKey: string
  title?: ReactNode
}
