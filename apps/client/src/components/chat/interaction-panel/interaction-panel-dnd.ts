export const INTERACTION_PANEL_TAB_DRAG_MIME = 'application/x-oneworks-interaction-panel-tab-id'

const PIN_DROP_TARGET_HOT_MS = 800
const PIN_DROP_TARGET_SELECTOR = '.chat-interaction-panel__dock-prefix-actions, .dv-pre-actions-container'
const PIN_DROP_TARGET_PADDING = 2
const GROUP_PREFIX_DROP_WIDTH = 36

let pinDropTargetHotUntil = 0

const isPointInRect = (event: DragEvent, rect: DOMRect, padding = 0) =>
  event.clientX >= rect.left - padding &&
  event.clientX <= rect.right + padding &&
  event.clientY >= rect.top - padding &&
  event.clientY <= rect.bottom + padding

const isPointInSelector = (event: DragEvent, selector: string, padding = 0) =>
  Array.from(document.querySelectorAll<HTMLElement>(selector)).some(element =>
    isPointInRect(event, element.getBoundingClientRect(), padding)
  )

const isPointInGroupPrefix = (event: DragEvent, groupElement?: HTMLElement) => {
  if (groupElement == null) return false

  const groupRect = groupElement.getBoundingClientRect()
  const header = groupElement.querySelector<HTMLElement>('.dv-tabs-and-actions-container')
  const headerRect = header?.getBoundingClientRect() ?? groupRect
  return isPointInRect(event, headerRect) &&
    event.clientX >= groupRect.left &&
    event.clientX <= groupRect.left + GROUP_PREFIX_DROP_WIDTH
}

export const markInteractionPanelPinDropTargetHot = () => {
  pinDropTargetHotUntil = Date.now() + PIN_DROP_TARGET_HOT_MS
}

export const clearInteractionPanelPinDropTargetHot = () => {
  pinDropTargetHotUntil = 0
}

export const isInteractionPanelPinDropTargetHot = () => Date.now() <= pinDropTargetHotUntil

export const isInteractionPanelPinDropTarget = (event: DragEvent, groupElement?: HTMLElement) =>
  isPointInSelector(event, PIN_DROP_TARGET_SELECTOR, PIN_DROP_TARGET_PADDING) ||
  isInteractionPanelPinDropTargetHot() ||
  isPointInGroupPrefix(event, groupElement)
