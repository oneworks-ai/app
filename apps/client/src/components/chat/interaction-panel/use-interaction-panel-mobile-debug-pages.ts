import { useCallback, useState } from 'react'

import { createInteractionPanelMobileDebugPage } from './interaction-panel-mobile-debug-pages'
import type { InteractionPanelMobileDebugPage } from './interaction-panel-mobile-debug-pages'

export function useInteractionPanelMobileDebugPages() {
  const [mobileDebugPages, setMobileDebugPages] = useState<InteractionPanelMobileDebugPage[]>([])

  const addMobileDebugPage = (
    title: string,
    options: Pick<InteractionPanelMobileDebugPage, 'mode' | 'selectedDeviceId' | 'selectedDeviceLabel'> = {}
  ) => {
    const existingPage = mobileDebugPages[0]
    if (existingPage != null) {
      const nextPage = { ...existingPage, ...options, title }
      setMobileDebugPages(current => current.map(page => page.id === existingPage.id ? nextPage : page))
      return nextPage
    }

    const nextPage = { ...createInteractionPanelMobileDebugPage(title), ...options }
    setMobileDebugPages([nextPage])
    return nextPage
  }

  const closeMobileDebugPages = useCallback((pageIds: Set<string>) => {
    if (pageIds.size <= 0) return
    setMobileDebugPages(current => current.filter(page => !pageIds.has(page.id)))
  }, [])

  const updateMobileDebugPage = useCallback((
    pageId: string,
    updater: (page: InteractionPanelMobileDebugPage) => InteractionPanelMobileDebugPage
  ) => {
    setMobileDebugPages(current => {
      let hasChanged = false
      const nextPages = current.map(page => {
        if (page.id !== pageId) return page
        const nextPage = updater(page)
        if (nextPage !== page) hasChanged = true
        return nextPage
      })
      return hasChanged ? nextPages : current
    })
  }, [])

  return {
    addMobileDebugPage,
    closeMobileDebugPages,
    mobileDebugPages,
    updateMobileDebugPage
  }
}
