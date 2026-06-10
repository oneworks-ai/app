import { App as AntApp } from 'antd'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import type { SessionInfo } from '@oneworks/types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: { roomTitle?: string; sessionTitle?: string }) => {
      if (key === 'agentRoom.sessionBreadcrumbLabel') {
        return `${params?.roomTitle ?? ''} / ${params?.sessionTitle ?? ''}`
      }
      return key
    }
  })
}))

const placeholderSessionInfo = {
  type: 'init',
  uuid: 'init-uuid',
  model: 'gpt-test',
  version: '1.0.0',
  tools: [],
  slashCommands: [],
  cwd: '/workspace',
  agents: [],
  title: '没有会话标题'
} satisfies SessionInfo

const renderHeader = async (props: {
  breadcrumb?: {
    backLabel: string
    parentTitle: string
    onBack: () => void
  }
  moreItems?: Array<{
    key: string
    label: string
  }>
  sessionId?: string
  sessionTitle?: string
  sessionInfo?: SessionInfo | null
  roomIconSeed?: string
  roomIconStatus?: 'active' | 'waiting' | 'completed' | 'failed' | 'idle'
  modeSwitch?: {
    mode: 'session' | 'room'
    onOpenRoom: () => void
    onOpenSession: () => void
  }
  enableTimelineView?: boolean
}) => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined
  })
  const { ChatHeader } = await import('#~/components/chat/ChatHeader')

  return renderToStaticMarkup(
    <MemoryRouter>
      <AntApp>
        <ChatHeader
          breadcrumb={props.breadcrumb}
          roomIconSeed={props.roomIconSeed}
          roomIconStatus={props.roomIconStatus}
          moreItems={props.moreItems}
          sessionId={props.sessionId ?? 'session-1'}
          sessionInfo={props.sessionInfo ?? null}
          sessionTitle={props.sessionTitle}
          activeView='history'
          enableTimelineView={props.enableTimelineView}
          isBottomPanelOpen={false}
          isWorkspaceDrawerOpen={false}
          modeSwitch={props.modeSwitch}
          onViewChange={() => undefined}
          onToggleBottomPanel={() => undefined}
          onToggleWorkspaceDrawer={() => undefined}
        />
      </AntApp>
    </MemoryRouter>
  )
}

describe('chat header session title', () => {
  it('uses the persisted session title before adapter init title placeholders', async () => {
    const html = await renderHeader({
      sessionInfo: placeholderSessionInfo,
      sessionTitle: '真实子会话标题'
    })

    expect(html).toContain('真实子会话标题')
    expect(html).not.toContain('没有会话标题')
  })

  it('uses the persisted session title in room session breadcrumbs', async () => {
    const html = await renderHeader({
      breadcrumb: {
        backLabel: '返回房间',
        parentTitle: 'Agent Room',
        onBack: () => undefined
      },
      sessionInfo: placeholderSessionInfo,
      sessionTitle: '真实子会话标题'
    })

    expect(html).toContain('aria-label="Agent Room / 真实子会话标题"')
    expect(html).toContain('aria-label="返回房间"')
    expect(html).toContain('chevron_left')
    expect(html).not.toContain('arrow_back')
    expect(html).not.toContain('>返回房间</span>')
    expect(html).toContain('Agent Room')
    expect(html).toContain('真实子会话标题')
    expect(html).not.toContain('没有会话标题')
  })

  it('renders injected more actions without a session id', async () => {
    const html = await renderHeader({
      sessionId: '',
      moreItems: [{ key: 'room-copy', label: '复制房间链接' }]
    })

    expect(html).toContain('aria-label="common.moreActions"')
    expect(html).toContain('more_vert')
  })

  it('hides unfinished timeline and settings from the primary header by default', async () => {
    const html = await renderHeader({})

    expect(html).toContain('aria-label="chat.viewHistory"')
    expect(html).toContain('>history</span>')
    expect(html).not.toContain('aria-label="chat.viewTimeline"')
    expect(html).not.toContain('aria-label="chat.viewSettings"')
  })

  it('shows the timeline header entry when the experiment is enabled', async () => {
    const html = await renderHeader({ enableTimelineView: true })

    expect(html).toContain('aria-label="chat.viewHistory"')
    expect(html).toContain('aria-label="chat.viewTimeline"')
    expect(html).toContain('>timeline</span>')
    expect(html).not.toContain('aria-label="chat.viewSettings"')
  })

  it('renders a single target mode switch when a room is associated', async () => {
    const html = await renderHeader({
      modeSwitch: {
        mode: 'room',
        onOpenRoom: () => undefined,
        onOpenSession: () => undefined
      },
      roomIconSeed: 'room-header-test',
      roomIconStatus: 'completed'
    })

    expect(html).toContain('aria-label="agentRoom.mode.session"')
    expect(html).not.toContain('aria-label="agentRoom.mode.room"')
    expect(html).toContain('chat_bubble')
    expect(html).toContain('chat-header-room-icon')
    expect(html).toContain('chat-header-room-icon--completed')
    expect(html).toContain('room-pixel-avatar')
  })

  it('renders the room title icon without requiring an explicit icon seed', async () => {
    const html = await renderHeader({
      modeSwitch: {
        mode: 'room',
        onOpenRoom: () => undefined,
        onOpenSession: () => undefined
      },
      sessionTitle: 'Agent Room'
    })

    expect(html).toContain('chat-header-room-icon')
    expect(html).toContain('room-pixel-avatar')
    expect(html).toContain('Agent Room')
  })

  it('renders the room target when currently in session mode', async () => {
    const html = await renderHeader({
      modeSwitch: {
        mode: 'session',
        onOpenRoom: () => undefined,
        onOpenSession: () => undefined
      }
    })

    expect(html).toContain('aria-label="agentRoom.mode.room"')
    expect(html).not.toContain('aria-label="agentRoom.mode.session"')
    expect(html).toContain('forum')
  })
})
