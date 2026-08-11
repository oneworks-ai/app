import { afterEach, describe, expect, it } from 'vitest'

import { createChannelOutboundDeliveriesRepo } from '../../src/db/channelOutboundDeliveries/repo'
import { channelOutboundDeliveriesSchemaModule } from '../../src/db/channelOutboundDeliveries/schema'
import { initSchema } from '../../src/db/schema'
import { createSqliteDatabase } from '../../src/db/sqlite'
import type { SqliteDatabase } from '../../src/db/sqlite'

describe('channel outbound deliveries', () => {
  let sqlite: SqliteDatabase | undefined

  afterEach(() => sqlite?.close())

  it('durably upserts a native delivery while preserving its creation time', () => {
    sqlite = createSqliteDatabase(':memory:')
    initSchema(sqlite, [channelOutboundDeliveriesSchemaModule])
    const repo = createChannelOutboundDeliveriesRepo(sqlite)

    const created = repo.upsert({
      channelKey: 'native-main',
      channelType: 'oneworks',
      createdAt: 100,
      messageId: 'message-1',
      receiveId: 'room-1',
      receiveIdType: 'room',
      text: 'initial'
    })
    const updated = repo.upsert({
      channelKey: 'native-main',
      channelType: 'oneworks',
      createdAt: 999,
      messageId: 'message-1',
      receiveId: 'room-1',
      receiveIdType: 'room',
      text: 'updated',
      updatedAt: 200
    })

    expect(updated).toMatchObject({
      createdAt: 100,
      id: created?.id,
      text: 'updated',
      updatedAt: 200
    })
    expect(repo.listRecent('oneworks')).toEqual([updated])
  })

  it('claims an outbound operation once and only finishes the pending claim', () => {
    sqlite = createSqliteDatabase(':memory:')
    initSchema(sqlite, [channelOutboundDeliveriesSchemaModule])
    const repo = createChannelOutboundDeliveriesRepo(sqlite)
    const claim = {
      channelKey: 'lark:product',
      channelType: 'lark',
      commandRunId: 'command-1',
      operationId: 'operation-1',
      payloadHash: 'payload-hash',
      target: {
        channelId: 'oc_product',
        channelKey: 'lark:product',
        channelType: 'lark',
        conversationKind: 'group' as const,
        label: 'Product group',
        receiveId: 'oc_product',
        receiveIdType: 'chat_id'
      }
    }

    expect(repo.claimOperation(claim)).toMatchObject({
      claimed: true,
      operation: { operationId: 'operation-1', status: 'pending' }
    })
    expect(repo.claimOperation(claim)).toMatchObject({
      claimed: false,
      operation: { operationId: 'operation-1', status: 'pending' }
    })

    expect(repo.finishOperation('operation-1', {
      navigation: { conversationWebUrl: 'https://example.test/conversation' },
      providerMessageId: 'om_1',
      status: 'sent'
    })).toMatchObject({
      navigation: { conversationWebUrl: 'https://example.test/conversation' },
      providerMessageId: 'om_1',
      status: 'sent'
    })
    expect(repo.finishOperation('operation-1', {
      error: 'late failure',
      status: 'failed'
    })).toMatchObject({
      error: null,
      status: 'sent'
    })
  })
})
