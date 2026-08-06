// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PluginRuntimeInstance } from '@oneworks/types'

import { PluginOverview } from '#~/components/plugins/PluginDetailSections'

describe('plugin private path detail presentation', () => {
  it('renders safe runtime identity without exposing API-shaped installation paths', () => {
    const privateSentinel = 'detail-private-sentinel'
    const privatePath = ['', 'private', privateSentinel, 'managed', 'oneworks'].join('/')
    const plugin = {
      enabled: true,
      name: privatePath,
      pluginRoot: privatePath,
      requestId: privatePath,
      scope: 'airtable-runtime'
    } as unknown as PluginRuntimeInstance
    const markup = renderToStaticMarkup(
      <PluginOverview
        labels={{
          clientDevEntry: 'Client dev entry',
          clientEntry: 'Client entry',
          disabled: 'Disabled',
          overview: 'Overview',
          package: 'Package',
          request: 'Request',
          requestedVersion: 'Requested version',
          root: 'Root',
          serverEntry: 'Server entry',
          version: 'Version'
        }}
        plugin={plugin}
      />
    )

    expect(markup).toContain('airtable-runtime')
    expect(markup).not.toContain(privateSentinel)
  })
})
