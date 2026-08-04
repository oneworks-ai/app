import type { ActionSearchToolbarAction } from '#~/components/action-search-toolbar/ActionSearchToolbar'

export interface LauncherSearchChromeExtension {
  actions?: ActionSearchToolbarAction[]
  ariaLabel?: string
  placeholder?: string
}
