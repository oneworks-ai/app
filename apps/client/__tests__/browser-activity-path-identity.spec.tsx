// @vitest-environment happy-dom
import { App } from 'antd'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BrowserActivityPanel } from '#~/components/browser-activity/BrowserActivityPanel'
import { createBrowserActivityRouteState } from '#~/components/browser-activity/browser-activity-route-state'

const mocks = vi.hoisted(() => ({
  getWorkspaceSelectorState: vi.fn(),
  listBrowserHistory: vi.fn()
}))

vi.mock('swr', () => ({ default: () => ({ data: undefined }) }))
vi.mock('react-i18next', () => {
  const i18n = { language: 'en', resolvedLanguage: 'en' }
  const t = (key: string) => key
  return { useTranslation: () => ({ i18n, t }) }
})
vi.mock('#~/api', () => ({ getSessionWorkspace: vi.fn(), listSessions: vi.fn() }))
vi.mock('#~/components/action-search-toolbar/ActionSearchToolbar', () => ({
  ActionSearchToolbar: ({ actions }: { actions: Array<{ key: string; onClick: () => void }> }) => (
    <div>{actions.map(action => <button key={action.key} onClick={action.onClick}>{action.key}</button>)}</div>
  )
}))
vi.mock('#~/components/workspace-scope-select/WorkspaceScopeSelect', () => ({
  WorkspaceProjectSelect: ({ options, onChange, value }: {
    onChange: (value: string | undefined) => void
    options: Array<{ label: string; value: string }>
    value?: string
  }) => (
    <select
      data-testid='project-select'
      value={value ?? ''}
      onChange={event => onChange(event.target.value || undefined)}
    >
      <option value=''>all</option>
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
  WorkspaceSessionSelect: () => null
}))

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('browser activity project path identity', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    Reflect.deleteProperty(window, 'oneworksDesktop')
    vi.clearAllMocks()
  })

  it('keeps adjacent project options distinct and filters records by exact bytes', async () => {
    const exactProject = '/tmp/project '
    const adjacentProject = '/tmp/project'
    mocks.getWorkspaceSelectorState.mockResolvedValue({
      recentProjects: [
        { description: exactProject, name: 'Exact project', workspaceFolder: exactProject },
        { description: adjacentProject, name: 'Adjacent project', workspaceFolder: adjacentProject }
      ],
      runningProjects: []
    })
    mocks.listBrowserHistory.mockResolvedValue([
      {
        firstVisitedAt: '2026-08-12T00:00:00.000Z',
        id: 'exact',
        lastVisitedAt: '2026-08-12T00:00:00.000Z',
        projectKey: exactProject,
        title: 'Exact record',
        url: 'https://exact.test/',
        visitCount: 1
      },
      {
        firstVisitedAt: '2026-08-12T00:00:00.000Z',
        id: 'adjacent',
        lastVisitedAt: '2026-08-12T00:00:00.000Z',
        projectKey: adjacentProject,
        title: 'Adjacent record',
        url: 'https://adjacent.test/',
        visitCount: 1
      }
    ])
    Object.defineProperty(window, 'oneworksDesktop', {
      configurable: true,
      value: {
        getWorkspaceSelectorState: mocks.getWorkspaceSelectorState,
        listBrowserHistory: mocks.listBrowserHistory
      }
    })

    await act(async () =>
      root.render(
        <App>
          <BrowserActivityPanel initialProjectKeys={[exactProject]} kind='history' />
        </App>
      )
    )
    await flush()
    const scopeButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'scope')
    await act(async () => scopeButton?.click())
    await flush()
    const allSessionsButton = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent?.includes('browserActivity.filters.allSessionStatuses'))
    await act(async () => allSessionsButton?.click())
    await flush()

    const values = Array.from(container.querySelectorAll<HTMLSelectElement>('select option')).map(option =>
      option.value
    )
    expect(values).toEqual(expect.arrayContaining([exactProject, adjacentProject]))
    expect(container.textContent).toContain('Exact record')
    expect(container.textContent).not.toContain('Adjacent record')
    expect(
      createBrowserActivityRouteState({ projectKeys: [exactProject, adjacentProject] }).browserActivity.projectKeys
    )
      .toEqual([exactProject, adjacentProject])
  })

  it('uses family-aware comparison for Windows project scopes without collapsing POSIX paths', () => {
    expect(
      createBrowserActivityRouteState({
        projectKeys: [
          String.raw`C:\Projects\App`,
          'c:/projects/app',
          String.raw`C:Projects\App`,
          String.raw`\\Server\Share\Project`,
          '//server/share/project',
          '/projects/app',
          '/Projects/App'
        ]
      }).browserActivity.projectKeys
    ).toEqual([
      String.raw`C:\Projects\App`,
      String.raw`C:Projects\App`,
      String.raw`\\Server\Share\Project`,
      '/projects/app',
      '/Projects/App'
    ])
  })

  it('keeps the running project authoritative over an equivalent recent spelling', async () => {
    mocks.getWorkspaceSelectorState.mockResolvedValue({
      recentProjects: [{
        description: 'stale recent project',
        name: 'Recent project',
        workspaceFolder: 'c:/projects/app'
      }],
      runningProjects: [{
        description: 'active running project',
        name: 'Running project',
        status: 'running',
        workspaceFolder: String.raw`C:\Projects\App`
      }]
    })
    mocks.listBrowserHistory.mockResolvedValue([])
    Object.defineProperty(window, 'oneworksDesktop', {
      configurable: true,
      value: {
        getWorkspaceSelectorState: mocks.getWorkspaceSelectorState,
        listBrowserHistory: mocks.listBrowserHistory
      }
    })

    await act(async () =>
      root.render(
        <App>
          <BrowserActivityPanel kind='history' />
        </App>
      )
    )
    await flush()
    const scopeButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'scope')
    await act(async () => scopeButton?.click())
    await flush()

    expect(container.querySelector('select')?.textContent).toContain('Running project')
    expect(container.querySelector('select')?.textContent).not.toContain('Recent project')
  })
})
