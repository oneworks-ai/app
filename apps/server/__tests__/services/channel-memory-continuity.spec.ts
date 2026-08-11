import { describe, expect, it } from 'vitest'

import type { ChannelMemoryRow } from '../../src/db/channelMemories/repo'
import {
  filterChannelMemoryCandidates,
  rankChannelMemories,
  selectChannelMemoryBudget
} from '../../src/services/channel-memory'

const memory = (overrides: Partial<ChannelMemoryRow> = {}): ChannelMemoryRow => ({
  accountId: null,
  canonicalUserId: null,
  channelId: null,
  channelKey: null,
  confidence: 1,
  content: 'release context',
  createdAt: 1,
  entity: 'bot',
  expiresAt: null,
  id: 'memory',
  importance: 1,
  issuer: 'issuer-a',
  keywords: ['release'],
  metadata: null,
  orgId: 'org-a',
  pinned: false,
  roomId: null,
  sensitivity: 'normal',
  source: { issuer: 'issuer-a', org: 'org-a', sessionType: 'group' },
  subjectId: 'bot',
  subjectType: 'entity',
  threadKey: null,
  updatedAt: 100,
  visibility: {
    channels: ['lark:main:chat-a'],
    conversationTypes: ['group'],
    entities: ['bot'],
    orgs: ['org-a']
  },
  ...overrides
})

const scope = {
  accountId: 'account-a',
  channelId: 'chat-a',
  channelKey: 'main',
  channelType: 'lark',
  entity: 'bot',
  issuer: 'issuer-a',
  orgId: 'org-a',
  roomId: 'room-a',
  sessionType: 'group',
  threadKey: 'thread-a'
}

describe('channel memory resolver primitives', () => {
  it('rejects sensitive, private-to-group, unknown visibility, and cross-org candidates', () => {
    const result = filterChannelMemoryCandidates(
      [
        memory({ id: 'allowed' }),
        memory({ id: 'sensitive', sensitivity: 'sensitive' }),
        memory({
          id: 'private',
          source: { issuer: 'issuer-a', org: 'org-a', sessionType: 'direct' },
          subjectType: 'canonical_user',
          canonicalUserId: 'user-a'
        }),
        memory({
          accountId: 'account-a',
          id: 'private-account',
          source: { issuer: 'issuer-a', org: 'org-a', sessionType: 'direct' },
          subjectId: 'account-a',
          subjectType: 'account'
        }),
        memory({ id: 'unknown-visibility', visibility: null }),
        memory({ id: 'cross-org', orgId: 'org-b', source: { issuer: 'issuer-b', org: 'org-b', sessionType: 'group' } })
      ],
      { ...scope, canonicalUserId: 'user-a' },
      200
    )
    expect(result.filtered.map(item => item.id)).toEqual(['allowed'])
    expect(result.filteredCounts.sensitive).toBe(1)
    expect(result.filteredCounts.scope).toBe(3)
    expect(result.filteredCounts.visibility).toBe(1)
  })

  it('ranks pins first and applies a deterministic token/item budget', () => {
    const ranked = rankChannelMemories(
      [
        memory({ id: 'normal', content: 'x'.repeat(32), updatedAt: 10 }),
        memory({ id: 'pinned', content: 'x'.repeat(32), pinned: true, updatedAt: 1 })
      ],
      ['release'],
      100
    )
    expect(ranked.map(item => item.id)).toEqual(['pinned', 'normal'])
    expect(selectChannelMemoryBudget(ranked, { maxItems: 1, maxTokens: 20 }).selected.map(item => item.id)).toEqual([
      'pinned'
    ])
  })

  it('allows entity memory to cross channels when visibility does not restrict channel ids', () => {
    const result = filterChannelMemoryCandidates(
      [memory({
        id: 'entity-wide',
        visibility: {
          conversationTypes: ['direct', 'group'],
          entities: ['bot'],
          orgs: ['org-a']
        }
      })],
      { ...scope, channelId: 'chat-b' },
      200
    )

    expect(result.filtered.map(item => item.id)).toEqual(['entity-wide'])
  })

  it('shares Room memory across channel accounts but never across Rooms', () => {
    const roomMemory = memory({
      channelId: null,
      channelKey: null,
      id: 'room-memory',
      roomId: 'room-a',
      subjectId: 'room-a',
      subjectType: 'room',
      visibility: {
        conversationTypes: ['group'],
        entities: ['bot'],
        orgs: ['org-a'],
        rooms: ['room-a']
      }
    })

    const sameRoomOtherAccount = filterChannelMemoryCandidates(
      [roomMemory],
      { ...scope, channelId: 'wechat-chat', channelKey: 'service', channelType: 'wechat' },
      200
    )
    const anotherRoom = filterChannelMemoryCandidates(
      [roomMemory],
      { ...scope, roomId: 'room-b' },
      200
    )

    expect(sameRoomOtherAccount.filtered.map(item => item.id)).toEqual(['room-memory'])
    expect(anotherRoom.filtered).toEqual([])
    expect(anotherRoom.filteredCounts.scope).toBe(1)
  })

  it('keeps entity memory available across Rooms when visibility is entity-wide', () => {
    const result = filterChannelMemoryCandidates(
      [memory({
        id: 'entity-cross-room',
        visibility: {
          conversationTypes: ['direct', 'group'],
          entities: ['bot'],
          orgs: ['org-a']
        }
      })],
      { ...scope, roomId: 'room-b' },
      200
    )

    expect(result.filtered.map(item => item.id)).toEqual(['entity-cross-room'])
  })
})
