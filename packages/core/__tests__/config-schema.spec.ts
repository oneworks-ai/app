import { describe, expect, it } from 'vitest'

import { adapterAccountConfigCommonSchema } from '../src/config-schema'

describe('adapter account config schema', () => {
  it('uses the shared credential revision domain and canonical form', () => {
    const uuid = '00000000-0000-0000-0000-00000000000A'
    expect(adapterAccountConfigCommonSchema.parse({
      credentialRevision: `0002:${uuid}`
    })).toEqual({
      credentialRevision: `2:${uuid.toLowerCase()}`
    })
    expect(
      adapterAccountConfigCommonSchema.safeParse({
        credentialRevision: `${Number.MAX_SAFE_INTEGER + 1}:${uuid}`
      }).success
    ).toBe(false)
  })
})
