import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PluginRequestPrincipal } from '@oneworks/types'

const getChannelManager = vi.fn()
const getDb = vi.fn()
const executeAgentRoomCommand = vi.fn()
const upsertRoomMember = vi.fn()
const createRoom = vi.fn()
const applyEvent = vi.fn()
const createAgentRoomService = vi.fn(() => ({
  applyEvent,
  createRoom,
  executeCommand: executeAgentRoomCommand,
  upsertMember: upsertRoomMember
}))
const createSessionWithInitialMessage = vi.fn()

const workspacePrincipal: PluginRequestPrincipal = {
  id: 'local-workspace',
  kind: 'local_workspace',
  permissions: ['workspace:read', 'workspace:manage']
}

vi.mock('#~/channels/index.js', () => ({ getChannelManager }))
vi.mock('#~/channels/webhook.js', () => ({ handleChannelWebhook: vi.fn() }))
vi.mock('#~/db/index.js', () => ({ getDb }))
vi.mock('#~/services/agent-room/index.js', () => ({ createAgentRoomService }))
vi.mock('#~/services/agent-room/owner.js', () => ({
  createAgentRoomOwner: vi.fn(() => ({ execute: vi.fn() }))
}))
vi.mock('#~/services/agent-room/relay.js', () => ({ listActiveAgentRoomRelayOwners: vi.fn(() => []) }))
vi.mock('#~/services/session/create.js', () => ({ createSessionWithInitialMessage }))
vi.mock('@oneworks/definition-loader', () => ({
  DefinitionLoader: class {
    loadDefaultEntities = async () => [
      {
        attributes: {
          description: 'Team leader',
          name: 'leader',
          team: { relatedEntities: ['std/qa'], role: 'leader' }
        },
        body: 'Team leader',
        path: '/entities/leader/README.md',
        resolvedName: 'leader'
      },
      {
        attributes: { description: 'Quality assurance', name: 'qa' },
        body: 'Quality assurance',
        path: '/entities/qa/README.md',
        resolvedName: 'std/qa',
        resolvedSource: 'plugin'
      },
      {
        attributes: {
          description: 'Backup team leader',
          name: 'backup-leader',
          team: { role: 'leader' }
        },
        body: 'Backup team leader',
        path: '/entities/backup-leader/README.md',
        resolvedName: 'backup-leader'
      }
    ]
  }
}))

