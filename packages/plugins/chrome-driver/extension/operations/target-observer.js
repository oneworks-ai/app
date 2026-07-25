import { error } from './shared.js'

const addListener = (event, listener, removals) => {
  if (typeof event?.addListener !== 'function') return
  event.addListener(listener)
  removals.push(() => event.removeListener?.(listener))
}

export function observeTargetMutation({ includeActivation = false, tabId, windowId }) {
  let changed = false
  const removals = []
  const markNavigation = details => {
    if (details?.tabId === tabId && details.frameId === 0) changed = true
  }
  for (
    const event of [
      chrome.webNavigation?.onCommitted,
      chrome.webNavigation?.onHistoryStateUpdated,
      chrome.webNavigation?.onReferenceFragmentUpdated
    ]
  ) {
    addListener(event, markNavigation, removals)
  }
  addListener(chrome.tabs?.onUpdated, (updatedTabId, changeInfo) => {
    if (
      updatedTabId === tabId &&
      (changeInfo?.pendingUrl != null || changeInfo?.url != null || changeInfo?.status === 'loading')
    ) {
      changed = true
    }
  }, removals)
  if (includeActivation) {
    addListener(chrome.tabs?.onActivated, activeInfo => {
      if (activeInfo?.windowId === windowId) changed = true
    }, removals)
  }
  return {
    assertUnchanged() {
      if (changed) {
        throw error('TARGET_DOCUMENT_CHANGED', 'The Chrome target changed while the operation was in progress.', {
          tab_id: tabId
        })
      }
    },
    close() {
      for (const remove of removals) remove()
    }
  }
}
