// @vitest-environment happy-dom
import type { ButtonHTMLAttributes, ReactNode } from 'react'

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GitWorktreeDropdown } from '#~/components/chat/git-controls/GitWorktreeDropdown'

vi.mock('antd', () => ({
  Button: ({ children, type: _type, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { type?: string }) => (
    <button {...props}>{children}</button>
  ),
  Dropdown: ({ children, popupRender }: { children: ReactNode; popupRender: () => ReactNode }) => (
    <>{children}{popupRender()}</>
  ),
  Switch: () => <button />
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('#~/components/overlay', () => ({
  OverlayAction: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  OverlayActionRow: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  OverlayPanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  OverlaySearchRow: () => <input />
}))

vi.mock(
  '#~/components/chat/sender/@components/mobile-select-drawer/SenderMobileSelectDrawer',
  () => ({
    SenderMobileSelectBreadcrumbs: () => null,
    SenderMobileSelectDrawer: ({ children }: { children: ReactNode }) => <div>{children}</div>
  })
)

let container: HTMLDivElement
let root: Root

const renderDropdown = async (eligible: boolean) => {
  await act(async () => {
    root.render(
      <GitWorktreeDropdown
        open
        workspace={{
          cleanupPolicy: 'retain',
          createdAt: 0,
          kind: 'shared_workspace',
          sessionId: 'session-1',
          state: 'ready',
          updatedAt: 0,
          workspaceFolder: '/workspace/app',
          worktreeDerivation: eligible
            ? { eligible: true }
            : { eligible: false, disabledReason: 'external_runtime' }
        }}
        worktrees={[]}
        mode={{
          type: 'session',
          isBusy: false,
          worktreeDerivation: eligible
            ? { eligible: true }
            : { eligible: false, disabledReason: 'external_runtime' },
          canTransferToLocal: false,
          onCreateManagedWorktree: () => undefined,
          onTransferToLocal: () => undefined
        }}
        onOpenChange={() => undefined}
      />
    )
  })
}

describe('git worktree dropdown', () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('keeps Create Worktree mounted and explains external-runtime recovery', async () => {
    await renderDropdown(false)

    const createWorktree = [...container.querySelectorAll('button')]
      .find(button => button.textContent?.includes('chat.sessionWorkspaceMenuCreateWorktree'))

    expect(createWorktree).toBeDefined()
    expect(createWorktree?.disabled).toBe(true)
    expect(createWorktree?.getAttribute('title')).toBe('chat.sessionWorkspaceDerivationDisabled.external_runtime')
    expect(container.textContent).toContain('chat.sessionWorkspaceDerivationDisabled.external_runtime')

    await renderDropdown(true)

    expect(createWorktree?.disabled).toBe(false)
    expect(container.textContent).not.toContain('chat.sessionWorkspaceDerivationDisabled.external_runtime')
  })
})
