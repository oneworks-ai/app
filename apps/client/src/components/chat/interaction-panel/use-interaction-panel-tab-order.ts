import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  areInteractionPanelTabOrdersEqual,
  moveInteractionPanelTabOrder,
  normalizeInteractionPanelTabOrder,
  orderInteractionPanelTabs,
  readInteractionPanelTabOrder,
  writeInteractionPanelTabOrder
} from './interaction-panel-tab-order'
import type { InteractionPanelTabMovePlacement } from './interaction-panel-tab-order'
import type { InteractionPanelTab } from './interaction-panel-tabs'

export function useInteractionPanelTabOrder({
  tabs,
  terminalSessionId
}: {
  tabs: InteractionPanelTab[]
  terminalSessionId: string
}) {
  const [tabOrder, setTabOrder] = useState(() => readInteractionPanelTabOrder(terminalSessionId))
  const orderedTabs = useMemo(() => orderInteractionPanelTabs(tabs, tabOrder), [tabOrder, tabs])

  useEffect(() => {
    setTabOrder(readInteractionPanelTabOrder(terminalSessionId))
  }, [terminalSessionId])

  useEffect(() => {
    const nextOrder = normalizeInteractionPanelTabOrder(tabs, tabOrder)
    if (!areInteractionPanelTabOrdersEqual(tabOrder, nextOrder)) {
      setTabOrder(nextOrder)
    }
    writeInteractionPanelTabOrder(terminalSessionId, nextOrder)
  }, [tabOrder, tabs, terminalSessionId])

  const handleMoveTab = useCallback((
    sourceId: string,
    targetId: string,
    placement: InteractionPanelTabMovePlacement
  ) => {
    setTabOrder(current =>
      moveInteractionPanelTabOrder({
        order: current,
        placement,
        sourceId,
        tabs,
        targetId
      })
    )
  }, [tabs])

  return {
    handleMoveTab,
    tabs: orderedTabs
  }
}
