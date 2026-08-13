import { describe, expect, it } from 'vitest'

import { createQwenRuntimeRedactor } from '#~/runtime/redaction.js'

describe('qwen runtime credential redaction', () => {
  it('redacts header containers and short credential leaves without corrupting ordinary strings', () => {
    const shortSecrets = Object.fromEntries(
      Array.from({ length: 7 }, (_, index) => [
        `Opaque-${index + 1}`,
        'abcdefg'.slice(0, index + 1)
      ])
    )
    const source = {
      mcpServers: {
        vendor: {
          headers: {
            ...shortSecrets,
            'Opaque-Long': 'opaque-header-secret-12345'
          }
        }
      }
    }
    const redactor = createQwenRuntimeRedactor({
      additionalValues: [source],
      env: {
        MYSQL_PWD: 'abcdefg',
        PGPASSWORD: 'a'
      }
    })
    const ordinary = 'cwd=/tmp/a-project model=alpha tokenCount=17 secretary=present'
    const redactedString = redactor.string(
      `${ordinary} Subscription-Key=abcdefg opaque-header-secret-12345 ` +
        'Opaque-1=a | Opaque-1: a | {"Opaque-1":"a"} | Unrelated=a'
    )
    const redactedGraph = redactor.unknown(source) as typeof source

    expect(redactedString).toContain(ordinary)
    expect(redactedString).not.toContain('opaque-header-secret-12345')
    expect(redactedString).not.toContain('Subscription-Key=abcdefg')
    expect(redactedString).not.toContain('Opaque-1=a')
    expect(redactedString).not.toContain('Opaque-1: a')
    expect(redactedString).not.toContain('"Opaque-1":"a"')
    expect(redactedString).toContain('Unrelated=a')
    expect(Object.values(redactedGraph.mcpServers.vendor.headers)).toEqual(
      Array.from({ length: 8 }, () => '[REDACTED]')
    )
    expect(source.mcpServers.vendor.headers).toEqual({
      ...shortSecrets,
      'Opaque-Long': 'opaque-header-secret-12345'
    })
  })
})
