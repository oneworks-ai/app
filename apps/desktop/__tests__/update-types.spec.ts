import { describe, expect, it } from 'vitest'

import { resolveDefaultDesktopUpdateChannel, resolveDesktopUpdateChannelPolicy } from '../src/main/update-types'

describe('desktop update channel defaults', () => {
  it.each(
    [
      ['1.2.3', 'stable'],
      ['1.2.3-beta.9', 'beta'],
      ['1.2.3-beta.9.1', 'beta'],
      ['1.2.3-alpha.0', 'alpha'],
      ['1.2.3-rc.2', 'rc'],
      ['1.2.3-preview.1', 'stable'],
      ['not-a-version', 'stable']
    ] as const
  )('maps %s to %s', (version, expected) => {
    expect(resolveDefaultDesktopUpdateChannel(version)).toBe(expected)
  })

  it.each(
    [
      ['stable', false, 'latest'],
      ['beta', true, 'beta'],
      ['alpha', true, 'alpha'],
      ['rc', true, 'rc']
    ] as const
  )('configures %s without permitting automatic downgrade', (channel, allowPrerelease, providerChannel) => {
    expect(resolveDesktopUpdateChannelPolicy(channel)).toEqual({
      allowDowngrade: false,
      allowPrerelease,
      providerChannel
    })
  })
})
