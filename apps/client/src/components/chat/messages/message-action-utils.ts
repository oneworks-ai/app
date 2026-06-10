import type { ChatRenderItem } from './message-render-types'

export function getLastMessageAnchorId(renderItems: ChatRenderItem[]) {
  for (let index = renderItems.length - 1; index >= 0; index -= 1) {
    const item = renderItems[index]
    if (item?.type === 'message') {
      return item.anchorId
    }
  }

  return null
}

export function getLastAssistantActionAnchorId(renderItems: ChatRenderItem[]) {
  const lastItem = renderItems[renderItems.length - 1]
  if (lastItem?.type === 'tool-group') {
    return null
  }

  for (let index = renderItems.length - 1; index >= 0; index -= 1) {
    const item = renderItems[index]
    if (item == null) continue
    if (item.type !== 'message') continue
    if (item.message.role === 'user') continue
    return item.anchorId
  }

  return null
}
