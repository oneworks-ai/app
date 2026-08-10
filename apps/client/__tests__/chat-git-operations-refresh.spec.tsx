// @vitest-environment happy-dom

import { act } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { GitRepositoryState } from '@oneworks/types'

import { GitOperationsDropdown } from '#~/components/chat/git-controls/GitOperationsDropdown'

vi.mock('antd', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  return {
    Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) =>
      React.createElement('button', props, children),
    Dropdown: ({
      children,
      open,
      popupRender
    }: {
      children?: ReactNode
      open?: boolean
      popupRender?: () => ReactNode
    }) => React.createElement(React.Fragment, null, children, open === true ? popupRender?.() : null)
  }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'chat.gitCommitShort': 'Commit',
        'chat.gitOperations': 'Git actions',
        'chat.gitPushShort': 'Push',
        'chat.gitRefreshStatus': 'Refresh Git status',
        'chat.gitSyncShort': 'Sync'
      })[key] ?? key
  })
}))

vi.mock(
  '#~/components/chat/sender/@components/mobile-select-drawer/SenderMobileSelectDrawer',
  async () => {
    const React = await vi.importActual<typeof import('react')>('react')
    return {
      SenderMobileSelectDrawer: ({ children, open }: { children?: ReactNode; open?: boolean }) =>
        React.createElement('div', { 'data-compact-drawer': true }, open === true ? children : null)
    }
  }
)

const repoState: GitRepositoryState = {
  available: true,
  cwd: '/workspace',
  repositoryRoot: '/workspace',
  currentBranch: 'main',
  hasChanges: false,
  remotes: ['origin']
}

describe.each([
  { compact: false, surface: true, surfaceName: 'desktop dropdown' },
  { compact: true, surface: false, surfaceName: 'compact drawer' }
])('git operations refresh accessibility in $surfaceName', ({ compact, surface }) => {
  let container: HTMLDivElement
  let root: Root

  const renderControl = async (isRefreshing: boolean, onRefresh = vi.fn()) => {
    await act(async () => {
      root.render(
        <GitOperationsDropdown
          compact={compact}
          isBusy={false}
          isRefreshing={isRefreshing}
          open
          repoState={repoState}
          surface={surface}
          onOpenChange={vi.fn()}
          onOpenCommit={vi.fn()}
          onPush={vi.fn()}
          onRefresh={onRefresh}
          onSync={vi.fn()}
        />
      )
    })
    const refreshButton = container.querySelector<HTMLButtonElement>('button[aria-label="Refresh Git status"]')
    if (refreshButton == null) {
      throw new Error('Refresh Git status button was not rendered')
    }
    return refreshButton
  }

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

  it('exposes a real named button and hides decorative icon text from AT', async () => {
    const onRefresh = vi.fn()
    const refreshButton = await renderControl(false, onRefresh)

    expect(refreshButton.tagName).toBe('BUTTON')
    expect(refreshButton.getAttribute('aria-label')).toBe('Refresh Git status')
    expect(refreshButton.querySelector('.material-symbols-rounded')?.getAttribute('aria-hidden')).toBe('true')

    await act(async () => refreshButton.click())
    expect(onRefresh).toHaveBeenCalledOnce()
  })

  it('disables the real refresh button for an in-flight refresh', async () => {
    const refreshButton = await renderControl(true)

    expect(refreshButton.disabled).toBe(true)
  })
})
