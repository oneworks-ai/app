import { describe, expect, it } from 'vitest'

import type { SessionInfo } from '@oneworks/types'

import {
  getAgentRoomMentionCompletions,
  getAgentRoomMentionQuery
} from '#~/components/agent-room/@core/resolve-room-target'
import type { AgentRoomTargetMember } from '#~/components/agent-room/@core/resolve-room-target'
import { resolveSenderCompletionMatch } from '#~/components/chat/sender/@utils/sender-completion'

const members: AgentRoomTargetMember[] = [
  {
    memberKey: 'member:architect',
    kind: 'entity',
    label: 'architect',
    runs: [
      {
        runKey: 'run:schema-plan',
        memberKey: 'member:architect',
        title: 'schema-plan'
      },
      {
        runKey: 'run:billing-review',
        memberKey: 'member:architect',
        title: 'billing-review'
      }
    ]
  }
]

const roomSenderSessionInfo: SessionInfo = {
  type: 'init',
  uuid: 'room-1',
  model: 'agent-room',
  version: 'agent-room',
  tools: [],
  slashCommands: [],
  cwd: '',
  agents: ['architect', 'architect/schema-plan', 'architect/billing-review']
}

const sessionSenderInfo: SessionInfo = {
  type: 'init',
  uuid: 'session-1',
  model: 'gpt-5',
  version: 'session',
  tools: [],
  slashCommands: ['plan', 'review'],
  cwd: '',
  agents: []
}

describe('agent room mention completion', () => {
  it('detects the active @mention query near the caret', () => {
    expect(getAgentRoomMentionQuery('Please ask @architect/sc', 'Please ask @architect/sc'.length)).toBe(
      'architect/sc'
    )
  })

  it('includes room members and runs in completion results', () => {
    expect(getAgentRoomMentionCompletions(members, 'architect').map(item => item.value)).toEqual([
      '@architect',
      '@architect/schema-plan',
      '@architect/billing-review'
    ])
  })

  it('filters run completions by @member/run query', () => {
    expect(getAgentRoomMentionCompletions(members, 'architect/sc').map(item => item.value)).toEqual([
      '@architect/schema-plan'
    ])
  })

  it('feeds @member/run completions through the shared sender completion source', () => {
    const match = resolveSenderCompletionMatch(
      '@architect/sc',
      '@architect/sc'.length,
      roomSenderSessionInfo
    )

    expect(match?.replaceStart).toBe(0)
    expect(match?.items.map(item => item.value)).toEqual(['architect/schema-plan'])
    expect(
      match?.items.map(item => ({
        label: item.label,
        insertText: item.insertText,
        filterText: item.filterText
      }))
    ).toEqual([
      {
        label: '@architect/schema-plan',
        insertText: '@architect/schema-plan ',
        filterText: '@architect/schema-plan'
      }
    ])
  })

  it('keeps normal slash command completion text aligned with the replacement range', () => {
    const match = resolveSenderCompletionMatch('/pl', '/pl'.length, sessionSenderInfo)

    expect(match?.replaceStart).toBe(0)
    expect(
      match?.items.map(item => ({
        label: item.label,
        insertText: item.insertText,
        filterText: item.filterText
      }))
    ).toEqual([
      {
        label: '/plan',
        insertText: '/plan ',
        filterText: '/plan'
      }
    ])
  })
})
