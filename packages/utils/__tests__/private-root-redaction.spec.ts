import { describe, expect, it } from 'vitest'

import { isCredentialShapedNativeAppValue, isFilesystemShapedNativeAppValue } from '../src/native-app-metadata'
import { containsPrivateRoot, redactPrivateRoots } from '../src/private-root-redaction'

describe('private root redaction', () => {
  const privateRoot = '/private/workspace'

  it('redacts a known root from a repeatedly encoded HTTP query value', () => {
    const values = [
      'https://example.test/oauth?source=%252Fprivate%252Fworkspace',
      'https://example.test/oauth?source=%252Fprivate%252Fworkspace&next=safe',
      'https://example.test/oauth?source=%25252525252Fprivate%25252525252Fworkspace'
    ]

    for (const value of values) {
      expect(redactPrivateRoots(value, [privateRoot])).toBe('[local path]')
      expect(containsPrivateRoot(value, [privateRoot])).toBe(true)
    }
  })

  it('redacts a known root from an HTTP path without exposing the URL token', () => {
    const value = 'See https://example.test/private/workspace/plugin for details.'

    expect(redactPrivateRoots(value, [privateRoot])).toBe('See [local path] for details.')
  })

  it('preserves safe HTTP URLs and route-like query values', () => {
    const value = 'Open https://example.test/oauth?redirect=%2Foauth%2Fcallback to continue.'

    expect(redactPrivateRoots(value, [privateRoot])).toBe(value)
    expect(containsPrivateRoot(value, [privateRoot])).toBe(false)
  })

  it('classifies platform and encoded local paths without rejecting safe HTTP URLs', () => {
    for (
      const value of [
        '/private/unrelated',
        'file:///private/unrelated',
        String.raw`C:\Users\private\plugin`,
        String.raw`\\server\share\plugin`,
        '%25252525252Fprivate%25252525252Funrelated'
      ]
    ) {
      expect(isFilesystemShapedNativeAppValue(value)).toBe(true)
    }
    expect(isFilesystemShapedNativeAppValue('https://example.test/plugin/icon.svg')).toBe(false)
    expect(isFilesystemShapedNativeAppValue('icons/plugin.svg')).toBe(false)
  })

  it('classifies HTTP userinfo as credential-shaped while preserving ordinary URLs', () => {
    expect(isCredentialShapedNativeAppValue('https://alice:s3cret@example.test/path')).toBe(true)
    expect(isCredentialShapedNativeAppValue('https://example.test/path')).toBe(false)
  })
})
