import { describe, expect, it } from 'vitest'

import { codexAdapterConfigSchema } from '#~/config-schema.js'

describe('codex adapter config schema', () => {
  it('accepts shared app-server and adapter network settings', () => {
    expect(codexAdapterConfigSchema.parse({
      appServer: { idleTimeoutMs: 0 },
      network: {
        httpProxy: 'http://127.0.0.1:7890',
        httpsProxy: 'http://127.0.0.1:7890',
        allProxy: 'http://127.0.0.1:7890',
        noProxy: ['internal.example.test'],
        caCertificate: '/tmp/company-ca.pem'
      }
    })).toMatchObject({
      appServer: { idleTimeoutMs: 0 },
      network: { noProxy: ['internal.example.test'] }
    })
  })

  it('rejects a negative app-server idle timeout', () => {
    expect(() => codexAdapterConfigSchema.parse({
      appServer: { idleTimeoutMs: -1 }
    })).toThrow()
  })
})
