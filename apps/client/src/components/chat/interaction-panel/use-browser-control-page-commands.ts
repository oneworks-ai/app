import { useEffect, useRef } from 'react'

import type { BrowserControlPageCommandCompletion } from '@oneworks/types'

import { handleBrowserControlPageCommand } from './browser-control-page-command-handler'
import type { BrowserControlPageCommandController } from './browser-control-page-command-handler'

/** Binds a mounted browser page controller to the reliable desktop request/ack channel. */
export function useBrowserControlPageCommands(controller: BrowserControlPageCommandController) {
  const controllerRef = useRef(controller)
  controllerRef.current = controller

  useEffect(() => {
    const dispose = window.oneworksDesktop?.onBrowserControlPageCommand?.((request) => {
      handleBrowserControlPageCommand({
        controller: controllerRef.current,
        request,
        complete: (completion: Omit<BrowserControlPageCommandCompletion, 'requestId'>) => {
          void window.oneworksDesktop?.completeBrowserControlPageCommand?.({
            ...completion,
            requestId: request.requestId
          })
        }
      })
    })
    return dispose
  }, [])
}
