import { useCallback } from 'react'

import { findDeepestNodeAtPoint } from './mobile-device-preview-utils'
import type { PointerDevicePoint } from './mobile-device-preview-utils'

export const useMobileDeviceElementSelection = ({
  elementTree,
  setHoverNodeId,
  setSelectedNodeId,
  toPhysicalPoint
}: {
  elementTree: DesktopMobileElementTreeResponse | null
  setHoverNodeId: (nodeId: string | undefined) => void
  setSelectedNodeId: (nodeId: string | undefined) => void
  toPhysicalPoint: (point: PointerDevicePoint) => PointerDevicePoint
}) => ({
  hoverElementAtPoint: useCallback((point: PointerDevicePoint) => {
    setHoverNodeId(findDeepestNodeAtPoint(elementTree?.root, toPhysicalPoint(point))?.id)
  }, [elementTree?.root, setHoverNodeId, toPhysicalPoint]),
  selectElementAtPoint: useCallback((point: PointerDevicePoint) => {
    setSelectedNodeId(findDeepestNodeAtPoint(elementTree?.root, toPhysicalPoint(point))?.id)
  }, [elementTree?.root, setSelectedNodeId, toPhysicalPoint])
})
