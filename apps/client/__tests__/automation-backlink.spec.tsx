import { App as AntApp } from 'antd'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Session } from '@oneworks/core'

import { SessionItem } from '#~/components/sidebar/SessionItem'

vi.mock('#~/components/sidebar/SessionContextMenu', () => ({
  SessionContextMenu: ({ children }: { children: React.ReactNode }) => children
}))

vi.mock('#~/hooks/use-resolved-theme-mode', () => ({
  useResolvedThemeMode: () => ({ resolvedThemeMode: 'light' })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: {
      language: 'en',
      resolvedLanguage: 'en'
    },
    t: (key: string) => key
  })
}))

const session: Session = {
  id: 'session/run one',
  createdAt: Date.UTC(2026, 6, 29),
  tags: ['automation:rule/one:Nightly check']
}

const renderSessionItem = (basename: string) =>
  renderToStaticMarkup(
    <MemoryRouter
      basename={basename}
      initialEntries={[`${basename}/session/${encodeURIComponent(session.id)}`]}
    >
      <AntApp>
        <SessionItem
          session={session}
          isActive
          isBatchMode={false}
          isCompactLayout={false}
          isSelected={false}
          isTouchInteraction={false}
          showMessagePreview={false}
          onSelect={() => undefined}
          onArchive={() => undefined}
          onDelete={() => undefined}
          onRename={async () => undefined}
          onStar={() => undefined}
          onToggleSelect={() => undefined}
        />
      </AntApp>
    </MemoryRouter>
  )

afterEach(() => {
  vi.restoreAllMocks()
})

describe('automation session backlink', () => {
  it('uses router navigation to preserve a non-root public base, workspace, rule, and run', () => {
    const html = renderSessionItem('/console/w/w_abc123456')
    const rawHref = html.match(/href="([^"]*\/automation[^"]*)"/)?.[1]
    const href = rawHref?.replaceAll('&amp;', '&')

    expect(href).toBeDefined()

    const url = new URL(href!, 'https://oneworks.test')
    expect(url.pathname).toBe('/console/w/w_abc123456/automation')
    expect(url.searchParams.get('rule')).toBe('rule/one')
    expect(url.searchParams.get('runQ')).toBe(session.id)
  })
})
