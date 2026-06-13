import { App as AntApp } from 'antd'
import { createInstance } from 'i18next'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider, initReactI18next, useTranslation } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { AgentRoomRoster } from '#~/components/agent-room'
import type { AgentRoomMemberView, AgentRoomViewModel } from '#~/components/agent-room'
import { useInteractionTerminalPanes } from '#~/components/chat/interaction-panel/use-interaction-terminal-panes'
import { ChatWorkspaceDrawer } from '#~/components/chat/workspace-drawer/ChatWorkspaceDrawer'
import type {
  ChatWorkspaceDrawerAgentApprovals,
  ChatWorkspaceDrawerAgentRoster
} from '#~/components/chat/workspace-drawer/ChatWorkspaceDrawer'
import type { WorkspaceDrawerView } from '#~/components/chat/workspace-drawer/workspace-drawer-types'
import en from '#~/resources/locales/en.json'

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
      clear: () => undefined
    }
  })
})

const createI18n = async () => {
  const i18n = createInstance()
  await i18n
    .use(initReactI18next)
    .init({
      lng: 'en',
      resources: {
        en: {
          translation: en
        }
      }
    })

  return i18n
}

const members: AgentRoomMemberView[] = [
  {
    memberKey: 'host',
    label: '@host',
    subtitle: 'Coordinator',
    avatarLabel: 'H',
    status: 'active',
    pendingCount: 0,
    activeRunCount: 1,
    latestSummary: 'Coordinating room work.',
    runs: [
      {
        runKey: 'host-plan',
        memberKey: 'host',
        sessionId: 'session-host-plan',
        title: 'room-plan',
        status: 'running',
        latestSummary: 'Tracking assignments.'
      }
    ]
  },
  {
    memberKey: 'architect',
    label: '@architect',
    subtitle: 'Schema planner',
    avatarLabel: 'AR',
    status: 'waiting',
    pendingCount: 1,
    activeRunCount: 1,
    latestSummary: 'Needs schema permission.',
    runs: [
      {
        runKey: 'schema-plan',
        memberKey: 'architect',
        sessionId: 'session-schema-plan',
        title: 'schema-plan',
        status: 'waiting',
        latestSummary: 'Waiting for confirmation.',
        pendingCount: 1
      }
    ]
  }
]

const roomWithApproval: AgentRoomViewModel = {
  id: 'room-approval',
  title: 'Approval room',
  status: 'waiting',
  members,
  messages: [
    {
      id: 'msg-schema-attention',
      role: 'agent',
      kind: 'attention',
      memberKey: 'architect',
      runKey: 'schema-plan',
      content: 'I need confirmation before editing schema files.',
      createdAtLabel: '10:41',
      options: [
        {
          label: 'Allow schema change',
          value: 'allow_schema',
          description: 'Let the architect update schema files.'
        },
        {
          label: 'Keep plan read-only',
          value: 'read_only',
          description: 'Ask for a plan without edits.'
        }
      ]
    }
  ]
}

const roomWithoutApproval: AgentRoomViewModel = {
  id: 'room-active',
  title: 'Active room',
  status: 'active',
  members,
  messages: [
    {
      id: 'msg-host-update',
      role: 'agent',
      kind: 'message',
      memberKey: 'host',
      runKey: 'host-plan',
      content: 'Continuing implementation.',
      createdAtLabel: '10:42'
    }
  ]
}

