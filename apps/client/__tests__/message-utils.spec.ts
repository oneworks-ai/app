import { describe, expect, it } from 'vitest'

import type { ChatMessage } from '@oneworks/core'

import {
  getLastAssistantActionAnchorId,
  getLastMessageAnchorId
} from '#~/components/chat/messages/message-action-utils'
import { buildMessageTurns } from '#~/components/chat/messages/message-turns'
import { processMessages } from '#~/components/chat/messages/message-utils'

const createMessage = (
  id: string,
  role: ChatMessage['role'],
  content: ChatMessage['content']
): ChatMessage => ({
  id,
  role,
  content,
  createdAt: 1_700_000_000_000
})

describe('message render utils', () => {
  const childRequestContent = [
    '[Agent room child request] room-smoke-qa / Room链路QA验证 is waiting for your handling.',
    '',
    'Request: 允许执行命令 `/bin/zsh -lc "printenv | rg \'CODEX|ONEWORKS|ROOM|SESSION\'"`？',
    '',
    'Context:',
    '- memberKey: room-smoke-qa',
    '- runKey: sess_child',
    '- childSessionId: sess_child',
    '- interactionId: codex-approval:0',
    '- runtimeRequestKind: confirmation',
    '- runtimeInteractionKind: permission',
    '',
    'Child runtime options:',
    '- 同意本次 (allow_once) - 仅继续这次被拦截的操作。',
    '- 拒绝本次 (deny_once) - 拒绝当前这次操作。',
    '',
    'Leader action:',
    '- You may approve or deny this child request yourself.'
  ].join('\n')

  it('classifies agent room child request relays as standalone render items', () => {
    const renderItems = processMessages([
      createMessage('user-1', 'user', 'Start.'),
      createMessage('assistant-1', 'assistant', 'Started.'),
      createMessage('child-request-1', 'user', childRequestContent),
      createMessage('assistant-2', 'assistant', 'Submitted allow_once.')
    ])

    expect(renderItems.map(item => item.type)).toEqual([
      'message',
      'message',
      'agent-room-child-request',
      'message'
    ])
    const childRequest = renderItems[2]
    expect(childRequest?.type).toBe('agent-room-child-request')
    if (childRequest?.type === 'agent-room-child-request') {
      expect(childRequest.request.memberLabel).toBe('room-smoke-qa')
      expect(childRequest.request.runTitle).toBe('Room链路QA验证')
      expect(childRequest.request.options.map(option => option.value)).toEqual(['allow_once', 'deny_once'])
    }

    const turns = buildMessageTurns({
      expandedTurnIds: new Set(),
      keepLastTurnExpanded: false,
      renderItems
    })
    expect(turns.map(turn => turn.items.map(item => item.type))).toEqual([
      ['message', 'message'],
      ['agent-room-child-request'],
      ['message']
    ])
    expect(turns[1]?.isExpandable).toBe(false)
  })

  it('allows the live final turn to be manually collapsed after default expansion', () => {
    const renderItems = processMessages([
      createMessage('user-live', 'user', 'Keep working.'),
      createMessage('assistant-draft', 'assistant', 'Intermediate work.'),
      createMessage('assistant-final', 'assistant', 'Current final note.')
    ])

    const defaultTurns = buildMessageTurns({
      expandedTurnIds: new Set(),
      keepLastTurnExpanded: true,
      renderItems
    })
    expect(defaultTurns[0]?.isCollapsed).toBe(false)

    const collapsedTurns = buildMessageTurns({
      collapsedTurnIds: new Set(['user-live']),
      expandedTurnIds: new Set(),
      keepLastTurnExpanded: true,
      renderItems
    })
    expect(collapsedTurns[0]?.isCollapsed).toBe(true)

    const targetAnchorId = renderItems[1]?.anchorId
    const targetedTurns = buildMessageTurns({
      collapsedTurnIds: new Set(['user-live']),
      expandedTurnIds: new Set(),
      hashAnchorId: targetAnchorId,
      keepLastTurnExpanded: true,
      renderItems
    })
    expect(targetedTurns[0]?.isCollapsed).toBe(false)
  })

  it('does not attach visible assistant actions to text when the latest render item is a tool group', () => {
    const renderItems = processMessages([
      createMessage('user-1', 'user', 'Run the checks.'),
      createMessage('assistant-1', 'assistant', [
        { type: 'text', text: 'I will run the checks now.' },
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'adapter:codex:Shell',
          input: { cmd: 'pnpm test' }
        }
      ])
    ])

    expect(renderItems.map(item => item.type)).toEqual(['message', 'message', 'tool-group'])
    expect(getLastAssistantActionAnchorId(renderItems)).toBeNull()
  })

  it('keeps actions on the latest assistant text when the turn ends with text', () => {
    const renderItems = processMessages([
      createMessage('user-1', 'user', 'Summarize the output.'),
      createMessage('assistant-1', 'assistant', [
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'adapter:codex:Shell',
          input: { cmd: 'pnpm test' }
        },
        { type: 'text', text: 'The checks passed.' }
      ])
    ])
    let latestMessageAnchorId: string | undefined
    for (let index = renderItems.length - 1; index >= 0; index -= 1) {
      const item = renderItems[index]
      if (item?.type === 'message' && item.message.role === 'assistant') {
        latestMessageAnchorId = item.anchorId
        break
      }
    }

    expect(latestMessageAnchorId).toBeDefined()
    expect(getLastAssistantActionAnchorId(renderItems)).toBe(latestMessageAnchorId)
  })

  it('tracks the latest message bubble even when tool groups are rendered after it', () => {
    const renderItems = processMessages([
      createMessage('user-1', 'user', 'Run the checks.'),
      createMessage('assistant-1', 'assistant', [
        { type: 'text', text: 'I will run the checks now.' },
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'adapter:codex:Shell',
          input: { cmd: 'pnpm test' }
        }
      ])
    ])
    let latestMessageAnchorId: string | undefined
    for (let index = renderItems.length - 1; index >= 0; index -= 1) {
      const item = renderItems[index]
      if (item?.type === 'message') {
        latestMessageAnchorId = item.anchorId
        break
      }
    }

    expect(latestMessageAnchorId).toBeDefined()
    expect(getLastMessageAnchorId(renderItems)).toBe(latestMessageAnchorId)
  })

  it('returns the newest user message bubble when a user message is last', () => {
    const renderItems = processMessages([
      createMessage('user-1', 'user', 'Start.'),
      createMessage('assistant-1', 'assistant', 'Done.'),
      createMessage('user-2', 'user', 'One more thing.')
    ])

    expect(getLastMessageAnchorId(renderItems)).toBe('message-user-2')
  })

  it('preserves the existing latest assistant action when a user message follows it', () => {
    const renderItems = processMessages([
      createMessage('user-1', 'user', 'Start.'),
      createMessage('assistant-1', 'assistant', 'Done.'),
      createMessage('user-2', 'user', 'One more thing.')
    ])

    expect(getLastAssistantActionAnchorId(renderItems)).toBe('message-assistant-1')
  })
})
