import { describe, expect, it } from 'vitest'

import {
  isCredentialLikeNativeAppKey,
  isCredentialLikeNativeAppValue,
  isSafeNativeAppDeclarativeValue,
  isSafePublicPluginIdentity,
  redactPrivateRoots
} from '#~/index.js'

describe('private-root redaction', () => {
  it('redacts verified private paths through mixed repeated encodings and delimiters', () => {
    const value = [
      '`/data/private`',
      '"FILE:///custom/private"',
      'path:/data/private',
      'x:%2fdata%2fprivate',
      'bad=%E0%A4%A/data/private',
      'bad=%E0%A4%A%2fdata%2fprivate',
      '%2fdata%2fprivate',
      '%252Fdata%252Fprivate',
      '%25252fdata%25252fprivate',
      '%2525252Fdata%2525252Fprivate'
    ].join(' ')

    const result = redactPrivateRoots(value, ['/data', '/custom'])

    expect(result).toBe([
      '`[local path]`',
      '"[local path]"',
      'path:[local path]',
      'x:[local path]',
      'bad=[local path]',
      'bad=[local path]',
      '[local path]',
      '[local path]',
      '[local path]',
      '[local path]'
    ].join(' '))
  })

  it('preserves route and HTTP URL fields when a private root has the same prefix', () => {
    expect(redactPrivateRoots('/oauth/callback', ['/oauth'], '[local path]', { field: 'route' }))
      .toBe('/oauth/callback')
    expect(redactPrivateRoots('https://example.test/oauth/callback', ['/oauth']))
      .toBe('https://example.test/oauth/callback')
    expect(redactPrivateRoots('/database/kept', ['/data'])).toBe('/database/kept')
  })

  it('preserves complete valid HTTP URLs while redacting adjacent private paths', () => {
    const value = [
      'https://example.test:8443/data/private?next=/custom/private#fragment',
      'http://[::1]:8787/custom/private?encoded=%2Fdata%2Fprivate',
      'https://one.test/data,https://two.test/custom?next=/data/private',
      'https://three.test/path,/data/private',
      'https://four.test/path;%2Fcustom%2Fprivate',
      '/custom/private',
      'invalid=https://example.test:bad/data/private',
      'tail=/data/private'
    ].join(' ')

    expect(redactPrivateRoots(value, ['/data', '/custom'])).toBe([
      'https://example.test:8443/data/private?next=/custom/private#fragment',
      'http://[::1]:8787/custom/private?encoded=%2Fdata%2Fprivate',
      'https://one.test/data,https://two.test/custom?next=/data/private',
      'https://three.test/path,[local path]',
      'https://four.test/path;[local path]',
      '[local path]',
      'invalid=https://example.test:[local path]',
      'tail=[local path]'
    ].join(' '))
  })

  it('preserves balanced parentheses in valid URLs while redacting adjacent roots', () => {
    const value = [
      'https://example.test/oauth/(callback)?next=(safe)',
      'https://example.test/path_(kept),/data/private',
      'https://example.test/(nested(one))/custom/private',
      '/custom/private'
    ].join(' ')

    expect(redactPrivateRoots(value, ['/data', '/custom'])).toBe([
      'https://example.test/oauth/(callback)?next=(safe)',
      'https://example.test/path_(kept),[local path]',
      'https://example.test/(nested(one))/custom/private',
      '[local path]'
    ].join(' '))
  })

  it('preserves comma and semicolon delimiters inside parenthesized URL path segments', () => {
    const value = [
      'https://example.test/path(one,/data/private)',
      'https://example.test/path(two;/custom/private)',
      'https://example.test/path(three,/data/private),/custom/private'
    ].join(' ')

    expect(redactPrivateRoots(value, ['/data', '/custom'])).toBe([
      'https://example.test/path(one,/data/private)',
      'https://example.test/path(two;/custom/private)',
      'https://example.test/path(three,/data/private),[local path]'
    ].join(' '))
  })

  it('preserves valid URLs with unmatched parentheses instead of redacting URL path segments', () => {
    const value = [
      'https://example.test/path)/data/private',
      'https://example.test/path(foo/custom/private',
      'https://example.test/path),/data/private',
      '/custom/private'
    ].join(' ')

    expect(redactPrivateRoots(value, ['/data', '/custom'])).toBe([
      'https://example.test/path)/data/private',
      'https://example.test/path(foo/custom/private',
      'https://example.test/path),[local path]',
      '[local path]'
    ].join(' '))
  })

  it('redacts configured literal roots with delimiters without matching prefix cousins', () => {
    const roots = [
      '/custom/My Project',
      '/custom/Team(Alpha)',
      '/custom/A,B;C=D',
      '/custom/Quote"Name',
      '/custom/Line\nBreak'
    ]
    const validUrl = 'https://example.test:8443/custom/My%20Project?next=/custom/My%20Project#kept'
    const value = [
      '/custom/My Project/install',
      '(/custom/Team(Alpha)/install)',
      'path=/custom/A,B;C=D/install',
      `"/custom/Quote"Name/install"`,
      'line=/custom/Line\nBreak/install',
      '/custom/My Projector',
      `${validUrl},/custom/My Project/install`,
      `${validUrl};/custom/A,B;C=D`
    ].join('\n')

    expect(redactPrivateRoots(value, roots)).toBe([
      '[local path]',
      '([local path])',
      'path=[local path]',
      `"[local path]"`,
      'line=[local path]',
      '/custom/My Projector',
      `${validUrl},[local path]`,
      `${validUrl};[local path]`
    ].join('\n'))
  })
})

describe('native app declarative metadata', () => {
  it('normalizes credential keys through compact, case, separator, and encoded forms', () => {
    for (
      const key of [
        'clientsecretvalue',
        'CLIENTSECRETVALUE',
        'apiKeyValue',
        'oauth-client_secret.valueSuffix',
        '%2563lient%2553ecret%2556alue',
        'api%255Fkey%255Fvalue',
        'clientSecretValue%'
      ]
    ) {
      expect(isCredentialLikeNativeAppKey(key), key).toBe(true)
    }
    for (
      const key of [
        'client_id',
        'redirect_uri',
        'redirect%255Furi',
        'code_challenge',
        'login_hint',
        'response_type'
      ]
    ) {
      expect(isCredentialLikeNativeAppKey(key), key).toBe(false)
    }
  })

  it('rejects credential-like segmented values consistently', () => {
    const awsLike = 'AKIAIOSFODNN7EXAMPLE/segment'
    const opaqueSegmented = 'abcdefghijklmnopqrstuvwx.yz0123456789abcdefghijklmnop'

    expect(isCredentialLikeNativeAppValue(awsLike)).toBe(true)
    expect(isCredentialLikeNativeAppValue(opaqueSegmented)).toBe(true)
    expect(isSafeNativeAppDeclarativeValue(awsLike, 'permission')).toBe(false)
    expect(isSafeNativeAppDeclarativeValue(opaqueSegmented, 'scope')).toBe(false)
    expect(isSafeNativeAppDeclarativeValue('WorkspaceConfigurationManagement', 'capability')).toBe(true)
    expect(isSafeNativeAppDeclarativeValue('repository:read', 'permission')).toBe(true)
    expect(isSafeNativeAppDeclarativeValue('https://www.googleapis.com/auth/userinfo.email', 'scope')).toBe(true)
    expect(isSafePublicPluginIdentity(encodeURIComponent('Bearer attacker-token'))).toBe(false)
  })
})
