import { afterEach, describe, expect, it, vi } from 'vitest'

import { shouldResolveCliAdapterPackage } from '../src/package-launcher'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('bootstrap package launcher', () => {
  it('resolves adapter packages when the loader only defaulted CLI package dir to bootstrap itself', () => {
    vi.stubEnv('__ONEWORKS_PROJECT_PACKAGE_DIR__', '/runtime/bootstrap')
    vi.stubEnv('__ONEWORKS_PROJECT_CLI_PACKAGE_DIR__', '/runtime/bootstrap')

    expect(shouldResolveCliAdapterPackage()).toBe(true)
  })

  it('preserves an explicit external CLI package dir', () => {
    vi.stubEnv('__ONEWORKS_PROJECT_PACKAGE_DIR__', '/runtime/bootstrap')
    vi.stubEnv('__ONEWORKS_PROJECT_CLI_PACKAGE_DIR__', '/runtime/adapter-cache')

    expect(shouldResolveCliAdapterPackage()).toBe(false)
  })
})
