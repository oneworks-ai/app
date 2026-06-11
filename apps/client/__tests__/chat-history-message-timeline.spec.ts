import { describe, expect, it } from 'vitest'

import type { ChatMessage, ChatMessageContent } from '@oneworks/core'

import {
  buildChatHistoryTimelineCurrentStatus,
  buildChatHistoryTimelineFromMessageTurns
} from '#~/components/chat/history-timeline/message-timeline'
import { buildMessageTurns } from '#~/components/chat/messages/message-turns'
import { processMessages } from '#~/components/chat/messages/message-utils'

const createMessage = ({
  content,
  createdAt,
  id,
  role
}: {
  content: string | ChatMessageContent[]
  createdAt: number
  id: string
  role: ChatMessage['role']
}): ChatMessage => ({
  content,
  createdAt,
  id,
  role
})

const projectMessages = (messages: ChatMessage[]) => {
  const turns = buildMessageTurns({
    expandedTurnIds: new Set(),
    keepLastTurnExpanded: false,
    renderItems: processMessages(messages)
  })

  return buildChatHistoryTimelineFromMessageTurns({ turns })
}

describe('chat history message timeline projection', () => {
  it('keeps user anchors and collapses ordinary assistant work to the final visible reply', () => {
    const messages: ChatMessage[] = [
      createMessage({
        content: 'Investigate the branch timeline.',
        createdAt: 1,
        id: 'user-1',
        role: 'user'
      }),
      createMessage({
        content: [
          { id: 'tool-1', input: { path: 'src' }, name: 'read_file', type: 'tool_use' }
        ],
        createdAt: 2,
        id: 'assistant-tool',
        role: 'assistant'
      }),
      createMessage({
        content: 'Intermediate note that should stay out of the timeline.',
        createdAt: 3,
        id: 'assistant-draft',
        role: 'assistant'
      }),
      createMessage({
        content: 'Final answer for the first turn.',
        createdAt: 4,
        id: 'assistant-final',
        role: 'assistant'
      }),
      createMessage({
        content: 'One more user constraint.',
        createdAt: 5,
        id: 'user-2',
        role: 'user'
      }),
      createMessage({
        content: 'Second final answer.',
        createdAt: 6,
        id: 'assistant-second-final',
        role: 'assistant'
      })
    ]

    const projection = projectMessages(messages)

    expect(projection.nodes.map(node => node.messageId)).toEqual([
      'user-1',
      'assistant-final',
      'user-2',
      'assistant-second-final'
    ])
    expect(projection.nodes.some(node => node.messageId === 'assistant-tool')).toBe(false)
    expect(projection.nodes.some(node => node.messageId === 'assistant-draft')).toBe(false)
    expect(projection.initialNodeId).toBe('message-assistant-second-final')
  })

  it('marks the current node with live session status', () => {
    const projection = buildChatHistoryTimelineFromMessageTurns({
      currentStatus: buildChatHistoryTimelineCurrentStatus({
        labels: { permission: 'Permission request' },
        sessionStatus: 'waiting_input',
        interactionKind: 'permission'
      }),
      turns: buildMessageTurns({
        expandedTurnIds: new Set(),
        keepLastTurnExpanded: true,
        renderItems: processMessages([
          createMessage({
            content: 'Can I edit this file?',
            createdAt: 1,
            id: 'user-1',
            role: 'user'
          })
        ])
      })
    })

    expect(projection.nodes.at(-1)?.info.status).toEqual({
      label: 'Permission request',
      state: 'permission'
    })
  })
})