const renderDrawer = async ({
  agentApprovals,
  agentRoster,
  defaultView,
  settingsView
}: {
  agentApprovals?: ChatWorkspaceDrawerAgentApprovals
  agentRoster?: ChatWorkspaceDrawerAgentRoster
  defaultView?: WorkspaceDrawerView
  settingsView?: ReactNode
} = {}) => {
  const i18n = await createI18n()
  let resolvedDefaultView = defaultView
  if (resolvedDefaultView == null) {
    if (agentApprovals != null) {
      resolvedDefaultView = 'approvals'
    } else if (agentRoster != null) {
      resolvedDefaultView = 'agents'
    } else {
      resolvedDefaultView = 'tree'
    }
  }
  const TestDrawer = () => {
    const { t } = useTranslation()
    const terminalPanes = useInteractionTerminalPanes('__workspace__', t)

    return (
      <ChatWorkspaceDrawer
        agentApprovals={agentApprovals}
        agentRoster={agentRoster}
        defaultView={resolvedDefaultView}
        settingsView={settingsView}
        terminalSessionId='__workspace__'
        terminalPanes={terminalPanes}
        onOpenResource={() => {}}
      />
    )
  }

  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <TestDrawer />
    </I18nextProvider>
  )
}

const renderRoster = async ({
  defaultExpandedMemberKeys = []
}: {
  defaultExpandedMemberKeys?: string[]
} = {}) => {
  const i18n = await createI18n()

  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <AgentRoomRoster
        defaultExpandedMemberKeys={defaultExpandedMemberKeys}
        layout='desktop'
        members={members}
        showHeader={false}
        onOpenRun={() => undefined}
      />
    </I18nextProvider>
  )
}

const renderHeader = async () => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined
  })
  const { ChatHeader } = await import('#~/components/chat/ChatHeader')
  const i18n = await createI18n()

  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <AntApp>
          <ChatHeader
            sessionInfo={null}
            activeView='history'
            isBottomPanelOpen={false}
            isWorkspaceDrawerOpen={false}
            onViewChange={() => undefined}
            onToggleBottomPanel={() => undefined}
            onToggleWorkspaceDrawer={() => undefined}
          />
        </AntApp>
      </MemoryRouter>
    </I18nextProvider>
  )
}

