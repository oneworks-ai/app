import { Buffer } from 'node:buffer'

import { describe, expect, it } from 'vitest'

import {
  createCredentialVariants,
  isCredentialBearingKey,
  isSafeEmbeddedCredentialValue,
  redactContextualCredentialAssignmentsInString,
  redactCredentialAssignmentsInString,
  redactCredentialVariantsInString
} from '../src/credential-redaction'
import { collectCredentialRedactionContext, collectCredentialValues } from '../src/credential-redaction-graph'

describe('credential redaction contract', () => {
  it.each([
    'apiKey',
    'api_key',
    'GITHUB_TOKEN',
    'GITLAB_ACCESS_TOKEN',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SHARED_CREDENTIALS_FILE',
    'AWS_WEB_IDENTITY_TOKEN_FILE',
    'CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE',
    'GOOGLE_APPLICATION_CREDENTIALS',
    'MYSQL_PWD',
    'PASSWORD_FILE',
    'PGPASSFILE',
    'PGPASSWORD',
    'PRIVATE_KEY',
    'Subscription-Key',
    'Authorization',
    'Proxy-Authorization',
    'Cookie',
    'Set-Cookie',
    'customCredentialValue',
    'x-api-key'
  ])('classifies %s as credential-bearing', (key) => {
    expect(isCredentialBearingKey(key)).toBe(true)
  })

  it.each([
    'tokenCount',
    'secretary',
    'credentialRevision',
    'authMethod',
    'authenticationType',
    'apiKeyEnv',
    'AWS_ACCESS_KEY_ID',
    'subscriptionCount',
    'credentialFileFormat',
    'CookiePolicy'
  ])('preserves noncredential metadata key %s', (key) => {
    expect(isCredentialBearingKey(key)).toBe(false)
  })

  it('collects credential containers across maps, sets, errors, and nested records', () => {
    const error = Object.assign(new Error('safe wrapper'), { privateKey: 'error-secret' })
    const values = collectCredentialValues({
      auth: { selectedType: 'openai', value: 'auth-secret' },
      connectionUrl: 'postgres://fixture-user:fixture-password@example.test/database',
      graph: new Map<string, unknown>([
        ['headers', new Map([['Authorization', 'Bearer header-secret']])],
        ['items', new Set([{ GITHUB_TOKEN: 'github-secret' }, error])]
      ]),
      tokenCount: 'preserve-count',
      secretary: 'preserve-secretary'
    })

    expect(values).toEqual(
      new Set([
        'auth-secret',
        'fixture-user',
        'fixture-password',
        'Bearer header-secret',
        'github-secret',
        'error-secret'
      ])
    )
  })

  it('collects every value from header containers while preserving opaque header names', () => {
    const sharedHeaders = {
      'Opaque-Route': 'opaque-header-secret-12345',
      'Subscription-Key': 'subscription-secret-12345',
      'X-Trace-Id': 'trace-value-12345'
    }
    const values = collectCredentialValues({
      ordinaryAliasVisitedFirst: sharedHeaders,
      mcpServers: {
        vendor: {
          headers: sharedHeaders,
          url: 'https://mcp.example.test'
        }
      }
    })

    expect(values).toEqual(
      new Set([
        'opaque-header-secret-12345',
        'subscription-secret-12345',
        'trace-value-12345'
      ])
    )
  })

  it('does not promote filesystem paths or complete credential assignments into global variants', () => {
    const path = '/workspace/node_modules/.bin:/usr/local/bin:/usr/bin'
    const assignment = 'FACTORY_API_KEY=a'
    const context = collectCredentialRedactionContext({ assignment, path })

    expect(context.values).not.toContain(path)
    expect(context.values).not.toContain(assignment)
    expect(redactCredentialAssignmentsInString(assignment)).toBe('FACTORY_API_KEY=[REDACTED]')
  })

  it('does not create globally replaceable variants for one-to-seven-byte secrets', () => {
    const shortSecrets = ['a', 'ab', 'abc', 'abcd', 'abcde', 'abcdef', 'abcdefg']
    expect(shortSecrets.every(secret => !isSafeEmbeddedCredentialValue(secret))).toBe(true)
    expect(createCredentialVariants([...shortSecrets, '', 'abcdefgh'])).toEqual(
      expect.arrayContaining(['abcdefgh', Buffer.from('abcdefgh').toString('base64')])
    )
    for (const secret of shortSecrets) {
      expect(createCredentialVariants(shortSecrets)).not.toContain(secret)
    }
  })

  it('redacts short opaque header assignments only in their exact textual context', () => {
    const source = {
      headers: {
        'X-Opaque': 'a',
        'X-Other': 'abcdefg'
      }
    }
    const context = collectCredentialRedactionContext(source)
    const ordinary = 'cwd=/tmp/a-project model=alpha-a-model secretary=present'
    const redacted = redactContextualCredentialAssignmentsInString(
      [
        ordinary,
        'X-Opaque=a',
        'x-opaque: a',
        '"X-Opaque":"a"',
        "'X-Other' = 'abcdefg'",
        'Unrelated=a'
      ].join('|'),
      context.textAssignments
    )

    expect(context.values).toEqual(new Set(['a', 'abcdefg']))
    expect(context.textAssignments).toEqual([
      { key: 'X-Opaque', value: 'a' },
      { key: 'X-Other', value: 'abcdefg' }
    ])
    expect(redacted).toContain(ordinary)
    expect(redacted).toContain('Unrelated=a')
    expect(redacted).not.toContain('X-Opaque=a')
    expect(redacted).not.toContain('x-opaque: a')
    expect(redacted).not.toContain('"X-Opaque":"a"')
    expect(redacted).not.toContain("'X-Other' = 'abcdefg'")
  })

  it('redacts raw, URI, form, base64, base64url, JSON, and assignment representations', () => {
    const secret = 'secret +/"value'
    const variants = createCredentialVariants([secret])
    const encoded = [
      secret,
      encodeURIComponent(secret),
      new URLSearchParams({ value: secret }).toString().slice('value='.length),
      Buffer.from(secret).toString('base64'),
      Buffer.from(secret).toString('base64url'),
      JSON.stringify(secret).slice(1, -1)
    ].join('|')
    const redacted = redactCredentialAssignmentsInString(
      redactCredentialVariantsInString(
        `${encoded}|GITHUB_TOKEN=unknown-canary|{"Authorization":"unknown-json-canary"}`,
        variants
      )
    )

    expect(redacted).not.toContain(secret)
    expect(redacted).not.toContain('unknown-canary')
    expect(redacted).not.toContain('unknown-json-canary')
    expect(redacted).toContain('[REDACTED]')
    expect(redactCredentialAssignmentsInString(redacted)).toBe(redacted)
  })

  it('redacts compact and file-locator assignments without matching benign metadata', () => {
    const redacted = redactCredentialAssignmentsInString([
      'PGPASSWORD=a',
      'MYSQL_PWD=abcdefg',
      'AWS_SHARED_CREDENTIALS_FILE=/private/aws-creds',
      'PASSWORD_FILE=/private/password',
      'Subscription-Key=vendor-secret',
      'tokenCount=17',
      'secretary=present'
    ].join('|'))

    expect(redacted).not.toContain('/private/aws-creds')
    expect(redacted).not.toContain('/private/password')
    expect(redacted).not.toContain('vendor-secret')
    expect(redacted).toContain('tokenCount=17')
    expect(redacted).toContain('secretary=present')
  })
})
