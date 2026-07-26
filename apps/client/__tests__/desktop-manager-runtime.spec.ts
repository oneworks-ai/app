import { describe, expect, it } from 'vitest'

import { resolveClientRoutePathname } from '../src/desktop/manager-runtime'

describe('desktop manager runtime', () => {
  it('recognizes routes below the packaged client base', () => {
    expect(resolveClientRoutePathname('/ui/launcher', '/ui')).toBe('/launcher')
    expect(resolveClientRoutePathname('/ui/launcher/account', '/ui')).toBe('/launcher/account')
    expect(resolveClientRoutePathname('/ui/standalone', '/ui')).toBe('/standalone')
  })

  it('keeps root-base and unrelated paths stable', () => {
    expect(resolveClientRoutePathname('/launcher', '/')).toBe('/launcher')
    expect(resolveClientRoutePathname('/custom/launcher', '/ui')).toBe('/custom/launcher')
  })
})
