import { Buffer } from 'node:buffer'
import { PassThrough } from 'node:stream'

import { describe, expect, it, vi } from 'vitest'

import { createKiroPersistenceBoundary, isKiroProcessOnlyCredentialEnvName } from '#~/kiro-persistence.js'

describe('kiro persistence boundary', () => {
  it.each([
    'KIRO_API_KEY',
    'KIRO_REFRESH_TOKEN',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN',
    'AWS_SECURITY_TOKEN',
    'AWS_BEARER_TOKEN_BEDROCK',
    'AWS_CONFIG_FILE',
    'AWS_SHARED_CREDENTIALS_FILE',
    'AWS_WEB_IDENTITY_TOKEN_FILE',
    'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI',
    'AWS_CONTAINER_CREDENTIALS_FULL_URI',
    'AWS_CONTAINER_AUTHORIZATION_TOKEN',
    'AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE'
  ])('classifies %s as process-only', (name) => {
    expect(isKiroProcessOnlyCredentialEnvName(name)).toBe(true)
  })

  it.each(['AWS_REGION', 'AWS_PROFILE', 'AWS_ROLE_ARN', 'KIRO_HOME'])('preserves non-secret setting %s', (name) => {
    expect(isKiroProcessOnlyCredentialEnvName(name)).toBe(false)
  })

  it('redacts raw, URL-encoded, base64, nested, short, and keyed credentials without treating empty values as secrets', () => {
    const secret = 'long secret/+?for-redaction'
    const shortSecret = 's7h0rt!'
    const boundary = createKiroPersistenceBoundary({
      KIRO_API_KEY: secret,
      KIRO_SHORT_TOKEN: shortSecret,
      KIRO_EMPTY_TOKEN: '',
      AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: '/v2/credentials/private',
      AWS_REGION: 'us-west-2'
    })
    const scrubbed = boundary.scrub({
      env: {
        KIRO_API_KEY: secret,
        AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: '/v2/credentials/private',
        AWS_REGION: 'us-west-2'
      },
      config: {
        exact: secret,
        header: `Bearer ${secret}`,
        url: `https://example.test/?token=${encodeURIComponent(secret)}`,
        base64: Buffer.from(secret).toString('base64'),
        urlBase64: Buffer.from(secret).toString('base64url'),
        nested: [{ short: `prefix-${shortSecret}-suffix` }],
        emptyControl: 'empty values must not redact unrelated content'
      }
    })

    expect(scrubbed).toEqual({
      env: { AWS_REGION: 'us-west-2' },
      config: {
        exact: '[redacted Kiro credential]',
        header: 'Bearer [redacted Kiro credential]',
        url: '[redacted Kiro credential]',
        base64: '[redacted Kiro credential]',
        urlBase64: '[redacted Kiro credential]',
        nested: [{ short: '[redacted Kiro credential]' }],
        emptyControl: 'empty values must not redact unrelated content'
      }
    })
    expect(JSON.stringify(scrubbed)).not.toContain(secret)
    expect(JSON.stringify(scrubbed)).not.toContain(shortSecret)
    expect(JSON.stringify(scrubbed)).not.toContain('/v2/credentials/private')
  })

  it('applies the same recursive redaction to structured log snapshots and errors', () => {
    const secret = 'logger secret/+?not-for-disk'
    const info = vi.fn()
    const error = vi.fn()
    const boundary = createKiroPersistenceBoundary({ KIRO_API_KEY: secret })
    const logger = boundary.wrapLogger({
      stream: new PassThrough(),
      info,
      warn: vi.fn(),
      debug: vi.fn(),
      error
    })

    const fullyEncoded = [...Buffer.from(secret, 'utf8')]
      .map(byte => `%${byte.toString(16).padStart(2, '0')}`)
      .join('')
    logger.info({ Authorization: `Bearer ${secret}`, nested: [encodeURIComponent(secret), fullyEncoded] })
    logger.error(new Error(`failed with ${Buffer.from(secret).toString('base64')} and ${fullyEncoded}`))

    expect(JSON.stringify(info.mock.calls)).not.toContain(secret)
    expect(JSON.stringify(info.mock.calls)).not.toContain(encodeURIComponent(secret))
    expect(JSON.stringify(info.mock.calls)).not.toContain(fullyEncoded)
    const loggedError = error.mock.calls[0]?.[0]
    expect(loggedError).toBeInstanceOf(Error)
    expect((loggedError as Error).message).toContain('[redacted Kiro credential]')
    expect((loggedError as Error).message).not.toContain(Buffer.from(secret).toString('base64'))
    expect((loggedError as Error).message).not.toContain(fullyEncoded)
  })

  it('redacts mixed-case, fully encoded, nested, and malformed percent-encoding equivalents', () => {
    const secret = 'Alpha/Zeta?Token=42'
    const fullyEncoded = [...Buffer.from(secret, 'utf8')]
      .map((byte, index) => {
        const hex = byte.toString(16).padStart(2, '0')
        return `%${index % 2 === 0 ? hex.toUpperCase() : hex.toLowerCase()}`
      })
      .join('')
    const nestedEncoded = encodeURIComponent(fullyEncoded)
    const malformedPrefix = `%QZ&token=${fullyEncoded}`
    const boundary = createKiroPersistenceBoundary({ KIRO_API_KEY: secret })

    const scrubbed = boundary.scrub({
      fullyEncoded,
      rawAndEncoded: `${secret}&encoded=${fullyEncoded}`,
      mixedUrl: `https://example.test/?token=${fullyEncoded}&safe=1`,
      nested: [{ form: `next=${nestedEncoded.replaceAll('%20', '+')}` }],
      malformedPrefix,
      ordinaryMalformedPercent: 'safe-%QZ-control'
    })

    expect(scrubbed).toEqual({
      fullyEncoded: '[redacted Kiro credential]',
      rawAndEncoded: '[redacted Kiro credential]',
      mixedUrl: '[redacted Kiro credential]',
      nested: [{ form: '[redacted Kiro credential]' }],
      malformedPrefix: '[redacted Kiro credential]',
      ordinaryMalformedPercent: 'safe-%QZ-control'
    })
    const serialized = JSON.stringify(scrubbed)
    expect(serialized).not.toContain(secret)
    expect(serialized).not.toContain(fullyEncoded)
    expect(serialized).not.toContain(nestedEncoded)
  })

  it('drops secret-bearing ordinary object and Map keys without overwriting legitimate keys', () => {
    const secret = 'property-name-secret/+?42'
    const shortSecret = 'tiny!'
    const encoded = encodeURIComponent(secret)
    const fullyEncoded = [...Buffer.from(secret, 'utf8')]
      .map(byte => `%${byte.toString(16).padStart(2, '0')}`)
      .join('')
    const base64 = Buffer.from(secret).toString('base64')
    const boundary = createKiroPersistenceBoundary({
      KIRO_API_KEY: secret,
      KIRO_SHORT_TOKEN: shortSecret,
      KIRO_EMPTY_TOKEN: ''
    })
    const inputMap = new Map<unknown, unknown>([
      ['safe-map-key', { retained: true }],
      [`Authorization-${secret}`, 'must-drop'],
      [encoded, 'must-drop'],
      [base64, 'must-drop']
    ])
    const input = {
      safe: 'retained',
      '[redacted Kiro credential]': 'legitimate-key-is-not-overwritten',
      [`header-${secret}`]: 'must-drop',
      [`encoded-${encoded}`]: 'must-drop',
      [`fully-${fullyEncoded}`]: 'must-drop',
      [`base64-${base64}`]: 'must-drop',
      [`short-${shortSecret}`]: 'must-drop',
      'empty-token-control': 'retained',
      nested: [{ [`query-${fullyEncoded}`]: 'must-drop', safeNested: true }],
      inputMap
    }

    const first = boundary.scrub(input)
    const second = boundary.scrub(input)

    expect(first).toEqual(expect.objectContaining({
      safe: 'retained',
      '[redacted Kiro credential]': 'legitimate-key-is-not-overwritten',
      'empty-token-control': 'retained',
      nested: [{ safeNested: true }]
    }))
    expect([...first.inputMap.entries()]).toEqual([['safe-map-key', { retained: true }]])
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    const serialized = JSON.stringify(first)
    for (const material of [secret, shortSecret, encoded, fullyEncoded, base64]) {
      expect(serialized).not.toContain(material)
    }
  })
})
