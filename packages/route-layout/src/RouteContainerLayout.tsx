import type { ReactNode } from 'react'
import { useRef } from 'react'

import { RouteContainerSidePanel } from './RouteContainerSidePanel.js'
import type { RouteContainerSidePanelResizeOptions } from './RouteContainerSidePanel.js'
import { useResponsiveLayout } from './use-responsive-layout.js'
import { useRetainedValue } from './use-retained-value.js'

export type { RouteContainerSidePanelResizeOptions } from './RouteContainerSidePanel.js'

export interface RouteContainerLayoutLocation {
  hash?: string
  pathname?: string
  search?: string
}

export interface RouteContainerLayoutSlotContext {
  hash: string
  path: string
  pathname: string
  search: string
  isClosing?: boolean
}

export type RouteContainerLayoutChildren =
  | ReactNode
  | ((context: RouteContainerLayoutSlotContext) => ReactNode)

export type RouteContainerLayoutSlot = RouteContainerLayoutChildren

export interface RouteContainerLayoutProps {
  bottomPanel?: RouteContainerLayoutSlot
  bodyClassName?: string
  children?: RouteContainerLayoutChildren
  className?: string
  contentInset?: boolean
  header?: ReactNode
  isCompactLayout?: boolean
  location?: RouteContainerLayoutLocation
  path?: string
  sidePanel?: RouteContainerLayoutSlot
  sidePanelClassName?: string
  sidePanelCompactMode?: 'dock' | 'overlay'
  sidePanelFullscreen?: boolean
  sidePanelLabel?: string
  sidePanelResize?: RouteContainerSidePanelResizeOptions
  surfaceClassName?: string
  onCloseSidePanel?: () => void
}

const SIDE_PANEL_EXIT_DURATION_MS = 240
const BOTTOM_PANEL_EXIT_DURATION_MS = 240

export function RouteContainerLayout({
  bottomPanel,
  bodyClassName,
  children,
  className,
  contentInset = false,
  header,
  isCompactLayout,
  location,
  path,
  sidePanel,
  sidePanelCompactMode = 'dock',
  sidePanelFullscreen = false,
  sidePanelClassName,
  sidePanelLabel,
  sidePanelResize,
  surfaceClassName,
  onCloseSidePanel
}: RouteContainerLayoutProps) {
  const responsiveLayout = useResponsiveLayout()
  const resolvedLocation = {
    hash: location?.hash ?? '',
    pathname: location?.pathname ?? '',
    search: location?.search ?? ''
  }
  const resolvedIsCompactLayout = isCompactLayout ?? responsiveLayout.isCompactLayout
  const resolvedPath = path ?? `${resolvedLocation.pathname}${resolvedLocation.search}${resolvedLocation.hash}`
  const slotContext = {
    hash: resolvedLocation.hash,
    isClosing: false,
    path: resolvedPath,
    pathname: resolvedLocation.pathname,
    search: resolvedLocation.search
  }
  const resolveSlotContent = (
    slot: RouteContainerLayoutSlot | null | undefined,
    context: RouteContainerLayoutSlotContext = slotContext
  ) => typeof slot === 'function' ? slot(context) : slot

  const sidePanelContent = resolveSlotContent(sidePanel)
  const lastVisibleSidePanelFullscreenRef = useRef(false)
  if (sidePanelContent != null) {
    lastVisibleSidePanelFullscreenRef.current = sidePanelFullscreen
  }
  const renderedSidePanelContent = useRetainedValue(sidePanelContent, SIDE_PANEL_EXIT_DURATION_MS)
  const isSidePanelClosing = sidePanelContent == null && renderedSidePanelContent != null
  const renderedSidePanelFullscreen = sidePanelContent == null
    ? lastVisibleSidePanelFullscreenRef.current
    : sidePanelFullscreen
  const shouldRenderSidePanelAsOverlay = renderedSidePanelContent != null &&
    !renderedSidePanelFullscreen &&
    sidePanelCompactMode === 'overlay' &&
    resolvedIsCompactLayout
  const shouldRenderDockedSidePanel = renderedSidePanelContent != null && !shouldRenderSidePanelAsOverlay
  const renderedBottomPanelSlot = useRetainedValue(bottomPanel, BOTTOM_PANEL_EXIT_DURATION_MS)
  const isBottomPanelClosing = bottomPanel == null && renderedBottomPanelSlot != null
  const bottomPanelContent = resolveSlotContent(
    renderedBottomPanelSlot,
    isBottomPanelClosing ? { ...slotContext, isClosing: true } : slotContext
  )
  const rootClassName = [
    'route-container-layout',
    contentInset ? 'has-content-inset' : '',
    renderedSidePanelContent != null ? 'has-side-panel' : '',
    renderedSidePanelFullscreen && shouldRenderDockedSidePanel ? 'has-side-panel-fullscreen' : '',
    shouldRenderSidePanelAsOverlay ? 'has-side-panel-overlay' : '',
    bottomPanelContent != null ? 'has-bottom-panel' : '',
    className
  ].filter(Boolean).join(' ')
  const surfaceClasses = ['route-container-layout__surface', surfaceClassName].filter(Boolean).join(' ')
  const bodyClasses = ['route-container-layout__body', bodyClassName].filter(Boolean).join(' ')
  const sidePanelClasses = ['route-container-layout__side-panel', sidePanelClassName].filter(Boolean).join(' ')
  const bodyContent = resolveSlotContent(children)
  const mainRef = useRef<HTMLDivElement | null>(null)

  return (
    <div className={rootClassName}>
      <div ref={mainRef} className='route-container-layout__main'>
        <div className={surfaceClasses}>
          {header}
          <div className={bodyClasses}>
            {bodyContent}
          </div>
        </div>
        {shouldRenderDockedSidePanel && (
          <RouteContainerSidePanel
            className={sidePanelClasses}
            containerRef={mainRef}
            content={renderedSidePanelContent}
            isFullscreen={renderedSidePanelFullscreen}
            isClosing={isSidePanelClosing}
            resize={sidePanelResize}
          />
        )}
      </div>
      {shouldRenderSidePanelAsOverlay && (
        <>
          <button
            type='button'
            className={[
              'route-container-layout__side-panel-overlay-backdrop',
              isSidePanelClosing ? 'is-closing' : ''
            ].filter(Boolean).join(' ')}
            aria-label='Close side panel'
            aria-hidden={isSidePanelClosing}
            tabIndex={isSidePanelClosing ? -1 : 0}
            onClick={onCloseSidePanel}
          />
          <aside
            className={[
              'route-container-layout__side-panel-overlay',
              sidePanelClassName,
              isSidePanelClosing ? 'is-closing' : ''
            ].filter(Boolean).join(' ')}
            role='dialog'
            aria-modal='true'
            aria-label={sidePanelLabel ?? 'Side panel'}
          >
            <div className='route-container-layout__side-panel-overlay-content'>
              {renderedSidePanelContent}
            </div>
          </aside>
        </>
      )}
      {bottomPanelContent}
    </div>
  )
}
