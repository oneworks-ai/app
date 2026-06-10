import type { CSSProperties, ReactNode, RefObject } from 'react'
import { useMemo, useRef } from 'react'

import { AppShellMobileSidebar } from './AppShellMobileSidebar.js'
import { RouteWorkbenchShell } from './RouteWorkbenchShell.js'
import type { RouteWorkbenchSidebarItem } from './RouteWorkbenchShell.js'
import { useAppShellSidebarPreview } from './use-app-shell-sidebar-preview.js'
import { useMobileSidebarModal } from './use-mobile-sidebar-modal.js'

export interface AppShellFrameRenderContext {
  closeSidebarPreview: () => void
  contentRegionRef: RefObject<HTMLDivElement | null>
  isDesktopSidebarCollapsed: boolean
  isMobileSidebarOpen: boolean
  mobileSidebarSheetRef: RefObject<HTMLDivElement | null>
  openSidebarPreview: () => void
  scheduleSidebarPreviewClose: () => void
  setIsMobileSidebarOpen: (nextOpen: boolean) => void
  sidebarCollapsed: boolean
  sidebarPreviewOpen: boolean
}

export interface AppShellFrameProps {
  children: ReactNode
  className?: string
  closeLabel: string
  contentClassName?: string
  contentRegionClassName?: string
  contentRegionCollapsedClassName?: string
  contentRegionRef?: RefObject<HTMLDivElement | null>
  desktopChrome?: (context: AppShellFrameRenderContext) => ReactNode
  desktopLayoutStyle?: CSSProperties
  desktopSidebar?: (context: AppShellFrameRenderContext) => ReactNode
  isCompactLayout: boolean
  isMobileSidebarOpen: boolean
  mobileSidebar?: (context: AppShellFrameRenderContext) => ReactNode
  mobileSidebarBackdropClassName?: string
  mobileSidebarBackdropOpenClassName?: string
  mobileSidebarSheetClassName?: string
  mobileSidebarSheetId?: string
  mobileSidebarSheetOpenClassName?: string
  onMobileSidebarOpenChange: (nextOpen: boolean) => void
  routeSidebarAriaLabel: string
  sidebarCollapsed: boolean
  sidebarClassName?: string
  sidebarEdgeSwipeZoneClassName?: string
  sidebarFooter?: ReactNode
  sidebarIcon?: ReactNode
  sidebarItems?: RouteWorkbenchSidebarItem[]
  sidebarPreviewDismissLayerClassName?: string
  sidebarRegionClassName?: string
  sidebarTitle?: ReactNode
  showSidebar: boolean
}

