import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { WorktreeEnvironmentSummary } from '@oneworks/types'

import {
  WorktreeEnvironmentListView,
  filterWorktreeEnvironments
} from '#~/components/config/WorktreeEnvironmentListView'
import type { TranslationFn } from '#~/components/config/configUtils'

vi.hoisted(() => {
  vi.stubGlobal('localStorage', {
    getItem: vi.fn(() => null),
    removeItem: vi.fn(),
    setItem: vi.fn()
  })
})

const t = ((key: string) => ({
  'common.cancel': 'Cancel',
  'config.environments.create': 'New',
  'config.environments.empty': 'No worktree environments',
  'config.environments.import.dialogTitle': 'Import environments',
  'config.environments.searchEmpty': 'No matching worktree environments',
  'config.environments.searchPlaceholder': 'Search environments'
}[key] ?? key)) as TranslationFn

const environment = (id: string, path: string): WorktreeEnvironmentSummary => ({
  id,
  isLocal: false,
  path,
  scripts: [],
  source: 'project'
})

describe('worktree environment list', () => {
  it('uses config list primitives without rendering a duplicate page header', () => {
    const environments = [
      environment('node-20', '/workspace/.oo/env/node-20'),
      environment('python', '/workspace/.oo/env/python')
    ]
    const html = renderToStaticMarkup(
      <WorktreeEnvironmentListView
        isLoading={false}
        visibleEnvironments={environments}
        onCreate={() => undefined}
        onSelectEnvironment={() => undefined}
        t={t}
      />
    )

    expect(html).not.toContain('worktree-env-panel__topbar')
    expect(html).not.toContain('config-view__section-title')
    expect(html).toContain('oneworks-list-search')
    expect(html).toContain('config-view__record-list')
    expect(filterWorktreeEnvironments(environments, 'python').map(item => item.id)).toEqual(['python'])
    expect(filterWorktreeEnvironments(environments, 'node-20').map(item => item.id)).toEqual(['node-20'])
  })

  it('places the adapter import trigger before create and removes the persistent import row', () => {
    const html = renderToStaticMarkup(
      <WorktreeEnvironmentListView
        disabled
        isLoading={false}
        importAction={{
          actionLabel: 'Import environments from Codex',
          adapters: [{
            adapterKey: 'codex',
            runtimeAdapter: 'codex',
            title: 'Codex environments'
          }],
          buttonLabel: 'Import',
          emptyLabel: 'No adapters',
          mobileTitle: 'Select importer',
          onAdapterChange: () => undefined,
          onClick: () => undefined,
          placeholder: 'Select adapter',
          selectedAdapterKey: 'codex',
          selectDisabled: true,
          selectLabel: 'Environment import adapter'
        }}
        visibleEnvironments={[]}
        onCreate={() => undefined}
        onSelectEnvironment={() => undefined}
        t={t}
      />
    )

    expect(html).not.toContain('config-view__adapter-import-row')
    expect(html.indexOf('aria-label="Import environments from Codex"')).toBeLessThan(
      html.indexOf('aria-label="New"')
    )
    expect(html).toContain('aria-label="New"')
    expect(html).toContain('aria-label="Import environments from Codex"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).toContain('file_download')
    expect(html).toContain('add')
    expect(html).toContain('disabled=""')
  })
})
