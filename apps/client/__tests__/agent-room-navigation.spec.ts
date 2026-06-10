/* eslint-disable max-lines */

import { describe, expect, it, vi } from 'vitest'

import type { AgentRoom, AgentRoomDetailResponse, Session } from '@oneworks/core'

import { buildAgentRoomViewModel } from '#~/components/agent-room'
import {
  buildGroupedSidebarConversationItems,
  buildSidebarConversationItems,
  getCollapsibleSidebarSessionIds,
  getRoomSidebarId,
  resolveConversationItemPath,
  toSidebarRoomItem
} from '#~/components/sidebar/conversation-items'
import { getActiveSidebarIdFromPath } from '#~/hooks/sidebar-navigation-paths'
import { buildSidebarChildSessionNavigationTarget, buildSidebarNavigationTarget } from '#~/hooks/use-sidebar-navigation'
import { buildAgentRoomRouteViewModel } from '#~/routes/agent-room-route-view-model'
import { buildAgentRoomPath, buildAgentRoomSessionPath } from '#~/routes/agent-room-session-paths'

vi.mock('#~/store', () => ({
  sidebarWidthAtom: {}
}))

const createSession = (id: string, params: Partial<Session> = {}): Session => ({
  id,
  createdAt: 1,
  ...params
} as Session)

const room: AgentRoom = {
  id: 'room-multi-agent',
  title: 'Multi-agent rollout',
  hostSessionId: 'host-session',
  status: 'active',
  lastMessage: 'Reviewer is waiting for release notes.',
  createdAt: 10,
  updatedAt: 20
}

const roomDetail: AgentRoomDetailResponse = {
  room,
  members: [
    {
      roomId: room.id,
      key: 'reviewer',
      kind: 'entity',
      label: 'reviewer',
      status: 'waiting',
      activeRunCount: 1,
      pendingCount: 1,
      createdAt: 11,
      updatedAt: 18
    }
  ],
  runs: [
    {
      roomId: room.id,
      key: 'release-check',
      memberKey: 'reviewer',
      sessionId: 'child-session',
      title: 'release-check',
      status: 'waiting',
      createdAt: 12,
      updatedAt: 18
    }
  ],
  messages: []
}

