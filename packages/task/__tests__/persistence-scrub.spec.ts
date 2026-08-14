import { describe, expect, it } from 'vitest'

import { scrubCredentialGraphForPersistence } from '#~/persistence-scrub.js'

describe('task persistence credential scrub', () => {
  it('scrubs shared objects independently for ordinary and header-container contexts', () => {
    const sharedHeaders = {
      'Opaque-Long': 'opaque-header-secret-12345',
      'X-Opaque': 'a'
    }
    const source = {
      embeddedLong: 'prefix:opaque-header-secret-12345:suffix',
      exactShortAssignments: 'X-Opaque=a | X-Opaque: a | {"X-Opaque":"a"}',
      mcpServer: { headers: sharedHeaders, url: 'https://mcp.example.test' },
      model: 'alpha-a-model',
      ordinaryAliasVisitedFirst: sharedHeaders
    }

    const persisted = scrubCredentialGraphForPersistence(source)

    expect(persisted).toEqual({
      embeddedLong: 'prefix:[REDACTED]:suffix',
      exactShortAssignments: 'X-Opaque=[REDACTED] | X-Opaque: [REDACTED] | {"X-Opaque":"[REDACTED]"}',
      mcpServer: {
        headers: {
          'Opaque-Long': '[REDACTED]',
          'X-Opaque': '[REDACTED]'
        },
        url: 'https://mcp.example.test'
      },
      model: 'alpha-a-model',
      ordinaryAliasVisitedFirst: {
        'Opaque-Long': '[REDACTED]',
        'X-Opaque': 'a'
      }
    })
    expect(source.mcpServer.headers).toBe(source.ordinaryAliasVisitedFirst)
    expect(source.mcpServer.headers).toEqual({
      'Opaque-Long': 'opaque-header-secret-12345',
      'X-Opaque': 'a'
    })
  })
})
