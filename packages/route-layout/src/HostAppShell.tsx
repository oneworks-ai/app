import type { ReactNode } from 'react'

import { AppShellFrame } from './AppShellFrame.js'
import type { AppShellFrameProps } from './AppShellFrame.js'

const classNames = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ')

export interface HostAppShellProps extends
  Omit<
    AppShellFrameProps,
    | 'children'
    | 'className'
    | 'contentClassName'
    | 'contentRegionClassName'
    | 'contentRegionCollapsedClassName'
    | 'mobileSidebarBackdropClassName'
    | 'mobileSidebarSheetClassName'
  >
{
  children: ReactNode
  className?: string
  contentClassName?: string
  contentRegionClassName?: string
  contentRegionCollapsedClassName?: string
  mobileSidebarBackdropClassName?: string
  mobileSidebarSheetClassName?: string
}

export function HostAppShell({
  children,
  className,
  contentClassName,
  contentRegionClassName,
  contentRegionCollapsedClassName,
  mobileSidebarBackdropClassName,
  mobileSidebarSheetClassName,
  ...props
}: HostAppShellProps) {
  return (
    <AppShellFrame
      {...props}
      className={classNames('host-app-shell', props.isCompactLayout && 'host-app-shell--compact', className)}
      contentClassName={classNames('host-app-shell__content', contentClassName)}
      contentRegionClassName={classNames('host-app-shell__content-region', contentRegionClassName)}
      contentRegionCollapsedClassName={classNames('is-sidebar-collapsed', contentRegionCollapsedClassName)}
      mobileSidebarBackdropClassName={classNames(
        'host-app-shell__mobile-sidebar-backdrop',
        mobileSidebarBackdropClassName
      )}
      mobileSidebarSheetClassName={classNames('host-app-shell__mobile-sidebar-sheet', mobileSidebarSheetClassName)}
    >
      {children}
    </AppShellFrame>
  )
}
