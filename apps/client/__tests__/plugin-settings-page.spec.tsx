import { App } from 'antd'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import '#~/i18n'

const refreshPlugins = vi.fn(async () => undefined)

vi.mock('#~/plugins/api', () => ({
  setPluginOptions: vi.fn(async (_scope, options) => options)
}))

vi.mock('#~/plugins/plugin-context', () => ({
  usePluginContext: () => ({
    pluginServerBaseUrl: 'http://127.0.0.1:8798',
    refreshPlugins,
    snapshot: {
      instances: [{
        options: { enabled: true },
        requestId: 'demo',
        scope: 'demo'
      }]
    }
  })
}))

vi.mock('#~/plugins/PluginHost', () => ({
  PluginViewHost: ({ scope, surface, viewId }: { scope: string; surface: string; viewId: string }) => (
    <div data-scope={scope} data-surface={surface} data-view-id={viewId} />
  )
}))

const { PluginSettingsPage } = await import('#~/components/plugins/PluginSettingsPage')

describe('plugin settings page host', () => {
  it('mounts plugin-owned views on the settings surface', () => {
    const html = renderToStaticMarkup(
      <App>
        <PluginSettingsPage
          page={{
            clientView: 'control',
            id: 'browser',
            pluginScope: 'demo',
            title: 'External Browser'
          }}
        />
      </App>
    )

    expect(html).toContain('data-surface="settings"')
    expect(html).toContain('data-view-id="control"')
    expect(html).toContain('data-scope="demo"')
  })

  it('renders a contributed schema with native settings fields', () => {
    const html = renderToStaticMarkup(
      <App>
        <PluginSettingsPage
          page={{
            id: 'preferences',
            pluginScope: 'demo',
            schema: {
              properties: {
                enabled: {
                  description: 'Allow the feature',
                  title: 'Enabled',
                  type: 'boolean'
                }
              },
              type: 'object'
            },
            title: 'Preferences'
          }}
        />
      </App>
    )

    expect(html).toContain('config-view__field-row')
    expect(html).toContain('Enabled')
    expect(html).toContain('Allow the feature')
    expect(html).toContain('ant-switch')
  })
})