describe('chat workspace drawer agents tab', () => {
  it('keeps normal sessions on the existing workspace tabs only', async () => {
    const html = await renderDrawer()

    expect(html.match(/chat-workspace-drawer__view-btn/g)?.length).toBe(2)
    expect(html).toContain('aria-label="Directory tree"')
    expect(html).toContain('aria-label="Changed files"')
    expect(html).not.toContain('aria-label="Approvals"')
    expect(html).not.toContain('aria-label="Agents"')
    expect(html).not.toContain('agent-room-roster')
    expect(html).not.toContain('chat-workspace-drawer__approvals')
  })

  it('renders room members collapsed by default without per-member stats', async () => {
    const html = await renderDrawer({ agentRoster: { members } })

    expect(html.match(/chat-workspace-drawer__view-btn/g)?.length).toBe(3)
    expect(html).toContain('aria-label="Agents"')
    expect(html).toContain('chat-workspace-drawer__view-count">1</span>')
    expect(html).toContain('chat-workspace-drawer__agents-panel')
    expect(html).toContain('agent-room-roster')
    expect(html).not.toContain('<h2>Room members</h2>')
    expect(html).toContain('agent-room-roster__member-name">host</div>')
    expect(html).toContain('agent-room-roster__member-name">architect</div>')
    expect(html).not.toContain('@host')
    expect(html).not.toContain('@architect')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('Show sessions')
    expect(html).not.toContain('agent-room-roster__member-stats')
    expect(html).not.toContain('1 active')
    expect(html).not.toContain('1 pending')
    expect(html).not.toContain('schema-plan')
    expect(html).not.toContain('agent-room-run-list')
    expect(html).not.toContain('agent-room-run-list__title-button')
    expect(html).not.toContain('agent-room-run-list__action')
    expect(html).not.toContain('Open run')
    expect(html).not.toContain('aria-label="Reveal file"')
  })

  it('defaults to the members tab when the room has no pending approvals', async () => {
    const html = await renderDrawer({
      agentApprovals: {
        room: roomWithoutApproval
      },
      agentRoster: { members }
    })

    expect(html.match(/chat-workspace-drawer__view-btn/g)?.length).toBe(4)
    expect(html).toContain('aria-label="Approvals"')
    expect(html).toContain('aria-label="Agents"')
    expect(html).toContain('chat-workspace-drawer__agents-panel')
    expect(html).toContain('agent-room-roster')
    expect(html).not.toContain('chat-workspace-drawer__approvals')
    expect(html).not.toContain('No pending approvals')
  })

  it('renders session settings as a workspace drawer tab when provided', async () => {
    const html = await renderDrawer({
      defaultView: 'settings',
      settingsView: <div className='settings-fixture'>Session settings fixture</div>
    })

    expect(html.match(/chat-workspace-drawer__view-btn/g)?.length).toBe(3)
    expect(html).toContain('aria-label="Settings"')
    expect(html).toContain('chat-workspace-drawer__settings-panel')
    expect(html).toContain('Session settings fixture')
    expect(html).not.toContain('aria-label="Approvals"')
    expect(html).not.toContain('aria-label="Agents"')
  })

  it('can expand a member session section and uses session-card markup for runs', async () => {
    const html = await renderRoster({ defaultExpandedMemberKeys: ['architect'] })

    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('Hide sessions')
    expect(html).toContain('data-session-card-source="agent-room-run"')
    expect(html).toContain('session-item session-item--compact')
    expect(html).toContain('session-item-content')
    expect(html).toContain('session-title-text')
    expect(html).toContain('schema-plan')
    expect(html).toContain('aria-label="Open run: schema-plan"')
    expect(html).not.toContain('agent-room-run-list__action')
    expect(html).not.toContain('>Open run</span>')
    expect(html).not.toContain('open_in_new')
  })

  it('uses run titles as navigation targets when expanded and run opening is available', async () => {
    const html = await renderDrawer({
      agentRoster: {
        members
      }
    })
    const expandedHtml = await renderRoster({ defaultExpandedMemberKeys: ['architect'] })

    expect(html).not.toContain('Open run: schema-plan')
    expect(expandedHtml).toMatch(
      /<button type="button" class="agent-room-run-list__title-button session-title-text" aria-label="Open run: schema-plan" title="Open run: schema-plan">schema-plan<\/button>/
    )
    expect(expandedHtml).not.toContain('agent-room-run-list__action')
    expect(expandedHtml).not.toContain('>Open run</span>')
    expect(expandedHtml).not.toContain('open_in_new')
  })

  it('renders pending room approvals as a read-only dock tab without child interaction actions', async () => {
    const html = await renderDrawer({
      agentApprovals: {
        room: roomWithApproval
      },
      agentRoster: { members },
      defaultView: 'approvals'
    })

    expect(html.match(/chat-workspace-drawer__view-btn/g)?.length).toBe(4)
    expect(html).toContain('aria-label="Approvals"')
    expect(html).toContain('chat-workspace-drawer__view-count">1</span>')
    expect(html).toContain('chat-workspace-drawer__approvals')
    expect(html).toContain('chat-workspace-drawer__approval-agent">architect</span>')
    expect(html).not.toContain('@architect')
    expect(html).toContain('schema-plan')
    expect(html).toContain('Waiting')
    expect(html).toContain('The leader will decide whether to ask you for approval.')
    expect(html).toContain('I need confirmation before editing schema files.')
    expect(html).not.toContain('chat-workspace-drawer__approval-option')
    expect(html).not.toContain('Allow schema change')
    expect(html).not.toContain('Keep plan read-only')
    expect(html).not.toContain('agent-room-roster')
    expect(html).not.toContain('aria-label="Reveal file"')
  })

  it('uses a sidebar icon for the top-right workspace drawer toggle', async () => {
    const html = await renderHeader()

    expect(html).toContain('view_sidebar')
    expect(html).not.toContain('folder_open')
    expect(html).not.toContain('>folder</span>')
  })
})
