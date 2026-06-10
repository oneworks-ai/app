import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { AppRoutes } from '#~/routes/AppRoutes'

vi.mock('#~/routes/AgentRoomRoute', () => ({
  AgentRoomRoute: () => <div>agent-room-route</div>
}))

vi.mock('#~/routes/AgentRoomSessionRoute', () => ({
  AgentRoomSessionRoute: () => <div>agent-room-session-route</div>
}))

vi.mock('#~/routes/ArchiveRoute', () => ({
  ArchiveRoute: () => <div>archive-route</div>
}))

vi.mock('#~/routes/AutomationRoute', () => ({
  AutomationRoute: () => <div>automation-route</div>
}))

vi.mock('#~/routes/BenchmarkRoute', () => ({
  BenchmarkRoute: () => <div>benchmark-route</div>
}))

vi.mock('#~/routes/ChatRoute', () => ({
  ChatRoute: () => <div>chat-route</div>
}))

vi.mock('#~/routes/ConfigRoute', () => ({
  ConfigRoute: () => <div>config-route</div>
}))

vi.mock('#~/routes/KnowledgeRoute', () => ({
  KnowledgeRoute: () => <div>knowledge-route</div>
}))

describe('app routes agent room session route', () => {
  it('matches /rooms/:roomId/sessions/:sessionId with the room-scoped child session route', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/rooms/room-1/sessions/session-1']}>
        <AppRoutes />
      </MemoryRouter>
    )

    expect(html).toContain('agent-room-session-route')
    expect(html).not.toContain('agent-room-route')
  })
})