describe('agent room navigation', () => {
  it('selects room routes as active sidebar room items', () => {
    expect(getActiveSidebarIdFromPath('/rooms/room-multi-agent')).toBe(getRoomSidebarId('room-multi-agent'))
    expect(getActiveSidebarIdFromPath('/rooms/room-multi-agent/sessions/child-session')).toBe(
      getRoomSidebarId('room-multi-agent')
    )
    expect(getActiveSidebarIdFromPath('/session/child-session')).toBe('child-session')
    expect(getActiveSidebarIdFromPath('/')).toBe('')
    expect(getActiveSidebarIdFromPath('/knowledge')).toBeUndefined()
  })

  it('builds room-scoped child session paths', () => {
    expect(buildAgentRoomPath('room multi-agent')).toBe('/rooms/room%20multi-agent')
    expect(buildAgentRoomSessionPath('room multi-agent', 'child session')).toBe(
      '/rooms/room%20multi-agent/sessions/child%20session'
    )
  })

  it('opens room conversation items at /rooms/:roomId', () => {
    const [item] = buildSidebarConversationItems({
      collapsedIds: new Set(),
      rooms: [toSidebarRoomItem(room, roomDetail)],
      sessions: [],
      sortOrder: 'desc'
    })

    expect(item?.kind).toBe('room')
    expect(item == null ? undefined : resolveConversationItemPath(item)).toBe('/rooms/room-multi-agent')
  })

  it('strips agentRoomMode from sidebar navigation targets while preserving unrelated query params', () => {
    expect(
      buildSidebarNavigationTarget(
        '/session/other-host',
        '?agentRoomMode=session&debug=true&panelSessionId=child&panelSessionFocus=panel&senderFocus=old'
      )
    ).toEqual({
      pathname: '/session/other-host',
      search: '?debug=true'
    })
    expect(buildSidebarNavigationTarget('/rooms/other-room', '?debug=true&agentRoomMode=session')).toEqual({
      pathname: '/rooms/other-room',
      search: '?debug=true'
    })
    expect(buildSidebarNavigationTarget('/', '?agentRoomMode=session')).toEqual({
      pathname: '/',
      search: ''
    })
  })

  it('can request sender focus when opening a top-level session', () => {
    expect(buildSidebarNavigationTarget(
      '/session/other-host',
      '?agentRoomMode=session&debug=true&panelSessionId=child&panelSessionFocus=panel&senderFocus=old',
      { focusRequestId: 'focus-next' }
    )).toEqual({
      pathname: '/session/other-host',
      search: '?debug=true&senderFocus=focus-next'
    })
  })

  it('opens regular child sessions through the parent session panel tab target', () => {
    expect(buildSidebarChildSessionNavigationTarget(
      'parent-session',
      'child-session',
      '?debug=true&agentRoomMode=session&panelSessionId=old-child&panelSessionFocus=old-focus&senderFocus=old'
    )).toEqual({
      pathname: '/session/parent-session',
      search: '?debug=true&panelSessionId=child-session&terminal=true'
    })
  })

  it('can request sender focus when opening a regular child session panel tab', () => {
    expect(buildSidebarChildSessionNavigationTarget(
      'parent-session',
      'child-session',
      '?debug=true&agentRoomMode=session&panelSessionId=old-child&panelSessionFocus=old-focus',
      { focusRequestId: 'focus-next' }
    )).toEqual({
      pathname: '/session/parent-session',
      search: '?debug=true&panelSessionId=child-session&panelSessionFocus=focus-next&terminal=true'
    })
  })

  it('nests regular child sessions under their parent in the sidebar tree', () => {
    const items = buildSidebarConversationItems({
      collapsedIds: new Set(),
      rooms: [],
      sessions: [
        createSession('parent-session', { title: 'Parent', createdAt: 10 }),
        createSession('child-session', { title: 'Child', parentSessionId: 'parent-session', createdAt: 20 })
      ],
      sortOrder: 'desc'
    })

    expect(items.map(item => ({
      depth: item.depth,
      hasChildren: item.hasChildren,
      id: item.id
    }))).toEqual([
      { depth: 0, hasChildren: true, id: 'parent-session' },
      { depth: 1, hasChildren: false, id: 'child-session' }
    ])
  })

  it('tracks regular parent sessions that can be collapsed by default', () => {
    const collapsedIds = getCollapsibleSidebarSessionIds({
      rooms: [],
      sessions: [
        createSession('parent-session', { title: 'Parent', createdAt: 10 }),
        createSession('child-session', { title: 'Child', parentSessionId: 'parent-session', createdAt: 20 }),
        createSession('orphan-child', { title: 'Orphan', parentSessionId: 'missing-parent', createdAt: 30 })
      ]
    })

    expect(Array.from(collapsedIds)).toEqual(['parent-session'])
  })

  it('hides child sessions when their parent is collapsed', () => {
    const items = buildSidebarConversationItems({
      collapsedIds: new Set(['parent-session']),
      rooms: [],
      sessions: [
        createSession('parent-session', { title: 'Parent', createdAt: 10 }),
        createSession('child-session', { title: 'Child', parentSessionId: 'parent-session', createdAt: 20 })
      ],
      sortOrder: 'desc'
    })

    expect(items.map(item => item.id)).toEqual(['parent-session'])
  })

  it('groups plugin-owned sessions and keeps child sessions in the parent group', () => {
    const items = buildGroupedSidebarConversationItems({
      collapsedIds: new Set(),
      groups: [{
        id: 'relay-local',
        pluginScope: 'relay',
        title: 'Local Relay',
        match: {
          tags: ['ow:plugin:relay:relay-server:local']
        },
        showWhenEmpty: true,
        actions: [{
          id: 'new-session',
          title: 'New session',
          icon: 'add',
          createSession: {
            tags: ['ow:plugin:relay:relay-server:local']
          }
        }]
      }],
      rooms: [],
      sessions: [
        createSession('relay-parent', {
          createdAt: 20,
          tags: ['ow:plugin:relay:relay-server:local'],
          title: 'Relay parent'
        }),
        createSession('relay-child', {
          createdAt: 30,
          parentSessionId: 'relay-parent',
          title: 'Relay child'
        }),
        createSession('regular-session', { createdAt: 10, title: 'Regular chat' })
      ],
      sortOrder: 'desc'
    })

    expect(items.map(item => ({
      depth: item.depth,
      id: item.id,
      kind: item.kind
    }))).toEqual([
      { depth: 0, id: 'group:relay/relay-local', kind: 'group' },
      { depth: 1, id: 'relay-parent', kind: 'session' },
      { depth: 2, id: 'relay-child', kind: 'session' },
      { depth: 0, id: 'regular-session', kind: 'session' }
    ])
  })

  it('supports device-scoped plugin groups without stealing other device sessions', () => {
    const serverTag = 'ow:plugin:relay:relay-server:local'
    const deviceTagPrefix = `${serverTag}:device:`
    const currentDeviceTag = `${deviceTagPrefix}main-web`
    const otherDeviceTag = `${deviceTagPrefix}codex-smoke`
    const items = buildGroupedSidebarConversationItems({
      collapsedIds: new Set(),
      groups: [{
        id: 'relay-main-web',
        pluginScope: 'relay',
        title: 'Main Web',
        match: {
          anyOf: [
            { tags: [currentDeviceTag] },
            {
              excludedTagPrefixes: [deviceTagPrefix],
              tags: [serverTag]
            }
          ]
        },
        showWhenEmpty: true
      }, {
        id: 'relay-codex-smoke',
        pluginScope: 'relay',
        title: 'Codex Smoke',
        match: {
          tags: [otherDeviceTag]
        },
        showWhenEmpty: true
      }],
      rooms: [],
      sessions: [
        createSession('legacy-relay-session', {
          createdAt: 30,
          tags: [serverTag],
          title: 'Legacy relay session'
        }),
        createSession('current-device-session', {
          createdAt: 20,
          tags: [serverTag, currentDeviceTag],
          title: 'Current device session'
        }),
        createSession('other-device-session', {
          createdAt: 10,
          tags: [serverTag, otherDeviceTag],
          title: 'Other device session'
        })
      ],
      sortOrder: 'desc'
    })

    expect(items.map(item => ({
      id: item.id,
      kind: item.kind
    }))).toEqual([
      { id: 'group:relay/relay-main-web', kind: 'group' },
      { id: 'legacy-relay-session', kind: 'session' },
      { id: 'current-device-session', kind: 'session' },
      { id: 'group:relay/relay-codex-smoke', kind: 'group' },
      { id: 'other-device-session', kind: 'session' }
    ])
  })

  it('shows empty plugin session groups when requested', () => {
    const items = buildGroupedSidebarConversationItems({
      collapsedIds: new Set(),
      groups: [{
        id: 'relay-local',
        pluginScope: 'relay',
        title: 'Local Relay',
        match: {
          tags: ['ow:plugin:relay:relay-server:local']
        },
        showWhenEmpty: true
      }],
      rooms: [],
      sessions: [],
      sortOrder: 'desc'
    })

    expect(items).toMatchObject([{
      id: 'group:relay/relay-local',
      kind: 'group',
      sessionCount: 0
    }])
  })

  it('keeps private child run sessions out of the top-level list while preserving session detail paths', () => {
    const items = buildSidebarConversationItems({
      collapsedIds: new Set(),
      rooms: [toSidebarRoomItem(room, roomDetail)],
      sessions: [
        createSession('host-session', { title: 'Host session', createdAt: 15 }),
        createSession('child-session', {
          title: 'Private reviewer run',
          parentSessionId: 'host-session',
          createdAt: 16
        }),
        createSession('single-session', { title: 'Standalone chat', createdAt: 5 })
      ],
      sortOrder: 'desc'
    })

    expect(items.map(item => item.id)).toEqual([
      getRoomSidebarId('room-multi-agent'),
      'single-session'
    ])
    expect(resolveConversationItemPath({
      id: 'child-session',
      kind: 'session',
      session: createSession('child-session'),
      depth: 0,
      hasChildren: false
    })).toBe('/session/child-session')
  })

  it('pins favorited rooms ahead of newer non-favorite conversations', () => {
    const items = buildSidebarConversationItems({
      collapsedIds: new Set(),
      rooms: [
        toSidebarRoomItem({
          ...room,
          id: 'regular-room',
          title: 'Regular room',
          updatedAt: 100
        }),
        toSidebarRoomItem({
          ...room,
          id: 'favorite-room',
          title: 'Favorite room',
          favoritedAt: 30,
          updatedAt: 10
        })
      ],
      sessions: [
        createSession('newer-session', { createdAt: 200, title: 'Newer chat' })
      ],
      sortOrder: 'desc'
    })

    expect(items.map(item => item.id)).toEqual([
      getRoomSidebarId('favorite-room'),
      'newer-session',
      getRoomSidebarId('regular-room')
    ])
  })

  it('does not expose child run approval options as room message actions', () => {
    const viewModel = buildAgentRoomRouteViewModel({
      ...roomDetail,
      runs: [
        {
          ...roomDetail.runs[0]!,
          options: [
            {
              label: 'Approve',
              value: 'approve',
              description: 'Approve child run continuation.'
            }
          ]
        }
      ],
      messages: [
        {
          id: 'msg-user-target-run',
          roomId: room.id,
          role: 'user',
          runKey: 'release-check',
          content: 'Continue with this run.',
          payload: {
            target: {
              memberKey: 'reviewer',
              runKey: 'release-check'
            }
          },
          createdAt: 21
        },
        {
          id: 'msg-agent-needs-approval',
          roomId: room.id,
          role: 'agent',
          memberKey: 'reviewer',
          runKey: 'release-check',
          content: 'I need approval.',
          eventType: 'attention_requested',
          createdAt: 22
        }
      ]
    })

    expect(viewModel.messages.find(message => message.id === 'msg-user-target-run')?.options).toBeUndefined()
    expect(viewModel.messages.find(message => message.id === 'msg-agent-needs-approval')?.options).toBeUndefined()
  })

  it('maps member joined events to localized system message metadata', () => {
    const viewModel = buildAgentRoomRouteViewModel({
      ...roomDetail,
      members: [
        {
          ...roomDetail.members[0]!,
          key: 'std/dev-planner',
          label: 'std/dev-planner'
        }
      ],
      messages: [
        {
          id: 'runtime-member:room-multi-agent:std/dev-planner',
          roomId: room.id,
          role: 'system',
          memberKey: 'std/dev-planner',
          content: 'std/dev-planner joined the room',
          eventType: 'member_joined',
          payload: {
            type: 'member_joined',
            member: {
              key: 'std/dev-planner',
              kind: 'entity',
              label: 'std/dev-planner'
            }
          },
          createdAt: 21
        }
      ]
    })

    expect(viewModel.messages).toEqual([
      expect.objectContaining({
        id: 'runtime-member:room-multi-agent:std/dev-planner',
        content: 'std/dev-planner joined the room',
        systemMessage: {
          kind: 'memberJoined',
          memberLabel: 'std/dev-planner'
        }
      })
    ])
  })

  it('maps delivered room user messages to working reactions', () => {
    const viewModel = buildAgentRoomRouteViewModel({
      ...roomDetail,
      messages: [
        {
          id: 'msg-user-target-run',
          roomId: room.id,
          role: 'user',
          runKey: 'release-check',
          content: 'Continue with this run.',
          payload: {
            target: {
              memberKey: 'reviewer',
              runKey: 'release-check'
            },
            reactions: [
              {
                kind: 'working',
                createdAt: 21,
                target: {
                  memberKey: 'reviewer',
                  runKey: 'release-check'
                }
              }
            ]
          },
          createdAt: 21
        }
      ]
    })

    expect(viewModel.messages[0]).toEqual(expect.objectContaining({
      id: 'msg-user-target-run',
      reactions: [
        expect.objectContaining({
          kind: 'working',
          agentLabel: 'reviewer',
          run: expect.objectContaining({
            sessionId: 'child-session'
          })
        })
      ]
    }))
  })

  it('marks delivered room user message reactions completed when the target run is complete', () => {
    const viewModel = buildAgentRoomRouteViewModel({
      ...roomDetail,
      members: [
        {
          ...roomDetail.members[0]!,
          status: 'completed',
          activeRunCount: 0,
          pendingCount: 0
        }
      ],
      runs: [
        {
          ...roomDetail.runs[0]!,
          status: 'completed'
        }
      ],
      messages: [
        {
          id: 'msg-user-target-run',
          roomId: room.id,
          role: 'user',
          runKey: 'release-check',
          content: 'Continue with this run.',
          payload: {
            target: {
              memberKey: 'reviewer',
              runKey: 'release-check'
            },
            reactions: [
              {
                kind: 'working',
                createdAt: 21,
                target: {
                  memberKey: 'reviewer',
                  runKey: 'release-check'
                }
              }
            ]
          },
          createdAt: 21
        }
      ]
    })

    expect(viewModel.messages[0]?.reactions).toEqual([
      expect.objectContaining({
        kind: 'completed',
        agentLabel: 'reviewer',
        run: expect.objectContaining({
          status: 'completed',
          sessionId: 'child-session'
        })
      })
    ])
  })

  it('maps untargeted host deliveries to leader working reactions', () => {
    const viewModel = buildAgentRoomRouteViewModel({
      ...roomDetail,
      messages: [
        {
          id: 'msg-user-host',
          roomId: room.id,
          role: 'user',
          content: 'How is it going?',
          payload: {
            delivery: {
              kind: 'message',
              receivedAt: 21,
              sessionId: 'host-session'
            },
            reactions: [
              {
                kind: 'working',
                createdAt: 21
              }
            ]
          },
          createdAt: 21
        }
      ]
    })

    expect(viewModel.messages[0]).toEqual(expect.objectContaining({
      id: 'msg-user-host',
      reactions: [
        expect.objectContaining({
          kind: 'working',
          agentLabel: 'leader',
          isHost: true
        })
      ]
    }))
  })

  it('keeps new host delivery reactions working when the room was already complete', () => {
    const viewModel = buildAgentRoomRouteViewModel({
      ...roomDetail,
      room: {
        ...room,
        status: 'completed'
      },
      members: [
        {
          ...roomDetail.members[0]!,
          status: 'completed',
          activeRunCount: 0,
          pendingCount: 0
        }
      ],
      runs: [
        {
          ...roomDetail.runs[0]!,
          status: 'completed'
        }
      ],
      messages: [
        {
          id: 'msg-user-host',
          roomId: room.id,
          role: 'user',
          content: 'How is it going?',
          payload: {
            delivery: {
              kind: 'message',
              receivedAt: 21,
              sessionId: 'host-session'
            },
            reactions: [
              {
                kind: 'working',
                createdAt: 21
              }
            ]
          },
          createdAt: 21
        }
      ]
    })

    expect(viewModel.messages[0]?.reactions).toEqual([
      expect.objectContaining({
        kind: 'working',
        agentLabel: 'leader',
        isHost: true
      })
    ])
  })

  it('keeps host delivery reactions working when a later host message is not linked to them', () => {
    const viewModel = buildAgentRoomRouteViewModel({
      ...roomDetail,
      room: {
        ...room,
        status: 'completed'
      },
      members: [
        {
          ...roomDetail.members[0]!,
          status: 'completed',
          activeRunCount: 0,
          pendingCount: 0
        }
      ],
      runs: [
        {
          ...roomDetail.runs[0]!,
          status: 'completed'
        }
      ],
      messages: [
        {
          id: 'msg-user-host',
          roomId: room.id,
          role: 'user',
          content: 'hi',
          payload: {
            delivery: {
              kind: 'message',
              receivedAt: 21,
              sessionId: 'host-session'
            },
            reactions: [
              {
                kind: 'working',
                createdAt: 21
              }
            ]
          },
          createdAt: 21
        },
        {
          id: 'msg-host-unlinked',
          roomId: room.id,
          role: 'agent',
          memberKey: 'host:host-session',
          content: 'hi',
          payload: {
            source: 'host_session_message',
            sessionId: 'host-session',
            messageId: 'msg-host-unlinked'
          },
          createdAt: 22
        }
      ]
    })

    expect(viewModel.messages.find(message => message.id === 'msg-user-host')?.reactions).toEqual([
      expect.objectContaining({
        kind: 'working',
        agentLabel: 'leader',
        isHost: true
      })
    ])
  })

  it('marks untargeted host delivery reactions completed after the leader replies to that message', () => {
    const viewModel = buildAgentRoomRouteViewModel({
      ...roomDetail,
      room: {
        ...room,
        status: 'completed'
      },
      members: [
        {
          ...roomDetail.members[0]!,
          status: 'completed',
          activeRunCount: 0,
          pendingCount: 0
        }
      ],
      runs: [
        {
          ...roomDetail.runs[0]!,
          status: 'completed'
        }
      ],
      messages: [
        {
          id: 'msg-user-host',
          roomId: room.id,
          role: 'user',
          content: 'How is it going?',
          payload: {
            delivery: {
              kind: 'message',
              receivedAt: 21,
              sessionId: 'host-session'
            },
            reactions: [
              {
                kind: 'working',
                createdAt: 21
              }
            ]
          },
          createdAt: 21
        },
        {
          id: 'msg-host-reply',
          roomId: room.id,
          role: 'agent',
          memberKey: 'host:host-session',
          content: 'It is done.',
          payload: {
            replyTo: {
              id: 'msg-user-host',
              role: 'user',
              content: 'How is it going?'
            }
          },
          createdAt: 22
        }
      ]
    })

    expect(viewModel.messages.find(message => message.id === 'msg-user-host')?.reactions).toEqual([
      expect.objectContaining({
        kind: 'completed',
        agentLabel: 'leader',
        isHost: true
      })
    ])
  })

  it('maps the latest leader message for a running child run to a working reaction', () => {
    const viewModel = buildAgentRoomRouteViewModel({
      ...roomDetail,
      members: [
        {
          ...roomDetail.members[0]!,
          status: 'active',
          pendingCount: 0
        }
      ],
      runs: [
        {
          ...roomDetail.runs[0]!,
          status: 'running'
        }
      ],
      messages: [
        {
          id: 'msg-host-assignment',
          roomId: room.id,
          role: 'agent',
          memberKey: 'host:host-session',
          runKey: 'release-check',
          content: 'I assigned this to reviewer.',
          eventType: 'assignment_sent',
          createdAt: 20
        },
        {
          id: 'msg-host-old',
          roomId: room.id,
          role: 'agent',
          memberKey: 'host:host-session',
          runKey: 'release-check',
          content: 'Previous approval sent.',
          payload: {
            target: {
              memberKey: 'reviewer',
              runKey: 'release-check'
            }
          },
          createdAt: 21
        },
        {
          id: 'msg-host-latest',
          roomId: room.id,
          role: 'agent',
          memberKey: 'host:host-session',
          runKey: 'release-check',
          content: 'Continue now.',
          payload: {
            target: {
              memberKey: 'reviewer',
              runKey: 'release-check'
            }
          },
          createdAt: 22
        }
      ]
    })

    expect(viewModel.messages.find(message => message.id === 'msg-host-assignment')?.reactions).toBeUndefined()
    expect(viewModel.messages.find(message => message.id === 'msg-host-old')?.reactions).toBeUndefined()
    expect(viewModel.messages.find(message => message.id === 'msg-host-latest')?.reactions).toEqual([
      expect.objectContaining({
        kind: 'working',
        agentLabel: 'reviewer',
        run: expect.objectContaining({
          sessionId: 'child-session'
        })
      })
    ])
  })

  it('does not expose attention payload options as room message actions', () => {
    const viewModel = buildAgentRoomRouteViewModel({
      ...roomDetail,
      messages: [
        {
          id: 'msg-agent-needs-payload-approval',
          roomId: room.id,
          role: 'agent',
          memberKey: 'reviewer',
          runKey: 'release-check',
          content: 'Need permission to continue.',
          eventType: 'attention_requested',
          payload: {
            type: 'attention_requested',
            member: {
              key: 'reviewer',
              kind: 'entity',
              label: 'reviewer'
            },
            run: {
              key: 'release-check',
              sessionId: 'child-session',
              title: 'release-check'
            },
            summary: 'Need permission to continue.',
            requestKind: 'confirmation',
            options: [
              {
                label: 'Allow once',
                value: 'allow_once',
                description: 'Allow this request once.'
              }
            ]
          },
          createdAt: 22
        }
      ]
    })

    expect(viewModel.messages[0]?.options).toBeUndefined()
  })

  it('shows projected leader permission requests as room attention messages', () => {
    const viewModel = buildAgentRoomRouteViewModel({
      ...roomDetail,
      messages: [
        {
          id: 'host-interaction:host-session:codex-approval-2',
          roomId: room.id,
          role: 'agent',
          memberKey: 'host:host-session',
          content: 'Allow Bash to poll child runs?',
          eventType: 'attention_requested',
          payload: {
            source: 'host_session_interaction_request',
            type: 'attention_requested',
            sessionId: 'host-session',
            interactionId: 'codex-approval:2',
            requestKind: 'confirmation',
            status: 'pending',
            permissionContext: {
              subjectLabel: 'Bash'
            },
            options: [{ label: 'Allow once', value: 'allow_once' }]
          },
          createdAt: 22
        }
      ]
    })

    expect(viewModel.messages).toEqual([
      expect.objectContaining({
        id: 'host-interaction:host-session:codex-approval-2',
        kind: 'attention',
        memberKey: 'host:host-session',
        content: 'Allow Bash to poll child runs?',
        interactionRequest: {
          sessionId: 'host-session',
          interactionId: 'codex-approval:2',
          requestKind: 'confirmation',
          status: 'pending',
          options: [{ label: 'Allow once', value: 'allow_once' }],
          subjectLabel: 'Bash'
        }
      })
    ])
    expect(viewModel.messages[0]).not.toHaveProperty('approvalBatch')
    expect(buildAgentRoomViewModel(viewModel).messages[0]?.member).toEqual(expect.objectContaining({
      kind: 'host',
      label: 'leader'
    }))
  })

  it('collapses repeated child approval requests into one approval batch message', () => {
    const viewModel = buildAgentRoomRouteViewModel({
      ...roomDetail,
      runs: [
        {
          ...roomDetail.runs[0]!,
          interactionId: 'approval-3'
        }
      ],
      messages: [
        {
          id: 'msg-approval-1',
          roomId: room.id,
          role: 'agent',
          memberKey: 'reviewer',
          runKey: 'release-check',
          content: 'Allow first read-only command?',
          eventType: 'attention_requested',
          payload: {
            type: 'attention_requested',
            interactionId: 'approval-1',
            requestKind: 'confirmation',
            options: [{ label: 'Allow once', value: 'allow_once' }]
          },
          createdAt: 21
        },
        {
          id: 'msg-approval-2',
          roomId: room.id,
          role: 'agent',
          memberKey: 'reviewer',
          runKey: 'release-check',
          content: 'Allow second read-only command?',
          eventType: 'attention_requested',
          payload: {
            type: 'attention_requested',
            interactionId: 'approval-2',
            requestKind: 'confirmation',
            options: [{ label: 'Allow session', value: 'allow_session' }]
          },
          createdAt: 22
        },
        {
          id: 'msg-approval-3',
          roomId: room.id,
          role: 'agent',
          memberKey: 'reviewer',
          runKey: 'release-check',
          content: 'Allow current read-only command?',
          eventType: 'attention_requested',
          payload: {
            type: 'attention_requested',
            interactionId: 'approval-3',
            requestKind: 'confirmation',
            options: [{ label: 'Allow once', value: 'allow_once' }]
          },
          createdAt: 23
        }
      ]
    })

    expect(viewModel.messages).toHaveLength(1)
    expect(viewModel.messages[0]).toEqual(expect.objectContaining({
      id: 'approval-batch:msg-approval-3',
      kind: 'attention',
      memberKey: 'reviewer',
      runKey: 'release-check',
      approvalBatch: expect.objectContaining({
        totalCount: 3,
        pendingCount: 1,
        handledCount: 2,
        actionCount: 0,
        latest: expect.objectContaining({
          content: 'Allow current read-only command?',
          interactionId: 'approval-3',
          status: 'pending'
        })
      })
    }))
  })

  it('folds leader approval acknowledgements into the approval batch', () => {
    const viewModel = buildAgentRoomRouteViewModel({
      ...roomDetail,
      members: [
        {
          ...roomDetail.members[0]!,
          status: 'completed',
          pendingCount: 0,
          activeRunCount: 0
        }
      ],
      runs: [
        {
          ...roomDetail.runs[0]!,
          status: 'completed'
        }
      ],
      messages: [
        {
          id: 'msg-approval-1',
          roomId: room.id,
          role: 'agent',
          memberKey: 'reviewer',
          runKey: 'release-check',
          content: 'Allow first read-only command?',
          eventType: 'attention_requested',
          payload: {
            type: 'attention_requested',
            interactionId: 'approval-1',
            requestKind: 'confirmation'
          },
          createdAt: 21
        },
        {
          id: 'msg-host-approval-1',
          roomId: room.id,
          role: 'agent',
          memberKey: 'host:host-session',
          runKey: 'release-check',
          content: 'Approved approval-1 for reviewer.',
          payload: {
            target: {
              memberKey: 'reviewer',
              runKey: 'release-check'
            }
          },
          createdAt: 22
        },
        {
          id: 'msg-approval-2',
          roomId: room.id,
          role: 'agent',
          memberKey: 'reviewer',
          runKey: 'release-check',
          content: 'Allow second read-only command?',
          eventType: 'attention_requested',
          payload: {
            type: 'attention_requested',
            interactionId: 'approval-2',
            requestKind: 'confirmation'
          },
          createdAt: 23
        },
        {
          id: 'msg-host-approval-2',
          roomId: room.id,
          role: 'agent',
          memberKey: 'host:host-session',
          runKey: 'release-check',
          content: '已代为批准 `codex-approval:1`、`codex-approval:2`。',
          payload: {
            target: {
              memberKey: 'reviewer',
              runKey: 'release-check'
            }
          },
          createdAt: 24
        }
      ]
    })

    expect(viewModel.messages.map(message => message.id)).toEqual(['approval-batch:msg-host-approval-2'])
    expect(viewModel.messages[0]).toEqual(expect.objectContaining({
      kind: 'message',
      approvalBatch: expect.objectContaining({
        totalCount: 2,
        pendingCount: 0,
        handledCount: 2,
        actionCount: 2,
        actions: [
          expect.objectContaining({
            id: 'msg-host-approval-1',
            content: 'Approved approval-1 for reviewer.'
          }),
          expect.objectContaining({
            id: 'msg-host-approval-2',
            interactionIds: ['codex-approval:1', 'codex-approval:2']
          })
        ]
      })
    }))
  })

  it('filters ordinary child agent output out of the room transcript', () => {
    const viewModel = buildAgentRoomRouteViewModel({
      ...roomDetail,
      messages: [
        {
          id: 'msg-user',
          roomId: room.id,
          role: 'user',
          content: 'Please coordinate.',
          createdAt: 20
        },
        {
          id: 'msg-progress',
          roomId: room.id,
          role: 'agent',
          memberKey: 'reviewer',
          runKey: 'release-check',
          content: 'I am checking files one by one.',
          eventType: 'run_replied',
          createdAt: 21
        },
        {
          id: 'msg-resumed',
          roomId: room.id,
          role: 'agent',
          memberKey: 'reviewer',
          runKey: 'release-check',
          content: 'The run resumed.',
          eventType: 'run_resumed',
          createdAt: 22
        },
        {
          id: 'msg-approval',
          roomId: room.id,
          role: 'agent',
          memberKey: 'reviewer',
          runKey: 'release-check',
          content: 'Need permission to continue.',
          eventType: 'attention_requested',
          createdAt: 23
        },
        {
          id: 'msg-completed',
          roomId: room.id,
          role: 'agent',
          memberKey: 'reviewer',
          runKey: 'release-check',
          content: 'Release check completed.',
          eventType: 'run_completed',
          createdAt: 24
        }
      ]
    })

    expect(viewModel.messages.map(message => message.id)).toEqual([
      'msg-user',
      'msg-approval',
      'msg-completed'
    ])
  })

  it('attributes assignment messages to the leader agent instead of the target child agent', () => {
    const viewModel = buildAgentRoomRouteViewModel({
      ...roomDetail,
      messages: [
        {
          id: 'msg-assignment',
          roomId: room.id,
          role: 'agent',
          memberKey: 'reviewer',
          runKey: 'release-check',
          content: 'Please run release validation.',
          eventType: 'assignment_sent',
          createdAt: 20
        }
      ]
    })

    expect(viewModel.messages[0]).toEqual(expect.objectContaining({
      id: 'msg-assignment',
      content: 'Please run release validation.',
      memberKey: 'host:host-session',
      runKey: 'release-check',
      targetLabel: 'reviewer'
    }))
    expect(buildAgentRoomViewModel(viewModel).messages[0]?.member).toEqual(expect.objectContaining({
      label: 'leader'
    }))
  })

  it('shows host assistant room messages as leader messages', () => {
    const viewModel = buildAgentRoomRouteViewModel({
      ...roomDetail,
      messages: [
        {
          id: 'msg-host-assistant',
          roomId: room.id,
          role: 'agent',
          memberKey: 'host:host-session',
          content: 'I will coordinate the child agents from here.',
          payload: {
            target: {
              memberKey: 'reviewer',
              runKey: 'release-check'
            }
          },
          createdAt: 20
        },
        {
          id: 'msg-child-progress',
          roomId: room.id,
          role: 'agent',
          memberKey: 'reviewer',
          runKey: 'release-check',
          content: 'Internal progress that should stay out of the room.',
          eventType: 'run_replied',
          createdAt: 21
        }
      ]
    })

    expect(viewModel.messages.map(message => message.id)).toEqual(['msg-host-assistant'])
    expect(viewModel.messages[0]).toEqual(expect.objectContaining({
      targetLabel: '@reviewer/release-check'
    }))
    expect(buildAgentRoomViewModel(viewModel).messages[0]?.member).toEqual(expect.objectContaining({
      kind: 'host',
      label: 'leader'
    }))
  })

  it('shows projected child session replies in the room timeline', () => {
    const viewModel = buildAgentRoomRouteViewModel({
      ...roomDetail,
      messages: [
        {
          id: 'msg-targeted-user',
          roomId: room.id,
          role: 'user',
          content: 'hi?',
          payload: {
            target: {
              memberKey: 'reviewer',
              runKey: 'release-check'
            }
          },
          createdAt: 20
        },
        {
          id: 'child-message:child-session:msg-child-reply',
          roomId: room.id,
          role: 'agent',
          memberKey: 'reviewer',
          runKey: 'release-check',
          content: 'I am here.',
          payload: {
            source: 'child_session_message',
            sessionId: 'child-session',
            messageId: 'msg-child-reply',
            replyTo: {
              id: 'msg-targeted-user',
              role: 'user',
              content: 'hi?'
            },
            target: {
              memberKey: 'reviewer',
              runKey: 'release-check'
            }
          },
          createdAt: 21
        }
      ]
    })

    expect(viewModel.messages.map(message => message.id)).toEqual([
      'msg-targeted-user',
      'child-message:child-session:msg-child-reply'
    ])
    expect(viewModel.messages[0]).toEqual(expect.objectContaining({
      targetLabel: '@reviewer/release-check'
    }))
    expect(viewModel.messages[1]).toEqual(expect.objectContaining({
      memberKey: 'reviewer',
      runKey: 'release-check',
      targetLabel: undefined,
      replyTo: {
        id: 'msg-targeted-user',
        role: 'user',
        content: 'hi?'
      }
    }))
    expect(buildAgentRoomViewModel(viewModel).messages[1]).toEqual(expect.objectContaining({
      member: expect.objectContaining({ label: 'reviewer' }),
      run: expect.objectContaining({ title: 'release-check' })
    }))
  })

  it('does not render scoped target mentions as projected child reply text', () => {
    const viewModel = buildAgentRoomRouteViewModel({
      ...roomDetail,
      members: [
        {
          roomId: room.id,
          key: 'entity:std/dev-reviewer',
          kind: 'entity',
          label: 'std/dev-reviewer',
          status: 'waiting',
          activeRunCount: 1,
          pendingCount: 1,
          createdAt: 11,
          updatedAt: 18
        }
      ],
      runs: [
        {
          roomId: room.id,
          key: 'run:reviewer-intro',
          memberKey: 'entity:std/dev-reviewer',
          sessionId: 'child-session',
          title: 'Reviewer',
          status: 'waiting',
          createdAt: 12,
          updatedAt: 18
        }
      ],
      messages: [
        {
          id: 'msg-targeted-user',
          roomId: room.id,
          role: 'user',
          content: '自我介绍',
          payload: {
            target: {
              memberKey: 'entity:std/dev-reviewer',
              runKey: 'run:reviewer-intro'
            }
          },
          createdAt: 20
        },
        {
          id: 'child-message:child-session:msg-child-reply',
          roomId: room.id,
          role: 'agent',
          memberKey: 'entity:std/dev-reviewer',
          runKey: 'run:reviewer-intro',
          content: '在。',
          payload: {
            source: 'child_session_message',
            sessionId: 'child-session',
            messageId: 'msg-child-reply',
            replyTo: {
              id: 'msg-targeted-user',
              role: 'user',
              content: '自我介绍'
            },
            target: {
              memberKey: 'entity:std/dev-reviewer',
              runKey: 'run:reviewer-intro'
            }
          },
          createdAt: 21
        }
      ]
    })

    expect(viewModel.messages[0]).toEqual(expect.objectContaining({
      content: '自我介绍',
      targetLabel: '@std/dev-reviewer/Reviewer'
    }))
    expect(viewModel.messages[1]).toEqual(expect.objectContaining({
      content: '在。',
      targetLabel: undefined
    }))
  })

  it('maps projected host reply references into room message quotes', () => {
    const viewModel = buildAgentRoomRouteViewModel({
      ...roomDetail,
      messages: [
        {
          id: 'msg-user-status',
          roomId: room.id,
          role: 'user',
          content: 'Where are we now?',
          createdAt: 20
        },
        {
          id: 'msg-host-status',
          roomId: room.id,
          role: 'agent',
          memberKey: 'host:host-session',
          content: 'Both child runs are completed.',
          payload: {
            source: 'host_session_message',
            replyTo: {
              id: 'msg-user-status',
              role: 'user',
              content: 'Where are we now?'
            }
          },
          createdAt: 21
        }
      ]
    })

    expect(viewModel.messages[1]).toEqual(expect.objectContaining({
      id: 'msg-host-status',
      replyTo: {
        id: 'msg-user-status',
        role: 'user',
        content: 'Where are we now?'
      }
    }))
  })

  it('preserves terminal member and run status from room projection independently of host session status', () => {
    const viewModel = buildAgentRoomRouteViewModel({
      ...roomDetail,
      room: {
        ...roomDetail.room,
        status: 'completed'
      },
      members: [
        {
          ...roomDetail.members[0]!,
          status: 'completed',
          activeRunCount: 0,
          pendingCount: 0
        }
      ],
      runs: [
        {
          ...roomDetail.runs[0]!,
          status: 'completed'
        }
      ]
    })

    expect(viewModel.status).toBe('completed')
    expect(viewModel.members[0]?.status).toBe('completed')
    expect(viewModel.members[0]?.runs[0]?.status).toBe('completed')
  })
})
