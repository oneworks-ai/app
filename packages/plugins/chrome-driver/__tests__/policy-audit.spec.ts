import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { ChromeExtensionBridge } from '../server/src/bridge.js'

describe('chrome bridge policy audit', () => {
  it('audits an advanced-access preference change made while disconnected', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-chrome-policy-audit-test-'))
    const bridge = new ChromeExtensionBridge({
      logger: { error() {}, info() {}, warn() {} },
      projectHome: join(root, 'project'),
      workspaceFolder: root
    })
    await bridge.start()
    try {
      await bridge.setConfiguredAdvancedAccess('cookie_values', true)
      expect(bridge.status().recent_audit).toMatchObject([
        {
          op: 'settings.advanced_access',
          outcome: 'succeeded',
          summary: 'advanced access preference changed (key=cookie_values, enabled=true)'
        }
      ])
      expect(bridge.status().recent_audit[0]).not.toHaveProperty('connection_id')
    } finally {
      await bridge.dispose()
      await rm(root, { force: true, recursive: true })
    }
  })
})
