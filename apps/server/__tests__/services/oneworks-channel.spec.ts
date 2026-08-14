import { beforeEach, describe, expect, it, vi } from 'vitest'

import { verifyOneWorksWebhookSignature } from '@oneworks/channel-oneworks/webhook-signature'
import type { PluginRequestPrincipal } from '@oneworks/types'

const handleChannelWebhook = vi.fn()
const getChannelManager = vi.fn()
const getDb = vi.fn()
const executeRoomCommand = vi.fn()
const executeAgentRoomCommand = vi.fn()
const upsertRoomMember = vi.fn()
const createAgentRoomService = vi.fn(() => ({
  applyEvent: vi.fn(),
  createRoom: vi.fn(),
  executeCommand: executeAgentRoomCommand,
  upsertMember: upsertRoomMember
}))
const createSessionWithInitialMessage = vi.fn()
const listActiveAgentRoomRelayOwners = vi.fn()
const resolveWorkspaceImageResource = vi.fn()
const workspacePrincipal: PluginRequestPrincipal = {
  id: 'local-workspace',
  kind: 'local_workspace',
  permissions: ['workspace:read', 'workspace:manage']
}

vi.mock('#~/channels/index.js', () => ({ getChannelManager }))
vi.mock('#~/channels/webhook.js', () => ({ handleChannelWebhook }))
vi.mock('#~/db/index.js', () => ({ getDb }))
vi.mock('#~/services/agent-room/owner.js', () => ({
  createAgentRoomOwner: vi.fn(() => ({ execute: executeRoomCommand }))
}))
vi.mock('#~/services/agent-room/index.js', () => ({ createAgentRoomService }))
vi.mock('#~/services/agent-room/relay.js', () => ({ listActiveAgentRoomRelayOwners }))
vi.mock('#~/services/session/create.js', () => ({ createSessionWithInitialMessage }))
vi.mock('#~/services/workspace/media.js', () => ({ resolveWorkspaceImageResource }))
vi.mock('@oneworks/definition-loader', () => ({
  DefinitionLoader: class {
    loadDefaultEntities = async () => [
      {
        attributes: { description: 'Team leader', name: 'leader' },
        body: 'Team leader',
        path: '/entities/leader/README.md',
        resolvedName: 'leader'
      },
      {
        attributes: { description: 'Quality assurance', name: 'qa' },
        body: 'Quality assurance',
        path: '/entities/qa/README.md',
        resolvedName: 'qa'
      }
    ]
  }
}))

