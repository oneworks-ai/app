// @vitest-environment happy-dom
import type { InputHTMLAttributes, ReactNode } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PluginContextValue } from '#~/plugins/plugin-context'
import type { PluginRuntimeInstance } from '#~/plugins/plugin-manifest'

import { PluginDetailPanel } from '../src/components/plugins/PluginDetailPanel'

const callbacks = vi.hoisted(() => ({
  contribution: vi.fn(),
  options: vi.fn()
}))

vi.mock('antd', () => ({
  Button: ({ children, ...props }: { children?: ReactNode }) => <button {...props}>{children}</button>,
  Collapse: ({ items }: { items?: Array<{ children: ReactNode; key: string; label: ReactNode }> }) => (
    <div>{items?.map(item => <section key={item.key}>{item.label}{item.children}</section>)}</div>
  ),
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Switch: (props: { 'aria-label'?: string; onChange?: (checked: boolean) => void }) => (
    <button data-plugin-switch aria-label={props['aria-label']} onClick={() => props.onChange?.(true)} />
  ),
  Tabs: ({ items }: { items?: Array<{ children: ReactNode; key: string }> }) => (
    <>{items?.filter(item => item.key === 'contributions').map(item => <div key={item.key}>{item.children}</div>)}</>
  ),
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('#~/components/plugins/use-plugin-assets', () => ({
  usePluginAssets: () => ({ groups: [], loading: false })
}))

vi.mock('#~/components/plugins/use-plugin-readme', () => ({
  usePluginReadme: () => ({ loading: false, readmes: [] })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en', resolvedLanguage: 'en' },
    t: (key: string) => ({
      'pluginDetail.fields.authentication': 'Authentication',
      'pluginDetail.fields.capabilities': 'Capabilities',
      'pluginDetail.fields.connectionRequirements': 'Connection requirements',
      'pluginDetail.fields.permissions': 'Permissions',
      'pluginDetail.nativeApps': 'Native apps'
    }[key] ?? key)
  })
}))

const plugin: PluginRuntimeInstance = {
  enabled: true,
  manifest: {
    native: {
      adapter: 'codex',
      apps: [{
        authentication: { scopes: ['profile'], type: 'oauth2' },
        capabilities: ['WorkspaceConfigurationManagement'],
        connectionRequirements: { required: true, type: 'oauth2' },
        id: 'connector-docs',
        name: 'Docs',
        permissions: ['repository:read']
      }]
    }
  },
  requestId: 'docs',
  scope: 'docs'
}

const snapshot = {
  extensionContributions: {},
  extensionPoints: [],
  instances: [],
  launcherProviders: [],
  pluginApis: [],
  routes: [],
  slots: {},
  views: []
} as unknown as PluginContextValue['snapshot']

describe('pluginDetailPanel native apps', () => {
  let container: HTMLDivElement | undefined
  let root: Root | undefined

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    container = undefined
    root = undefined
    callbacks.contribution.mockReset()
    callbacks.options.mockReset()
  })

  it('renders native declarations once without contribution toggles or callbacks', async () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(
        <MemoryRouter>
          <PluginDetailPanel
            onContributionPreferencesChange={callbacks.contribution}
            onOptionsChange={callbacks.options}
            plugin={plugin}
            snapshot={snapshot}
          />
        </MemoryRouter>
      )
    })

    const text = container.textContent ?? ''
    const occurrences = (value: string) => text.split(value).length - 1
    expect(occurrences('connector-docs')).toBe(1)
    expect(occurrences('Authentication')).toBe(1)
    expect(occurrences('Capabilities')).toBe(1)
    expect(occurrences('Connection requirements')).toBe(1)
    expect(occurrences('Permissions')).toBe(1)
    expect(occurrences('{"scopes":["profile"],"type":"oauth2"}')).toBe(1)
    expect(occurrences('WorkspaceConfigurationManagement')).toBe(1)
    expect(occurrences('{"required":true,"type":"oauth2"}')).toBe(1)
    expect(occurrences('repository:read')).toBe(1)
    expect(container.querySelectorAll('[data-plugin-switch]')).toHaveLength(0)
    expect(callbacks.contribution).not.toHaveBeenCalled()
    expect(callbacks.options).not.toHaveBeenCalled()
  })
})
