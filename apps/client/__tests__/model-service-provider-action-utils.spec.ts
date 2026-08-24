import { describe, expect, it } from 'vitest'

import { buildServiceActionFingerprint } from '#~/components/config/modelServiceProviderActionUtils'

describe('model service provider action fingerprints', () => {
  it('changes with credentials without retaining raw secrets', () => {
    const first = buildServiceActionFingerprint('deepseek/work', 'global', {
      apiKey: 'secret-one',
      management: {
        apiKey: 'management-secret',
        headers: { Authorization: 'private-header' }
      },
      provider: 'deepseek'
    })
    const second = buildServiceActionFingerprint('deepseek/work', 'global', {
      apiKey: 'secret-two',
      provider: 'deepseek'
    })

    expect(first).not.toBe(second)
    expect(first).not.toContain('secret-one')
    expect(first).not.toContain('management-secret')
    expect(first).not.toContain('private-header')
  })
})
