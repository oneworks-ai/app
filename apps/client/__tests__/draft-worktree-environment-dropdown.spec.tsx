import type { ButtonHTMLAttributes, ReactNode } from 'react'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { DraftWorktreeEnvironmentDropdown } from '#~/components/chat/git-controls/DraftWorktreeEnvironmentDropdown'

vi.mock('antd', () => ({
  Button: ({
    children,
    type: _type,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { type?: string }) => (
    <button {...props}>{children}</button>
  ),
  Dropdown: ({
    children,
    popupRender
  }: {
    children: ReactNode
    popupRender: () => ReactNode
  }) => (
    <>
      {children}
      {popupRender()}
    </>
  )
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('swr', () => ({
  default: () => ({
    data: { environments: [] }
  })
}))

vi.mock('#~/api', () => ({
  listWorktreeEnvironments: vi.fn()
}))

vi.mock('#~/components/overlay', () => ({
  OverlayAction: ({
    children,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  OverlayPanel: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

vi.mock(
  '#~/components/chat/sender/@components/mobile-select-drawer/SenderMobileSelectDrawer',
  () => ({
    SenderMobileSelectDrawer: ({ children }: { children: ReactNode }) => <div>{children}</div>
  })
)

describe('draft worktree environment dropdown', () => {
  it('treats the default environment as the available fallback without an empty state', () => {
    const html = renderToStaticMarkup(
      <DraftWorktreeEnvironmentDropdown onChange={() => undefined} />
    )

    expect(html).toContain('chat.sessionWorkspaceEnvironmentDefault')
    expect(html).not.toContain('chat.sessionWorkspaceNoEnvironments')
  })
})
