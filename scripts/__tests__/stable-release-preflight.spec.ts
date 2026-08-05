import { describe, expect, it } from 'vitest'

import { evaluateStablePackageGraph } from '../stable-release-preflight.mjs'

describe('stable release preflight', () => {
  const input = { version: '0.1.0', vscodeVersion: '0.1.4' }

  it('accepts a coordinated stable graph with the VS Code store exception', () => {
    expect(evaluateStablePackageGraph(input, [
      { name: 'oneworks-dev', version: '0.1.0', license: 'MIT' },
      { name: '@oneworks/core', version: '0.1.0', license: 'MIT' },
      { name: '@oneworks/vscode-extension', version: '0.1.4', license: 'MIT' },
      {
        name: '@oneworks/plugin-demo',
        version: '0.1.0',
        license: 'MIT',
        pluginVersion: '0.1.0'
      }
    ])).toEqual([])
  })

  it('rejects prerelease, license, and plugin identity drift', () => {
    const errors = evaluateStablePackageGraph(input, [
      { name: '@oneworks/core', version: '0.1.0-rc.7', license: undefined },
      {
        name: '@oneworks/plugin-demo',
        version: '0.1.0',
        license: 'MIT',
        pluginVersion: '0.1.0-rc.7'
      }
    ])

    expect(errors).toEqual([
      '@oneworks/core has version 0.1.0-rc.7; expected 0.1.0',
      '@oneworks/core must declare license MIT',
      '@oneworks/plugin-demo plugin.json version 0.1.0-rc.7 does not match 0.1.0'
    ])
  })
})
