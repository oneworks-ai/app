import { describe, expect, it } from 'vitest'

import { comparePackageCacheVersions } from '../src/adapter-package-cache'

describe('adapter package cache public ownership', () => {
  it('orders stable cache versions without bootstrap-private imports', () => {
    expect(comparePackageCacheVersions('1.2.0', '1.1.9')).toBeGreaterThan(0)
  })
})
