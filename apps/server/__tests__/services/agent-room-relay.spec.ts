import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RelayRoomDescriptor } from '@oneworks/types'

import { SqliteDb } from '#~/db/index.js'
import { createSqliteDatabase } from '#~/db/sqlite.js'
import { createAgentRoomRelayFacade, listActiveAgentRoomRelayOwners } from '#~/services/agent-room/relay.js'

const state = vi.hoisted(() => ({ db: undefined as unknown as SqliteDb }))

vi.mock('#~/db/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('#~/db/index.js')>()
  return { ...original, getDb: () => state.db }
})

const createTunnel = (
  publishDescriptor: (descriptor: RelayRoomDescriptor) => boolean,
  initiallyConnected = true
) => {
  let connected = initiallyConnected
  const listeners = new Set<(next: boolean) => void>()
  return {
    setConnected(next: boolean) {
      if (connected === next) return
      connected = next
      for (const listener of listeners) listener(next)
    },
    tunnel: {
      isConnected: () => connected,
      publishDescriptor,
      subscribeConnection: (listener: (next: boolean) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }
    }
  }
}

describe('agent Room Relay owner facade', () => {
  let facade: ReturnType<typeof createAgentRoomRelayFacade>
  const ownerSourceId = 'relay-main'
  const handleRequest = (request: Parameters<typeof facade.handleRequest>[0]) =>
    facade.handleRequest(request, ownerSourceId)

  beforeEach(() => {
    state.db = new SqliteDb({ db: createSqliteDatabase(':memory:') })
    state.db.createAgentRoom({
      id: 'room-1',
      title: 'Shared build room',
      owner: { type: 'local', accountId: 'owner-user', nodeId: 'device-1', sourceId: ownerSourceId }
    })
    state.db.appendAgentRoomMessage({
      content: 'Private live transcript.',
      idempotencyKey: 'message-1',
      origin: {
        accountId: 'raw-provider-account',
        channelId: 'raw-provider-channel',
        channelKey: 'raw-provider-key',
        channelType: 'lark',
        conversationKind: 'group',
        providerMessageId: 'raw-provider-message',
        threadId: 'raw-provider-thread'
      },
      role: 'agent',
      roomId: 'room-1'
    })
    state.db.saveAgentRoomChannelConnection({
      channelId: 'raw-provider-channel',
      channelKey: 'raw-provider-key',
      channelLinkName: 'room-link',
      channelType: 'lark',
      conversationKind: 'group',
      entity: 'product',
      label: 'Product group',
      memberKey: 'product',
      muted: false,
      receiveId: 'raw-provider-receive-id',
      receiveIdType: 'chat_id',
      roomId: 'room-1',
      requireMention: false,
      status: 'active',
      threadId: 'raw-provider-thread'
    })
    state.db.createAgentRoomShare({
      grants: [
        { principalId: 'viewer-user', principalType: 'user', permissions: ['view', 'open_run'] },
        { principalId: 'team-1', principalType: 'team', permissions: ['view'] }
      ],
      id: 'share-1',
      roomId: 'room-1'
    })
    facade = createAgentRoomRelayFacade()
  })

  afterEach(() => {
    facade.dispose()
    state.db.close()
  })

  it('publishes only descriptors and serves transcript content through a live ACL-checked request', async () => {
    const publishDescriptor = vi.fn((_descriptor: RelayRoomDescriptor) => true)
    facade.registerTunnel(createTunnel(publishDescriptor).tunnel, {
      ownerDeviceId: 'device-1',
      ownerLabel: 'Primary Relay account',
      ownerSourceId,
      ownerUserId: 'owner-user'
    })

    expect(listActiveAgentRoomRelayOwners()).toEqual([{
      accountId: 'owner-user',
      label: 'Primary Relay account',
      nodeId: 'device-1',
      sourceId: ownerSourceId
    }])

    expect(publishDescriptor).toHaveBeenCalledWith(expect.objectContaining({
      acls: expect.arrayContaining([
        expect.objectContaining({ principalId: 'viewer-user', permissions: ['view', 'open_run'] })
      ]),
      ownerDeviceId: 'device-1',
      ownerNodeId: 'device-1',
      ownerUserId: 'owner-user',
      shareId: 'share-1',
      status: 'active',
      title: 'Shared build room'
    }))
    expect(publishDescriptor.mock.calls[0]?.[0]).not.toHaveProperty('roomId')
    expect(JSON.stringify(publishDescriptor.mock.calls[0]?.[0])).not.toContain('Private live transcript')

    const result = await handleRequest({
      action: 'view',
      operationId: 'operation-view-1',
      principal: { id: 'viewer-user', type: 'user' },
      requestId: 'request-1',
      shareId: 'share-1'
    })

    expect(result).toEqual(expect.objectContaining({
      messages: [expect.objectContaining({ content: 'Private live transcript.' })],
      room: expect.objectContaining({ roomRef: expect.any(String), title: 'Shared build room' })
    }))
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('hostSessionId')
    expect(serialized).not.toContain('sessionId')
    expect(serialized).not.toContain('raw-provider-account')
    expect(serialized).not.toContain('raw-provider-channel')
    expect(serialized).not.toContain('raw-provider-key')
    expect(serialized).not.toContain('raw-provider-message')
    expect(serialized).not.toContain('raw-provider-receive-id')
    expect(serialized).not.toContain('raw-provider-thread')
  })

  it('rechecks direct and team grants locally for every request', async () => {
    await expect(handleRequest({
      action: 'view',
      operationId: 'operation-team-view',
      principal: { id: 'team-viewer', teamIds: ['team-1'], type: 'user' },
      requestId: 'request-team',
      shareId: 'share-1'
    })).resolves.toEqual(expect.objectContaining({
      room: expect.objectContaining({ roomRef: expect.any(String) })
    }))

    await expect(handleRequest({
      action: 'view',
      operationId: 'operation-denied',
      principal: { id: 'unknown-user', type: 'user' },
      requestId: 'request-denied',
      shareId: 'share-1'
    })).rejects.toThrow('Room permission denied')

    await expect(handleRequest({
      action: 'target_member',
      operationId: 'operation-target-denied',
      body: { content: 'Do not deliver.', target: { memberKey: 'architect' } },
      principal: { id: 'viewer-user', type: 'user' },
      requestId: 'request-target-denied',
      shareId: 'share-1'
    })).rejects.toThrow('Room permission denied')
  })

  it('scopes owner authority to the requested Room instead of any registered Relay owner', async () => {
    facade.registerTunnel(createTunnel(vi.fn((_descriptor: RelayRoomDescriptor) => true)).tunnel, {
      ownerDeviceId: 'device-1',
      ownerSourceId,
      ownerUserId: 'owner-user'
    })
    facade.registerTunnel(createTunnel(vi.fn((_descriptor: RelayRoomDescriptor) => true)).tunnel, {
      ownerDeviceId: 'device-2',
      ownerSourceId,
      ownerUserId: 'other-owner'
    })

    await expect(handleRequest({
      action: 'view',
      operationId: 'operation-room-owner',
      principal: { id: 'owner-user', type: 'user' },
      requestId: 'request-room-owner',
      shareId: 'share-1'
    })).resolves.toEqual(expect.objectContaining({
      room: expect.objectContaining({ roomRef: expect.any(String) })
    }))

    await expect(handleRequest({
      action: 'manage_share',
      operationId: 'operation-cross-owner-manage',
      body: {
        operation: 'create',
        grants: [{
          principalId: 'other-owner',
          principalType: 'user',
          permissions: ['view']
        }]
      },
      principal: { id: 'other-owner', type: 'user' },
      requestId: 'request-cross-owner-manage',
      shareId: 'share-1'
    })).rejects.toThrow('Room permission denied')
  })

  it('does not publish an ownerless Room to multiple Relay accounts', () => {
    state.db.createAgentRoom({ id: 'room-ownerless', title: 'Ownerless room' })
    state.db.createAgentRoomShare({
      grants: [{ principalId: 'viewer-user', principalType: 'user', permissions: ['view'] }],
      id: 'share-ownerless',
      roomId: 'room-ownerless'
    })
    const first = vi.fn((_descriptor: RelayRoomDescriptor) => true)
    const second = vi.fn((_descriptor: RelayRoomDescriptor) => true)

    facade.registerTunnel(createTunnel(first).tunnel, {
      ownerDeviceId: 'device-1',
      ownerSourceId,
      ownerUserId: 'owner-user'
    })
    facade.registerTunnel(createTunnel(second).tunnel, {
      ownerDeviceId: 'device-2',
      ownerSourceId,
      ownerUserId: 'other-owner'
    })

    expect(first.mock.calls.some(call => call[0].shareId === 'share-ownerless')).toBe(false)
    expect(second.mock.calls.some(call => call[0].shareId === 'share-ownerless')).toBe(false)
  })

  it('publishes a shared Room only through its selected owner node', () => {
    const selected = vi.fn((_descriptor: RelayRoomDescriptor) => true)
    const otherNode = vi.fn((_descriptor: RelayRoomDescriptor) => true)

    facade.registerTunnel(createTunnel(selected).tunnel, {
      ownerDeviceId: 'device-1',
      ownerSourceId,
      ownerUserId: 'owner-user'
    })
    facade.registerTunnel(createTunnel(otherNode).tunnel, {
      ownerDeviceId: 'device-2',
      ownerSourceId,
      ownerUserId: 'owner-user'
    })

    expect(selected.mock.calls.some(call => call[0].shareId === 'share-1')).toBe(true)
    expect(otherNode.mock.calls.some(call => call[0].shareId === 'share-1')).toBe(false)
  })

  it('uses the stable Relay operation identifier for a retried mutation', async () => {
    const request = {
      action: 'manage_share' as const,
      body: {
        operation: 'create',
        grants: [{ principalId: 'retry-viewer', principalType: 'user' as const, permissions: ['view' as const] }]
      },
      operationId: 'retry-operation-1',
      principal: { id: 'owner-user', type: 'user' as const },
      shareId: 'share-1'
    }

    await handleRequest({ ...request, requestId: 'transport-attempt-1' })
    await handleRequest({ ...request, requestId: 'transport-attempt-2' })

    expect(state.db.listAgentRoomShares('room-1').filter(share => share.id.includes('retry-operation-1'))).toHaveLength(
      1
    )
  })

  it('tracks owner presence from the live tunnel and republishes descriptors after reconnect', () => {
    const publishDescriptor = vi.fn((_descriptor: RelayRoomDescriptor) => true)
    const relay = createTunnel(publishDescriptor, false)

    facade.registerTunnel(relay.tunnel, {
      ownerDeviceId: 'device-1',
      ownerLabel: 'Primary Relay account',
      ownerSourceId,
      ownerUserId: 'owner-user'
    })

    expect(listActiveAgentRoomRelayOwners()).toEqual([])
    expect(publishDescriptor).not.toHaveBeenCalled()

    relay.setConnected(true)
    expect(listActiveAgentRoomRelayOwners()).toEqual([{
      accountId: 'owner-user',
      label: 'Primary Relay account',
      nodeId: 'device-1',
      sourceId: ownerSourceId
    }])
    expect(publishDescriptor).toHaveBeenCalledTimes(1)

    relay.setConnected(false)
    expect(listActiveAgentRoomRelayOwners()).toEqual([])

    relay.setConnected(true)
    expect(publishDescriptor).toHaveBeenCalledTimes(2)
  })

  it('isolates identical owner account and device ids across Relay services', async () => {
    const selected = vi.fn((_descriptor: RelayRoomDescriptor) => true)
    const other = vi.fn((_descriptor: RelayRoomDescriptor) => true)
    facade.registerTunnel(createTunnel(selected).tunnel, {
      ownerDeviceId: 'device-1',
      ownerSourceId,
      ownerUserId: 'owner-user'
    })
    facade.registerTunnel(createTunnel(other).tunnel, {
      ownerDeviceId: 'device-1',
      ownerSourceId: 'relay-other',
      ownerUserId: 'owner-user'
    })

    expect(selected.mock.calls.some(call => call[0].shareId === 'share-1')).toBe(true)
    expect(other.mock.calls.some(call => call[0].shareId === 'share-1')).toBe(false)
    await expect(facade.handleRequest({
      action: 'view',
      operationId: 'cross-relay-view',
      principal: { id: 'owner-user', type: 'user' },
      requestId: 'cross-relay-request',
      shareId: 'share-1'
    }, 'relay-other')).rejects.toThrow('Room is unavailable')
  })

  it('returns only a generic acknowledgement for remote mutations', async () => {
    const result = await handleRequest({
      action: 'manage_share',
      body: {
        grants: [{ principalId: 'new-viewer', principalType: 'user', permissions: ['view'] }],
        operation: 'create'
      },
      operationId: 'sanitized-mutation',
      principal: { id: 'owner-user', type: 'user' },
      requestId: 'sanitized-request',
      shareId: 'share-1'
    })

    expect(result).toEqual({ handled: true })
    expect(JSON.stringify(result)).not.toMatch(/room|message|session|delivery|shareId/iu)
  })
})
