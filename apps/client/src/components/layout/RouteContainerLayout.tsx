import '@oneworks/route-layout/layout.css'

import { RouteContainerLayout as SharedRouteContainerLayout } from '@oneworks/route-layout'
import type { RouteContainerLayoutProps as SharedRouteContainerLayoutProps } from '@oneworks/route-layout'
import { useLocation } from 'react-router-dom'

import { useResponsiveLayout } from '#~/hooks/use-responsive-layout'

export type {
  RouteContainerLayoutChildren,
  RouteContainerLayoutLocation,
  RouteContainerLayoutSlot,
  RouteContainerLayoutSlotContext,
  RouteContainerSidePanelResizeOptions
} from '@oneworks/route-layout'

export interface RouteContainerLayoutProps
  extends Omit<SharedRouteContainerLayoutProps, 'isCompactLayout' | 'location'>
{
  isCompactLayout?: boolean
  location?: SharedRouteContainerLayoutProps['location']
}

export function RouteContainerLayout({
  isCompactLayout,
  location,
  ...props
}: RouteContainerLayoutProps) {
  const routeLocation = useLocation()
  const responsiveLayout = useResponsiveLayout()

  return (
    <SharedRouteContainerLayout
      {...props}
      isCompactLayout={isCompactLayout ?? responsiveLayout.isCompactLayout}
      location={location ?? routeLocation}
    />
  )
}