describe('oneWorks Team Chat room lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createAgentRoomService.mockReturnValue({
      applyEvent,
      createRoom,
      executeCommand: executeAgentRoomCommand,
      upsertMember: upsertRoomMember
    })
  })

  it('maps a group ChannelLink that uses a scoped entity reference and adds its entity member', async () => {
    getDb.mockReturnValue({
      getAgentRoom: vi.fn(() => ({ hostSessionId: 'host-1', id: 'room-1', owner: { type: 'local' } })),
      getAgentRoomDetail: vi.fn(() => ({
        channelConnections: [{ channelKey: 'lark:qa', channelType: 'lark', memberKey: 'qa', status: 'active' }],
        members: [{ key: 'qa', kind: 'entity', label: 'qa' }],
        messages: [],
        shares: []
      })),
      getAgentRoomMember: vi.fn(() => undefined),
      listAgentRooms: vi.fn(() => [{
        createdAt: 1,
        hostSessionId: 'host-1',
        id: 'room-1',
        owner: { type: 'local' },
        status: 'active',
        title: 'Existing Team Chat',
        updatedAt: 2
      }])
    })
    getChannelManager.mockReturnValue({
      states: new Map([['lark:qa', {
        channelLinks: [{
          address: { id: 'oc_qa', kind: 'group' },
          entity: 'std/qa',
          external: { receiveIdType: 'chat_id' },
          ingress: { room: { muted: true, requireMention: true } },
          name: 'qa-group'
        }],
        config: { title: 'QA bot' },
        key: 'lark:qa',
        status: 'connected',
        type: 'lark'
      }]])
    })

    const { createOneWorksChannelFacade } = await import('#~/services/oneworks-channel/index.js')
    await expect(
      createOneWorksChannelFacade().listRoomChannelConnectionCandidates(workspacePrincipal)
    ).resolves.toEqual([
      expect.objectContaining({
        channelLinkName: 'qa-group',
        entityId: 'std/qa',
        entityName: 'qa'
      })
    ])
    await expect(
      createOneWorksChannelFacade().attachRoomChannelConnection(workspacePrincipal, 'room-1', {
        channelLinkName: 'qa-group'
      })
    ).resolves.toEqual(expect.objectContaining({ roomId: 'room-1' }))

    expect(upsertRoomMember).toHaveBeenCalledWith(
      'room-1',
      expect.objectContaining({
        key: 'std/qa',
        kind: 'entity',
        label: 'qa'
      })
    )
    expect(executeAgentRoomCommand).toHaveBeenCalledWith(
      'room-1',
      expect.objectContaining({
        connection: expect.objectContaining({
          channelLinkName: 'qa-group',
          memberKey: 'std/qa',
          muted: true,
          requireMention: true
        }),
        type: 'attach_member_channel'
      })
    )
  })

  it('does not advertise ChannelLinks whose entity definition is missing', async () => {
    getChannelManager.mockReturnValue({
      states: new Map([['lark:stale', {
        channelLinks: [{
          address: { id: 'oc_stale', kind: 'group' },
          entity: 'missing-entity',
          external: { receiveIdType: 'chat_id' },
          ingress: {},
          name: 'stale-group'
        }],
        config: { title: 'Stale bot' },
        key: 'lark:stale',
        status: 'connected',
        type: 'lark'
      }]])
    })

    const { createOneWorksChannelFacade } = await import('#~/services/oneworks-channel/index.js')
    await expect(
      createOneWorksChannelFacade().listRoomChannelConnectionCandidates(workspacePrincipal)
    ).resolves.toEqual([])
  })

  it.each(
    [
      ['a direct message', 'direct', 'lark'],
      ['an internal OneWorks room', 'group', 'oneworks']
    ] as const
  )('rejects mapping %s into a Team Chat', async (_label, conversationKind, channelType) => {
    getDb.mockReturnValue({
      getAgentRoom: vi.fn(() => ({ hostSessionId: 'host-1', id: 'room-1', owner: { type: 'local' } }))
    })
    getChannelManager.mockReturnValue({
      states: new Map([[`${channelType}:qa`, {
        channelLinks: [{
          address: { id: 'conversation-qa', kind: conversationKind },
          entity: 'qa',
          external: { receiveIdType: channelType === 'lark' ? 'open_id' : 'room' },
          ingress: {},
          name: 'private-link'
        }],
        config: { title: 'QA bot' },
        key: `${channelType}:qa`,
        status: 'connected',
        type: channelType
      }]])
    })

    const { createOneWorksChannelFacade } = await import('#~/services/oneworks-channel/index.js')
    await expect(
      createOneWorksChannelFacade().attachRoomChannelConnection(workspacePrincipal, 'room-1', {
        channelLinkName: 'private-link'
      })
    ).rejects.toThrow('Only external group ChannelLinks can be mapped to a Team Chat')

    expect(upsertRoomMember).not.toHaveBeenCalled()
    expect(executeAgentRoomCommand).not.toHaveBeenCalled()
  })

  it('creates a Team Chat with the first selected entity as its leader', async () => {
    let createdRoomId = ''
    createRoom.mockImplementation((input) => {
      createdRoomId = input.id
      return input
    })
    createSessionWithInitialMessage.mockImplementationOnce(async (options) => {
      await options.beforeStart?.('host-session')
      return { id: 'host-session' }
    })
    getDb.mockReturnValue({
      getAgentRoomDetail: vi.fn(() => ({
        channelConnections: [],
        members: [
          { key: 'leader', kind: 'entity', label: 'leader' },
          { key: 'std/qa', kind: 'entity', label: 'qa' }
        ],
        messages: [],
        shares: []
      })),
      listAgentRooms: vi.fn(() => [{
        createdAt: 1,
        hostSessionId: 'host-session',
        id: createdRoomId,
        leaderEntity: 'leader',
        owner: { type: 'local' },
        status: 'active',
        title: 'Plan the release',
        updatedAt: 2
      }])
    })
    getChannelManager.mockReturnValue({ states: new Map() })

    const { createOneWorksChannelFacade } = await import('#~/services/oneworks-channel/index.js')
    const room = await createOneWorksChannelFacade().createRoom(workspacePrincipal, {
      entityIds: ['leader', 'std/qa'],
      message: 'Plan the release'
    })

    expect(room).toEqual(expect.objectContaining({ roomId: createdRoomId, title: 'Plan the release' }))
    expect(createRoom).toHaveBeenCalledWith(expect.objectContaining({
      hostSessionId: 'host-session',
      leaderEntity: 'leader'
    }))
    expect(applyEvent).toHaveBeenCalledWith(
      createdRoomId,
      expect.objectContaining({
        member: expect.objectContaining({ key: 'leader', kind: 'entity' }),
        type: 'member_joined'
      })
    )
    expect(createSessionWithInitialMessage).toHaveBeenCalledWith(expect.objectContaining({
      initialMessage: 'Plan the release',
      promptName: 'leader',
      promptType: 'entity'
    }))
  })

  it('uses an explicit registered leader and automatically adds its related entities', async () => {
    let createdRoomId = ''
    createRoom.mockImplementation((input) => {
      createdRoomId = input.id
      return input
    })
    createSessionWithInitialMessage.mockImplementationOnce(async (options) => {
      await options.beforeStart?.('host-session')
      return { id: 'host-session' }
    })
    getDb.mockReturnValue({
      getAgentRoomDetail: vi.fn(() => ({
        channelConnections: [],
        members: [
          { key: 'leader', kind: 'entity', label: 'leader' },
          { key: 'std/qa', kind: 'entity', label: 'qa' }
        ],
        messages: [],
        shares: []
      })),
      listAgentRooms: vi.fn(() => [{
        createdAt: 1,
        hostSessionId: 'host-session',
        id: createdRoomId,
        leaderEntity: 'leader',
        owner: { type: 'local' },
        status: 'active',
        title: 'Ship the release',
        updatedAt: 2
      }])
    })
    getChannelManager.mockReturnValue({ states: new Map() })

    const { createOneWorksChannelFacade } = await import('#~/services/oneworks-channel/index.js')
    const room = await createOneWorksChannelFacade().createRoom(workspacePrincipal, {
      entityIds: [],
      leaderEntityId: 'leader',
      message: 'Ship the release'
    })

    expect(room).toEqual(expect.objectContaining({ roomId: createdRoomId }))

    expect(applyEvent).toHaveBeenCalledWith(
      createdRoomId,
      expect.objectContaining({
        member: expect.objectContaining({ key: 'std/qa', kind: 'entity' }),
        type: 'member_joined'
      })
    )
    expect(createSessionWithInitialMessage).toHaveBeenCalledWith(expect.objectContaining({
      promptName: 'leader',
      promptType: 'entity'
    }))
  })

  it('rejects a regular entity submitted as an explicit Team Chat leader', async () => {
    const { createOneWorksChannelFacade } = await import('#~/services/oneworks-channel/index.js')

    await expect(
      createOneWorksChannelFacade().createRoom(workspacePrincipal, {
        entityIds: [],
        leaderEntityId: 'std/qa',
        message: 'Invalid leader'
      })
    ).rejects.toThrow('not registered as a Team Chat leader')
    expect(createSessionWithInitialMessage).not.toHaveBeenCalled()
  })

  it('rejects a regular entity submitted as a legacy Team Chat leader', async () => {
    const { createOneWorksChannelFacade } = await import('#~/services/oneworks-channel/index.js')

    await expect(
      createOneWorksChannelFacade().createRoom(workspacePrincipal, {
        entityIds: ['std/qa'],
        message: 'Invalid legacy leader'
      })
    ).rejects.toThrow('not registered as a Team Chat leader')
    expect(createSessionWithInitialMessage).not.toHaveBeenCalled()
  })

  it('rejects a second leader submitted as a Team Chat member', async () => {
    const { createOneWorksChannelFacade } = await import('#~/services/oneworks-channel/index.js')

    await expect(
      createOneWorksChannelFacade().createRoom(workspacePrincipal, {
        entityIds: ['backup-leader'],
        leaderEntityId: 'leader',
        message: 'Invalid second leader'
      })
    ).rejects.toThrow('Only one Team Chat leader can be selected')
    expect(createSessionWithInitialMessage).not.toHaveBeenCalled()
  })

  it('rejects a second leader submitted through the legacy Team Chat shape', async () => {
    const { createOneWorksChannelFacade } = await import('#~/services/oneworks-channel/index.js')

    await expect(
      createOneWorksChannelFacade().createRoom(workspacePrincipal, {
        entityIds: ['leader', 'backup-leader'],
        message: 'Invalid legacy second leader'
      })
    ).rejects.toThrow('Only one Team Chat leader can be selected')
    expect(createSessionWithInitialMessage).not.toHaveBeenCalled()
  })
})