describe('oneWorks Channel service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveWorkspaceImageResource.mockResolvedValue({ mimeType: 'image/png' })
    createAgentRoomService.mockReturnValue({
      applyEvent: vi.fn(),
      createRoom: vi.fn(),
      executeCommand: executeAgentRoomCommand,
      upsertMember: upsertRoomMember
    })
    listActiveAgentRoomRelayOwners.mockReturnValue([{
      accountId: 'relay-owner-account',
      label: 'OneWorks owner',
      nodeId: 'relay-owner-node',
      sourceId: 'relay-main'
    }])
  })

  it('rejects read-only callers before exposing product room state', async () => {
    const { createOneWorksChannelFacade } = await import('#~/services/oneworks-channel/index.js')
    const readOnlyPrincipal: PluginRequestPrincipal = {
      id: 'viewer',
      kind: 'web_account',
      permissions: ['workspace:read']
    }

    await expect(createOneWorksChannelFacade().listRooms(readOnlyPrincipal)).rejects.toMatchObject({
      name: 'PluginProxyPermissionError',
      permission: 'workspace:manage'
    })
    expect(getDb).not.toHaveBeenCalled()
    expect(getChannelManager).not.toHaveBeenCalled()
  })

  it('lists Agent Rooms separately from provider-specific simulation targets', async () => {
    resolveWorkspaceImageResource.mockRejectedValue(new Error('Workspace resource not found'))
    getDb.mockReturnValue({
      getAgentRoomDetail: vi.fn(() => ({
        channelConnections: [
          { accountLabel: 'Product bot', channelKey: 'lark-main', channelType: 'lark', memberKey: 'entity:product' },
          { accountLabel: 'Service bot', channelKey: 'wechat-main', channelType: 'wechat', memberKey: 'entity:product' }
        ],
        members: [{ avatar: '.oo/entities/product/avatar.png', key: 'entity:product', label: 'Product' }],
        messages: [{ id: 'room-message' }],
        shares: [{ id: 'share', status: 'active' }]
      })),
      listAgentRooms: vi.fn(() => [{
        createdAt: 1,
        id: 'product-room',
        lastMessage: 'Latest decision',
        owner: { type: 'local' },
        status: 'active',
        title: 'Product Room',
        updatedAt: 2
      }])
    })
    getChannelManager.mockReturnValue({
      states: new Map([
        ['lark-main', {
          channelLinks: [{ address: { id: 'lark-room', kind: 'group' }, name: 'Lark operations' }],
          config: { type: 'lark' },
          key: 'lark-main',
          status: 'connected',
          type: 'lark'
        }],
        ['wechat-main', {
          channelLinks: [{ address: { id: 'wechat-room', kind: 'group' }, name: 'WeChat operations' }],
          config: { type: 'wechat' },
          key: 'wechat-main',
          status: 'disabled',
          type: 'wechat'
        }],
        ['oneworks-main', {
          channelLinks: [{ address: { id: 'oneworks-room', kind: 'group' }, name: 'OneWorks operations' }],
          config: { type: 'oneworks', webhookSecret: 'test-secret' },
          key: 'oneworks-main',
          status: 'connected',
          type: 'oneworks'
        }]
      ])
    })

    const { createOneWorksChannelFacade } = await import('#~/services/oneworks-channel/index.js')
    const facade = createOneWorksChannelFacade()
    const [rooms, targets] = await Promise.all([
      facade.listRooms(workspacePrincipal),
      facade.listSimulationTargets(workspacePrincipal)
    ])

    expect(rooms).toEqual([
      expect.objectContaining({
        activeShareCount: 1,
        channelConnectionCount: 2,
        memberCount: 1,
        messageCount: 1,
        roomId: 'product-room',
        title: 'Product Room'
      })
    ])
    expect(rooms[0]?.platforms.map(platform => platform.channelType)).toEqual(['lark', 'wechat'])
    expect(rooms[0]?.members[0]).not.toHaveProperty('avatar')
    expect(targets.map(room => room.channelType)).toEqual(['lark', 'wechat', 'oneworks'])
    expect(targets.find(room => room.channelType === 'lark')?.capabilities).toEqual([])
    expect(targets.find(room => room.channelType === 'wechat')?.capabilities).toEqual([])
    expect(targets.find(room => room.channelType === 'oneworks')?.capabilities).toEqual(['scenarios', 'simulation'])
    await expect(facade.injectSimulation(workspacePrincipal, {
      actorRole: 'participant',
      roomRef: targets.find(room => room.channelType === 'lark')!.roomRef,
      sessionType: 'group',
      text: 'Not supported',
      userLabel: 'operator-a'
    })).rejects.toThrow('does not support simulation')
  })

  it('redacts operational lists and injects a signed webhook through the channel manager', async () => {
    getChannelManager.mockReturnValue({
      states: new Map([['private-channel-key', {
        channelLinks: [{ address: { id: 'raw-room-id', kind: 'group' }, name: 'Support operations' }],
        config: { access: { admins: ['simulation-admin'] }, type: 'oneworks', webhookSecret: 'test-secret' },
        key: 'private-channel-key',
        status: 'connected',
        type: 'oneworks'
      }]])
    })
    getDb.mockReturnValue({
      listChannelScenarios: vi.fn(() => []),
      listRecentChannelOutboundDeliveries: vi.fn(() => [{
        channelKey: 'private-channel-key',
        channelType: 'oneworks',
        createdAt: 800,
        id: 'outbound-real-id',
        messageId: 'raw-outbound-message-id',
        receiveId: 'raw-room-id',
        receiveIdType: 'room',
        text: 'do-not-return-outbound-text',
        updatedAt: null
      }]),
      listOpenChannelPendingIntents: vi.fn(() => [{
        channelType: 'oneworks',
        createdAt: 321,
        id: 'intent-real-id',
        kind: 'need_approval'
      }]),
      listPendingChannelAuthorizationRequests: vi.fn(() => [{
        channelType: 'oneworks',
        createdAt: 322,
        id: 'authorization-real-id',
        status: 'pending'
      }]),
      listPendingChannelOffhourBacklog: vi.fn(() => [{
        attempts: 2,
        createdAt: 123,
        id: 'pending-real-id',
        lastError: null,
        raw: { token: 'do-not-return' },
        status: 'pending'
      }]),
      listRecentChannelChildSessionRuns: vi.fn(() => [{
        channelType: 'oneworks',
        error: null,
        id: 'child-real-id',
        startedAt: 456,
        status: 'running'
      }]),
      listRecentChannelCommandRuns: vi.fn(() => [{
        channelType: 'oneworks',
        completedAt: 460,
        error: null,
        id: 'command-real-id',
        startedAt: 459,
        status: 'success'
      }]),
      listRecentChannelConversationTurnsByType: vi.fn(() => [{
        channelType: 'oneworks',
        createdAt: 458,
        id: 'turn-real-id',
        role: 'outbound'
      }]),
      listRecentChannelIngressRouterRuns: vi.fn(() => [{
        actorAccountId: 'account-real-id',
        channelType: 'oneworks',
        createdAt: 789,
        decision: 'create_child',
        id: 'ingress-real-id',
        reason: 'matched policy',
        senderId: 'sender-real-id'
      }]),
      listRecentChannelPolicyEvents: vi.fn(() => [{
        channelLinkName: 'Support operations',
        createdAt: 457,
        eventType: 'warning',
        id: 'policy-real-id'
      }])
    })
    handleChannelWebhook.mockResolvedValue({ statusCode: 200 })

    const { createOneWorksChannelFacade } = await import('#~/services/oneworks-channel/index.js')
    const facade = createOneWorksChannelFacade()
    const [targets, trace] = await Promise.all([
      facade.listSimulationTargets(workspacePrincipal),
      facade.getTrace(workspacePrincipal)
    ])

    expect(JSON.stringify({ targets, trace })).not.toContain('private-channel-key')
    expect(JSON.stringify({ targets, trace })).not.toContain('raw-room-id')
    expect(JSON.stringify({ targets, trace })).not.toContain('sender-real-id')
    expect(JSON.stringify({ targets, trace })).not.toContain('do-not-return')
    expect(JSON.stringify({ targets, trace })).not.toContain('outbound-real-id')
    expect(targets).toEqual([
      expect.objectContaining({
        binding: 'group',
        channelType: 'oneworks',
        commandPrefix: '/',
        entity: undefined,
        label: 'Support operations',
        status: 'connected'
      })
    ])
    expect(trace.map(item => item.kind)).toEqual(expect.arrayContaining([
      'backlog',
      'child-run',
      'command',
      'ingress',
      'policy',
      'turn'
    ]))
    expect(trace).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'turn', reason: 'Outbound native channel delivery.', status: 'outbound' })
    ]))
    await expect(facade.injectSimulation(workspacePrincipal, {
      actorRole: 'admin',
      roomRef: targets[0]!.roomRef,
      sessionType: 'group',
      text: 'Check the normal inbound path.',
      userLabel: 'operator-a'
    })).resolves.toEqual(expect.objectContaining({ accepted: true, status: 200 }))
    const webhookInput = handleChannelWebhook.mock.calls[0]?.[0]
    expect(webhookInput).toMatchObject({ channelKey: 'private-channel-key', channelType: 'oneworks', method: 'POST' })
    expect(webhookInput.body).toMatchObject({
      mentionedBot: true,
      senderId: expect.any(String),
      simulation: { actorRole: 'admin', userLabel: 'operator-a' }
    })
    expect(webhookInput.body.senderId).not.toBe('simulation-admin')
    expect(webhookInput.headers['x-oneworks-product-simulation']).toBe('1')
    expect(webhookInput.remoteAddress).toBe('127.0.0.1')
    expect(typeof webhookInput.headers['x-oneworks-channel-signature']).toBe('string')
    expect(verifyOneWorksWebhookSignature({
      body: webhookInput.rawBody,
      nonce: webhookInput.headers['x-oneworks-channel-nonce'],
      secret: 'test-secret',
      signature: webhookInput.headers['x-oneworks-channel-signature'],
      timestamp: webhookInput.headers['x-oneworks-channel-timestamp']
    })).toBe(true)

    await facade.injectSimulation(workspacePrincipal, {
      actorRole: 'participant',
      roomRef: targets[0]!.roomRef,
      sessionType: 'group',
      text: 'Continue the same synthetic conversation.',
      userLabel: 'operator-a'
    })
    expect(handleChannelWebhook.mock.calls[1]?.[0].body.senderId).not.toBe(webhookInput.body.senderId)
  })

  it('creates and revokes Room shares without returning principal or database identifiers', async () => {
    const share = {
      createdAt: 10,
      grants: [{
        createdAt: 10,
        permissions: ['view', 'send'],
        principalId: 'private-user-id',
        principalType: 'user',
        shareId: 'database-share-id'
      }],
      id: 'database-share-id',
      roomId: 'product-room',
      status: 'active',
      updatedAt: 10
    }
    const db = {
      getAgentRoom: vi.fn(() => ({ id: 'product-room', title: 'Product Room' })),
      listAgentRoomShares: vi.fn(() => [share]),
      listAgentRooms: vi.fn(() => [{ id: 'product-room', title: 'Product Room' }])
    }
    getDb.mockReturnValue(db)
    getChannelManager.mockReturnValue({ states: new Map() })
    executeRoomCommand.mockImplementation(async (_roomId, command) => command.type === 'create_share' ? share : true)

    const { createOneWorksChannelFacade } = await import('#~/services/oneworks-channel/index.js')
    const facade = createOneWorksChannelFacade()
    const listed = await facade.listShares(workspacePrincipal)
    const created = await facade.createRoomShare(workspacePrincipal, 'product-room', {
      grants: [{ permissions: ['view', 'send'], principalId: 'private-user-id', principalType: 'user' }]
    })

    expect(JSON.stringify({ created, listed })).not.toContain('private-user-id')
    expect(JSON.stringify({ created, listed })).not.toContain('database-share-id')
    expect(created).toMatchObject({ grantCount: 1, permissions: ['view', 'send'], roomTitle: 'Product Room' })
    expect(executeRoomCommand).toHaveBeenCalledWith(
      'product-room',
      expect.objectContaining({ type: 'create_share' }),
      {
        bindOwner: {
          accountId: 'relay-owner-account',
          nodeId: 'relay-owner-node',
          sourceId: 'relay-main'
        }
      }
    )

    await expect(facade.revokeRoomShare(workspacePrincipal, 'product-room', listed[0]!.shareRef)).resolves.toBe(true)
    expect(executeRoomCommand).toHaveBeenLastCalledWith(
      'product-room',
      expect.objectContaining({
        shareId: 'database-share-id',
        type: 'revoke_share'
      })
    )
  })

  it('requires an online Relay owner before creating a Room share', async () => {
    listActiveAgentRoomRelayOwners.mockReturnValue([])
    getDb.mockReturnValue({
      getAgentRoom: vi.fn(() => ({ id: 'product-room', owner: { type: 'local' }, title: 'Product Room' }))
    })

    const { createOneWorksChannelFacade } = await import('#~/services/oneworks-channel/index.js')
    await expect(
      createOneWorksChannelFacade().createRoomShare(workspacePrincipal, 'product-room', {
        grants: [{ permissions: ['view'], principalId: 'user', principalType: 'user' }]
      })
    ).rejects.toThrow('Connect a Relay account')
    expect(executeRoomCommand).not.toHaveBeenCalled()
  })

  it('creates, updates, runs, and removes scenarios without exposing database identifiers', async () => {
    const scenarios: Array<Record<string, unknown>> = []
    getChannelManager.mockReturnValue({
      states: new Map([['private-channel-key', {
        channelLinks: [{ address: { id: 'raw-room-id', kind: 'group' }, name: 'Support operations' }],
        config: { access: { admins: ['simulation-admin'] }, type: 'oneworks', webhookSecret: 'test-secret' },
        key: 'private-channel-key',
        status: 'connected',
        type: 'oneworks'
      }]])
    })
    getDb.mockReturnValue({
      createChannelScenario: vi.fn((input) => {
        const row = { ...input, createdAt: 100, id: 'database-scenario-id', updatedAt: 100 }
        scenarios.push(row)
        return row
      }),
      deleteChannelScenario: vi.fn(() => {
        scenarios.splice(0, 1)
        return true
      }),
      listChannelScenarios: vi.fn(() => scenarios),
      updateChannelScenario: vi.fn((_id, patch) => {
        Object.assign(scenarios[0]!, patch, { updatedAt: 200 })
        return scenarios[0]
      })
    })
    handleChannelWebhook.mockResolvedValue({ statusCode: 200 })

    const { createOneWorksChannelFacade } = await import('#~/services/oneworks-channel/index.js')
    const facade = createOneWorksChannelFacade()
    const room = (await facade.listSimulationTargets(workspacePrincipal))[0]!
    const created = await facade.createScenario(workspacePrincipal, {
      actorRole: 'admin',
      name: 'Morning check',
      roomRef: room.roomRef,
      sessionType: 'group',
      text: 'Health check',
      userLabel: 'operator-a'
    }) as { scenarioRef: string }
    expect(JSON.stringify(created)).not.toContain('database-scenario-id')
    await facade.updateScenario(workspacePrincipal, created.scenarioRef, { name: 'Updated check' })
    await facade.runScenario(workspacePrincipal, created.scenarioRef)
    await expect(facade.deleteScenario(workspacePrincipal, created.scenarioRef)).resolves.toBe(true)
  })
})