export function AppShellFrame({
  children,
  className,
  closeLabel,
  contentClassName,
  contentRegionClassName,
  contentRegionCollapsedClassName,
  contentRegionRef,
  desktopChrome,
  desktopLayoutStyle,
  desktopSidebar,
  isCompactLayout,
  isMobileSidebarOpen,
  mobileSidebar,
  mobileSidebarBackdropClassName,
  mobileSidebarBackdropOpenClassName,
  mobileSidebarSheetClassName,
  mobileSidebarSheetId,
  mobileSidebarSheetOpenClassName,
  onMobileSidebarOpenChange,
  routeSidebarAriaLabel,
  sidebarCollapsed,
  sidebarClassName,
  sidebarEdgeSwipeZoneClassName,
  sidebarFooter,
  sidebarIcon,
  sidebarItems,
  sidebarPreviewDismissLayerClassName,
  sidebarRegionClassName,
  sidebarTitle,
  showSidebar
}: AppShellFrameProps) {
  const ownedContentRegionRef = useRef<HTMLDivElement | null>(null)
  const resolvedContentRegionRef = contentRegionRef ?? ownedContentRegionRef
  const mobileSidebarSheetRef = useRef<HTMLDivElement | null>(null)
  const isDesktopSidebarCollapsed = !isCompactLayout && sidebarCollapsed
  const canShowSidebarPreview = showSidebar && isDesktopSidebarCollapsed
  const mobileSidebarBackgroundRefs = useMemo(() => [resolvedContentRegionRef], [resolvedContentRegionRef])
  const {
    closeSidebarPreview,
    isSidebarPreviewOpen,
    openSidebarPreview,
    scheduleSidebarPreviewClose,
    sidebarEdgeSwipeZoneHandlers
  } = useAppShellSidebarPreview({ canShowSidebarPreview })

  useMobileSidebarModal({
    backgroundRefs: mobileSidebarBackgroundRefs,
    canSwipeOpen: true,
    isCompactLayout,
    isMobileSidebarOpen,
    setIsMobileSidebarOpen: onMobileSidebarOpenChange,
    sheetRef: mobileSidebarSheetRef
  })

  const context: AppShellFrameRenderContext = {
    closeSidebarPreview,
    contentRegionRef: resolvedContentRegionRef,
    isDesktopSidebarCollapsed,
    isMobileSidebarOpen,
    mobileSidebarSheetRef,
    openSidebarPreview,
    scheduleSidebarPreviewClose,
    setIsMobileSidebarOpen: onMobileSidebarOpenChange,
    sidebarCollapsed,
    sidebarPreviewOpen: isSidebarPreviewOpen
  }
  const resolvedContentRegionClassName = [
    contentRegionClassName,
    isDesktopSidebarCollapsed ? contentRegionCollapsedClassName : ''
  ].filter(Boolean).join(' ')
  const desktopSidebarNode = desktopSidebar?.(context)
  const desktopChromeNode = desktopChrome?.(context)
  const mobileSidebarNode = mobileSidebar?.(context)

  return (
    <RouteWorkbenchShell
      className={className}
      contentAriaHidden={isCompactLayout && isMobileSidebarOpen ? true : undefined}
      contentClassName={contentClassName}
      contentFirst={isCompactLayout}
      contentRegionClassName={resolvedContentRegionClassName}
      contentRegionRef={resolvedContentRegionRef}
      desktopChrome={desktopChromeNode}
      mobileSidebar={isCompactLayout && mobileSidebarNode != null
        ? (
          <AppShellMobileSidebar
            backdropClassName={mobileSidebarBackdropClassName}
            backdropOpenClassName={mobileSidebarBackdropOpenClassName}
            closeLabel={closeLabel}
            isOpen={isMobileSidebarOpen}
            onOpenChange={onMobileSidebarOpenChange}
            routeSidebarAriaLabel={routeSidebarAriaLabel}
            sheetClassName={mobileSidebarSheetClassName}
            sheetId={mobileSidebarSheetId}
            sheetOpenClassName={mobileSidebarSheetOpenClassName}
            sheetRef={mobileSidebarSheetRef}
            sidebar={mobileSidebarNode}
          />
        )
        : undefined}
      sidebar={desktopSidebarNode}
      sidebarClassName={sidebarClassName}
      sidebarEdgeSwipeZone={canShowSidebarPreview && sidebarEdgeSwipeZoneClassName != null
        ? (
          <div
            className={sidebarEdgeSwipeZoneClassName}
            aria-hidden='true'
            {...sidebarEdgeSwipeZoneHandlers}
          />
        )
        : undefined}
      sidebarFooter={sidebarFooter}
      sidebarIcon={sidebarIcon}
      sidebarItems={showSidebar ? sidebarItems : []}
      sidebarPreviewDismissLayer={isSidebarPreviewOpen && sidebarPreviewDismissLayerClassName != null
        ? (
          <button
            type='button'
            className={sidebarPreviewDismissLayerClassName}
            aria-label={closeLabel}
            tabIndex={-1}
            onClick={closeSidebarPreview}
          />
        )
        : undefined}
      sidebarRegionClassName={sidebarRegionClassName}
      sidebarTitle={sidebarTitle}
      style={desktopLayoutStyle}
    >
      {children}
    </RouteWorkbenchShell>
  )
}
