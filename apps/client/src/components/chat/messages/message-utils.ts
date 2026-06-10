import type { ChatMessage, ChatMessageContent } from '@oneworks/core'

import { getMessageAnchorId } from '#~/utils/chat-links.js'

import { parseAgentRoomChildRequest } from './agent-room-child-request'
import type { ChatRenderItem } from './message-render-types'

export function processMessages(messages: ChatMessage[]): ChatRenderItem[] {
  const result: ChatRenderItem[] = []

  const findResult = (
    toolId: string,
    startIndex: number,
    allMsgs: ChatMessage[]
  ): Extract<ChatMessageContent, { type: 'tool_result' }> | undefined => {
    for (let i = startIndex; i < allMsgs.length; i++) {
      const msg = allMsgs[i]
      if (Array.isArray(msg.content)) {
        const found = msg.content.find(
          (c: ChatMessageContent) => c.type === 'tool_result' && c.tool_use_id === toolId
        )
        if (found) {
          return found as Extract<ChatMessageContent, { type: 'tool_result' }>
        }
      }
    }
    return undefined
  }

  let i = 0
  while (i < messages.length) {
    const msg = messages[i]
    if (!msg || !msg.content) {
      // If content is null/empty but legacy toolCall exists, we should render it
      if (msg && msg.toolCall) {
        result.push({
          anchorId: getMessageAnchorId(msg.id),
          originalMessage: msg,
          type: 'message',
          message: msg,
          isFirstInGroup: i === 0 || (i > 0 && messages[i - 1]?.role !== msg.role)
        })
      }
      i++
      continue
    }

    const prevMsg = i > 0 ? messages[i - 1] : null
    const isFirstInGroup = i === 0 || (prevMsg != null && prevMsg.role !== msg.role)

    if (typeof msg.content === 'string') {
      const agentRoomChildRequest = parseAgentRoomChildRequest(msg.content)
      if (agentRoomChildRequest != null) {
        result.push({
          anchorId: getMessageAnchorId(msg.id),
          originalMessage: msg,
          type: 'agent-room-child-request',
          request: agentRoomChildRequest
        })
        i++
        continue
      }

      result.push({
        anchorId: getMessageAnchorId(msg.id),
        originalMessage: msg,
        type: 'message',
        message: msg,
        isFirstInGroup
      })
      i++
      continue
    }

    if (Array.isArray(msg.content)) {
      const content = msg.content
      const textParts: ChatMessageContent[] = []
      let currentToolGroup: {
        item: Extract<ChatMessageContent, { type: 'tool_use' }>
        resultItem?: Extract<ChatMessageContent, { type: 'tool_result' }>
      }[] = []

      let producedCount = 0

      const flushTools = () => {
        if (currentToolGroup.length > 0) {
          result.push({
            anchorId: getMessageAnchorId(msg.id, `tool-${producedCount}`),
            originalMessage: msg,
            type: 'tool-group',
            id: `group-${msg.id}-${producedCount}`,
            items: [...currentToolGroup],
            footer: undefined
          })
          currentToolGroup = []
          producedCount++
        }
      }

      const flushText = () => {
        if (textParts.length > 0) {
          result.push({
            anchorId: getMessageAnchorId(msg.id, `text-${producedCount}`),
            originalMessage: msg,
            type: 'message',
            message: {
              ...msg,
              id: `${msg.id}-text-${producedCount}`,
              content: [...textParts]
            },
            isFirstInGroup: isFirstInGroup && producedCount === 0
          })
          textParts.length = 0
          producedCount++
        }
      }

      for (const item of content) {
        if (item.type === 'text' || item.type === 'image' || item.type === 'file') {
          flushTools()
          textParts.push(item)
        } else if (item.type === 'tool_use') {
          flushText()
          const resultItem = findResult(item.id, i, messages)
          currentToolGroup.push({ item, resultItem })
        }
      }

      flushText()
      flushTools()

      // Handle legacy toolCall if no other content was produced
      if (producedCount === 0 && msg.toolCall) {
        result.push({
          anchorId: getMessageAnchorId(msg.id),
          originalMessage: msg,
          type: 'message',
          message: msg,
          isFirstInGroup
        })
        producedCount++
      }

      if (producedCount > 0) {
        const lastItem = result[result.length - 1]
        if (lastItem.type === 'tool-group') {
          lastItem.footer = {
            model: msg.model,
            usage: msg.usage,
            createdAt: msg.createdAt,
            originalMessage: msg
          }
        }
      }
    }
    i++
  }

  const mergedResult: ChatRenderItem[] = []
  for (const item of result) {
    if (item.type === 'tool-group') {
      const prev = mergedResult[mergedResult.length - 1]
      if (prev && prev.type === 'tool-group') {
        prev.items.push(...item.items)
        prev.originalMessage = item.originalMessage
        prev.anchorId = item.anchorId
        if (item.footer) {
          prev.footer = item.footer
        }
        continue
      }
    }
    mergedResult.push(item)
  }

  return mergedResult
}
