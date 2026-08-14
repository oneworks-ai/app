import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'

import { describe, expect, it, vi } from 'vitest'

import type { PluginRequestPrincipal } from '@oneworks/types'

import { activatePlugin } from '../server/src/index'

describe('oneWorks Rooms plugin', () => {
  it('registers its redacted product proxy routes only through the host facade', async () => {
    const principal: PluginRequestPrincipal = {
      id: 'local-workspace',
      kind: 'local_workspace',
      permissions: ['workspace:read', 'workspace:manage']
    }
    const registerApi = vi.fn()
    const attachRoomChannelConnection = vi.fn(async () => ({ roomId: 'room-1' }))
    const createRoomShare = vi.fn(async () => ({ shareRef: 'share-ref' }))
    const listRooms = vi.fn(async () => [{ label: 'Operations', roomRef: '0123456789abcdef', status: 'connected' }])
    const listRoomChannelConnectionCandidates = vi.fn(async () => [{
      channelLinkName: 'qa-group',
      entityId: 'qa'
    }])
    const listShareOwners = vi.fn(async () => [{ label: 'Owner', ownerRef: 'owner-ref' }])
    const listShares = vi.fn(async () => [{ roomId: 'room-1', shareRef: 'share-ref' }])
    const revokeRoomShare = vi.fn(async () => true)
    const updateRoomChannelConnection = vi.fn(async () => ({ roomId: 'room-1' }))
    activatePlugin({
      oneworksChannel: {
        attachRoomChannelConnection,
        createRoom: vi.fn(),
        createRoomShare,
        createScenario: vi.fn(),
        deleteRoom: vi.fn(),
        deleteScenario: vi.fn(),
        getTrace: vi.fn(),
        injectSimulation: vi.fn(),
        listEntities: vi.fn(),
        listRoomChannelConnectionCandidates,
        listRooms,
        listShareOwners,
        listShares,
        listSharedRooms: vi.fn(),
        listSimulationTargets: vi.fn(),
        listScenarios: vi.fn(),
        runScenario: vi.fn(),
        revokeRoomShare,
        updateRoom: vi.fn(),
        updateRoomChannelConnection,
        updateScenario: vi.fn()
      },
      logger: { info: vi.fn() },
      registerApi,
      scope: 'oneworks'
    })
    expect(registerApi).toHaveBeenCalledWith(
      'product',
      expect.objectContaining({
        headerSchema: expect.any(Object),
        inputSchema: expect.any(Object),
        outputSchema: expect.any(Object)
      })
    )
    const handler = registerApi.mock.calls[0]?.[1].handler
    expect(registerApi.mock.calls[0]?.[1].requiredPermission).toBe('workspace:manage')
    await expect(handler({ body: Buffer.alloc(0), method: 'GET', path: 'rooms', principal })).resolves.toMatchObject({
      body: [{ label: 'Operations' }],
      status: 200
    })
    expect(listRooms).toHaveBeenCalledOnce()
    await expect(handler({
      body: Buffer.alloc(0),
      method: 'GET',
      path: 'room-connection-candidates',
      principal
    })).resolves.toMatchObject({
      body: [{ channelLinkName: 'qa-group', entityId: 'qa' }],
      status: 200
    })
    await expect(handler({ body: Buffer.alloc(0), method: 'GET', path: 'share-owners', principal })).resolves
      .toMatchObject({
        body: [{ ownerRef: 'owner-ref' }],
        status: 200
      })
    await expect(handler({ body: Buffer.alloc(0), method: 'GET', path: 'shares', principal })).resolves.toMatchObject({
      body: [{ shareRef: 'share-ref' }],
      status: 200
    })
    await expect(handler({
      body: Buffer.from('{"grants":[]}'),
      method: 'POST',
      path: 'rooms/room-1/shares',
      principal
    })).resolves.toMatchObject({ body: { shareRef: 'share-ref' }, status: 201 })
    await expect(handler({
      body: Buffer.alloc(0),
      method: 'DELETE',
      path: 'rooms/room-1/shares/share-ref',
      principal
    })).resolves.toMatchObject({ body: { ok: true }, status: 200 })
    expect(createRoomShare).toHaveBeenCalledWith(principal, 'room-1', { grants: [] })
    expect(revokeRoomShare).toHaveBeenCalledWith(principal, 'room-1', 'share-ref')
    await expect(handler({
      body: Buffer.from('{"muted":true}'),
      method: 'PATCH',
      path: 'rooms/room-1/connections/product/product-lark',
      principal
    })).resolves.toMatchObject({ body: { roomId: 'room-1' }, status: 200 })
    expect(updateRoomChannelConnection).toHaveBeenCalledWith(
      principal,
      'room-1',
      'product',
      'product-lark',
      { muted: true }
    )
    await expect(handler({
      body: Buffer.from('{"channelLinkName":"qa-group"}'),
      method: 'POST',
      path: 'rooms/room-1/connections',
      principal
    })).resolves.toMatchObject({ body: { roomId: 'room-1' }, status: 201 })
    expect(attachRoomChannelConnection).toHaveBeenCalledWith(
      principal,
      'room-1',
      { channelLinkName: 'qa-group' }
    )
  })

  it('ships a workspace-only chat room route using shared sidebar and header chrome', async () => {
    const [manifest, client, styles] = await Promise.all([
      readFile(new URL('../plugin.json', import.meta.url), 'utf8'),
      readFile(new URL('../client/src/index.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../client/src/styles.ts', import.meta.url), 'utf8')
    ])
    expect(manifest).toContain('"workspace"')
    expect(client).toContain("key: 'rooms'")
    expect(client).toContain("key: 'shared'")
    expect(client).toContain("request(ctx, 'shared')")
    expect(client).toContain('data.sharedRooms.map(room =>')
    expect(client).toContain("key: 'playground'")
    expect(client).toContain("key: 'trace'")
    expect(client).toContain("key: 'scenarios'")
    expect(client).toContain('view.route?.setSidebar({')
    expect(client).toContain('view.route?.setActions(roomActions)')
    expect(client).toContain('view.route?.setBreadcrumb({')
    expect(client).toContain('view.route?.navigate(pluginRoute)')
    expect(client).toContain('view.route?.navigate(buildOneWorksRoomRoute(ctx.scope, room.roomId))')
    expect(client).not.toContain('view.route?.navigate(globalThis.location.pathname)')
    expect(client).not.toContain('match(/^\\/ui\\/w\\/[^/]+/u)')
    expect(client).toContain("view.data.useQuery('oneworks-channel:overview'")
    expect(client).toContain('refreshInterval: 10_000')
    expect(client).toContain('revalidateOnFocus: true')
    expect(client).toContain('revalidateOnReconnect: true')
    expect(client).toContain("t('Search chat rooms', '搜索聊天室')")
    expect(client).toContain("t('Chat rooms', '聊天室')")
    expect(client).toContain('AgentRoom,')
    expect(client).toContain('Sender,')
    expect(client).toContain("className='oneworks-channel__room'")
    expect(client).toContain('memberAvatarOverrides={memberAvatarOverrides}')
    expect(client).toContain("className='oneworks-channel__entity-avatar'")
    expect(client).toContain('avatar: resolvedMember.avatar')
    expect(client).not.toContain('/api/workspace/resource?path=')
    expect(client).toContain('roomId={room.roomId}')
    expect(client).not.toContain("<span>{t('No chat rooms yet.', '暂无聊天室。')}</span>")
    expect(client).not.toContain('NativeTabs')
    expect(client).toContain('Synthetic user')
    expect(client).toContain("ctx.slots.register('nav.items'")
    expect(client).toContain("className='oneworks-channel__room-surface'")
    expect(client).not.toContain("t('Open Room', '打开聊天室')")
    expect(client).not.toContain("t('Refresh', '刷新')")
    expect(client).not.toContain("className='oneworks-channel__heading'")
    expect(client).toContain("titleI18n: { en: 'Shared', 'zh-Hans': '已分享' }")
    expect(client).toMatch(/route: `\$\{route\}\?section=shared`/)
    expect(client).toMatch(/route: `\$\{route\}\?section=playground`/)
    expect(client).toMatch(/route: `\$\{route\}\?section=scenarios`/)
    expect(client).toMatch(/route: `\$\{route\}\?section=trace`/)
    expect(client).toContain("view.route?.setTitle(selectedRoom?.title ?? t('Create group chat', '创建群聊'))")
    expect(client).not.toContain("role='button'")
    expect(styles).toContain('.oneworks-channel__room-surface {')
    expect(styles).toContain('display: flex; flex-direction: column; height: 100%')
    expect(styles).toContain('.oneworks-channel__room { flex: 1 1 0;')
    expect(styles).toContain('.oneworks-channel__entity-picker { align-content: safe center;')
    expect(styles).toContain('padding: 20px 0;')
    expect(styles).toContain('@media (max-width: 700px)')
    expect(styles).not.toContain('.oneworks-channel__panel { padding-top: 10px; }')
    expect(manifest).toContain('"zh-Hans": "聊天室"')
    expect(manifest).toContain('"icon": "meeting_room"')
    expect(manifest).not.toContain('OneWorks 聊天室')
    expect(manifest).toContain('"pluginConfig": true')
    expect(manifest).toContain('"channelNavigation"')
    expect(manifest).toContain('"optionsKey": "navigation"')
    expect(manifest).toContain('"rightPanel"')
    expect(client).not.toContain('channelId')
    expect(client).not.toContain('senderId')
  })
})
