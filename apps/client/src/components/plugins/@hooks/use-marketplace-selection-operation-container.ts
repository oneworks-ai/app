import { useCallback, useEffect, useRef } from 'react'

import type { MarketplaceSelectionOperation } from '../@core/marketplace-plugin-selection'
import { MarketplaceSelectionOperationContainer } from '../@core/marketplace-selection-operation-container'

export const useMarketplaceSelectionOperationContainer = ({
  serverKey
}: {
  serverKey: string
}) => {
  const containerRef = useRef(new MarketplaceSelectionOperationContainer())
  const retire = useCallback((key: string, operation: MarketplaceSelectionOperation) => {
    containerRef.current.retire(key, operation)
  }, [])

  useEffect(() => {
    containerRef.current.clear()
  }, [serverKey])
  useEffect(() => () => containerRef.current.clear(), [])

  return { container: containerRef.current, retire }
}
