import { Buffer } from 'node:buffer'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { sanitizeTaskBaseForPersistence } from '#~/task-cache-persistence.js'
import type { AdapterCtx } from '@oneworks/types'
import { setCache } from '@oneworks/utils/cache'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('task base cache persistence', () => {
  it('writes no Factory runtime or configContent credentials to base.json', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-task-cache-security-'))
    tempDirs.push(root)
    const apiKey = 'factory-api-persistence-secret'
    const token = 'factory-token-persistence-secret'
    const config = {
      adapters: {
        codex: {},
        droid: {
          configContent: {
            apiKey,
            endpoint: `https://factory.test/session?token=${encodeURIComponent(token)}`,
            general: { theme: 'dark' }
          }
        },
        factoryAlias: {
          packageId: '@oneworks/adapter-droid',
          configContent: {
            credentials: { value: 'nested-secret' },
            encoded: Buffer.from(apiKey).toString('base64'),
            safe: true
          }
        }
      }
    } as NonNullable<AdapterCtx['configs'][0]>
    const base = {
      ctxId: 'task-security',
      cwd: root,
      env: {
        FACTORY_API_KEY: apiKey,
        Factory_Token: token,
        SAFE_CANARY: 'preserved'
      },
      configs: [config, undefined],
      assets: {
        cwd: root,
        nestedRuntimeDiagnostic: `never persist ${apiKey}`
      } as unknown as AdapterCtx['assets'],
      configState: {
        effectiveProjectConfig: config,
        projectConfig: config,
        userConfig: undefined,
        mergedConfig: config
      }
    } as Parameters<typeof sanitizeTaskBaseForPersistence>[0]
    const snapshot = structuredClone(base)
    const sanitized = sanitizeTaskBaseForPersistence(base)

    const { cachePath } = await setCache(root, 'task-security', 'session-security', 'base', sanitized)
    const persisted = await readFile(cachePath, 'utf8')

    for (
      const secret of [
        apiKey,
        token,
        encodeURIComponent(token),
        Buffer.from(apiKey).toString('base64'),
        'nested-secret'
      ]
    ) expect(persisted).not.toContain(secret)
    expect(persisted).not.toMatch(/factory_(?:api_key|token)/iu)
    expect(persisted).toContain('"SAFE_CANARY": "preserved"')
    expect(persisted).toContain('"theme": "dark"')
    expect(persisted).toContain('"safe": true')
    expect(base).toEqual(snapshot)
  })

  it('collects config-only secrets before removing credential fields across every config graph', () => {
    const configSecret = 'factory-config-only-secret'
    const aliasSecret = 'factory-alias-only-secret'
    const makeConfig = () => ({
      adapters: {
        droid: {
          configContent: {
            apiKey: configSecret,
            safe: 'unchanged'
          }
        },
        droidAlias: {
          packageId: '@oneworks/adapter-droid',
          configContent: {
            credentials: { token: aliasSecret },
            safeAlias: true
          }
        },
        codex: {
          configContent: { ordinary: 'preserved' }
        }
      },
      extend: {
        adapters: {
          droid: {
            configContent: {
              token: configSecret,
              mirror: configSecret
            }
          }
        }
      }
    })
    const projectConfig = makeConfig()
    const base = {
      ctxId: 'config-only',
      cwd: '/workspace',
      env: { SAFE_CANARY: 'preserved' },
      configs: [projectConfig, undefined],
      assets: {
        exactEcho: configSecret,
        contextualEcho: `Authorization: Bearer ${aliasSecret}`,
        nested: { [configSecret]: 'dynamic-key-value' },
        ordinaryStructuralWord: 'value'
      },
      configState: {
        effectiveProjectConfig: makeConfig(),
        projectConfig: makeConfig(),
        userConfig: makeConfig(),
        mergedConfig: makeConfig(),
        source: {
          configContent: {
            password: aliasSecret,
            duplicate: aliasSecret
          }
        }
      }
    } as unknown as Parameters<typeof sanitizeTaskBaseForPersistence>[0]

    const sanitized = sanitizeTaskBaseForPersistence(base)
    const persisted = JSON.stringify(sanitized)

    expect(persisted).not.toContain(configSecret)
    expect(persisted).not.toContain(aliasSecret)
    expect(persisted).not.toContain('"apiKey"')
    expect(persisted).not.toContain('"credentials"')
    expect(persisted).not.toContain('"password"')
    expect(persisted).toContain('"safe":"unchanged"')
    expect(persisted).toContain('"safeAlias":true')
    expect(persisted).toContain('"ordinary":"preserved"')
    expect(persisted).toContain('"__ONEWORKS_REDACTED_CREDENTIAL_KEY__":"dynamic-key-value"')
    expect(persisted).toContain('"ordinaryStructuralWord":"value"')
  })

  it('redacts short secrets only as exact values, keys, or credential assignments', () => {
    const base = {
      ctxId: 'short-secret',
      cwd: '/workspace',
      env: { FACTORY_API_KEY: 'a' },
      configs: [{
        adapters: {
          droid: {
            configContent: {
              apiKey: 'a',
              exactSibling: 'a',
              assignment: 'FACTORY_API_KEY=a',
              jsonAssignment: '"apiKey":"a"',
              queryAssignment: 'https://factory.test?token=a',
              ordinaryPath: '/workspace',
              ordinaryWords: ['alpha', 'data'],
              object: {
                a: 'dynamic-key',
                __ONEWORKS_REDACTED_CREDENTIAL_KEY__: 'unrelated-reserved-key',
                stable: 'a-value-is-not-an-exact-secret'
              }
            }
          }
        }
      }, undefined]
    } as unknown as Parameters<typeof sanitizeTaskBaseForPersistence>[0]

    const sanitized = sanitizeTaskBaseForPersistence(base)
    const configContent = (sanitized.configs[0]?.adapters?.droid as { configContent: Record<string, unknown> })
      .configContent

    expect(configContent).toMatchObject({
      exactSibling: '[REDACTED]',
      assignment: 'FACTORY_API_KEY=[REDACTED]',
      jsonAssignment: '"apiKey":"[REDACTED]"',
      queryAssignment: 'https://factory.test?token=[REDACTED]',
      ordinaryPath: '/workspace',
      ordinaryWords: ['alpha', 'data'],
      object: {
        __ONEWORKS_REDACTED_CREDENTIAL_KEY__: 'unrelated-reserved-key',
        __ONEWORKS_REDACTED_CREDENTIAL_KEY___2: 'dynamic-key',
        stable: 'a-value-is-not-an-exact-secret'
      }
    })
    expect(configContent).not.toHaveProperty('apiKey')
  })

  it('redacts complete quoted and delimited short credentials without truncating their values', () => {
    const secrets = {
      spaced: 'a b',
      comma: 'a,b',
      semicolon: 'a;b',
      pipe: 'a|b',
      parentheses: 'a(b)',
      quoted: 'a"b'
    }
    const base = {
      ctxId: 'delimited-short-secret',
      cwd: '/workspace',
      env: {},
      configs: [{
        adapters: {
          droid: {
            configContent: {
              credentials: secrets,
              echoes: {
                spacedQuoted: `FACTORY_API_KEY="${secrets.spaced}"`,
                spacedRaw: `FACTORY_API_KEY=${secrets.spaced}`,
                truncatedQuoted: `FACTORY_API_KEY="${secrets.spaced}`,
                comma: `"apiKey":"${secrets.comma}"`,
                semicolon: `token=${secrets.semicolon}; next=true`,
                pipe: `Authorization: Bearer ${secrets.pipe} | next`,
                parentheses: `password=${secrets.parentheses})`,
                escapedQuote: JSON.stringify({ apiKey: secrets.quoted }),
                encoded: `https://factory.test?token=${encodeURIComponent(secrets.spaced)}&next=true`,
                base64: `token=${Buffer.from(secrets.comma).toString('base64')}`,
                base64url: `token=${Buffer.from(secrets.semicolon).toString('base64url')}`,
                ordinary: [
                  '/workspace/a b/data',
                  'alpha,beta',
                  'formula=a(b)+c',
                  'pipe a|b remains ordinary',
                  'FACTORY_API_KEY=alpha',
                  '"apiKey":"a beta"'
                ]
              }
            }
          }
        }
      }, undefined]
    } as unknown as Parameters<typeof sanitizeTaskBaseForPersistence>[0]

    const sanitized = sanitizeTaskBaseForPersistence(base)
    const persisted = JSON.stringify(sanitized)
    const configContent = (sanitized.configs[0]?.adapters?.droid as {
      configContent: { echoes: Record<string, unknown> }
    }).configContent

    expect(configContent).not.toHaveProperty('credentials')
    expect(configContent.echoes).toMatchObject({
      spacedQuoted: 'FACTORY_API_KEY="[REDACTED]"',
      spacedRaw: 'FACTORY_API_KEY=[REDACTED]',
      truncatedQuoted: 'FACTORY_API_KEY="[REDACTED]',
      comma: '"apiKey":"[REDACTED]"',
      semicolon: 'token=[REDACTED]; next=true',
      pipe: 'Authorization: Bearer [REDACTED] | next',
      parentheses: 'password=[REDACTED])',
      escapedQuote: '{"apiKey":"[REDACTED]"}',
      encoded: 'https://factory.test?token=[REDACTED]&next=true',
      base64: 'token=[REDACTED]',
      base64url: 'token=[REDACTED]'
    })
    expect(persisted).toContain('FACTORY_API_KEY=alpha')
    expect(persisted).toContain('/workspace/a b/data')
    expect(persisted).toContain('alpha,beta')
    expect(persisted).toContain('formula=a(b)+c')
    expect(persisted).toContain('pipe a|b remains ordinary')
    expect(configContent.echoes.ordinary).toEqual(expect.arrayContaining(['"apiKey":"a beta"']))
    expect(persisted.match(/\[REDACTED\]/gu)).toHaveLength(11)
  })

  it('strictly decodes encoded credential candidates without broadening ordinary matches', () => {
    const secrets = {
      space: 'a b',
      singleOctet: 'a,b',
      multipleOctets: 'a,/:b',
      doubleQuote: 'a"b',
      doubleQuoteWithBackslash: 'a\\"b',
      parentheses: 'a(b)',
      pipe: 'a|b',
      semicolon: 'a;b',
      singleQuote: "a'b",
      trailingBackslash: 'a\\',
      unknownEscape: 'a\\qb',
      unicode: 'a 中,b'
    }
    const base = {
      ctxId: 'percent-escape-case',
      cwd: '/workspace',
      env: {},
      configs: [{
        adapters: {
          droid: {
            configContent: {
              credentials: secrets,
              echoes: {
                exactLowercase: 'a%2cb',
                queryLowercase: 'https://factory.test?token=a%2cb&next=true',
                queryPlus: 'https://factory.test?token=a+b&next=true',
                queryPartialComma: 'https://factory.test?token=%61,b&next=true',
                quotedMixed: '"apiKey":"a%2c%2F%3ab"',
                quotedFullyEncoded: '"apiKey":"%61%2c%62"',
                quotedPartialPipe: '"apiKey":"%61|b"',
                quotedDoubleEscape: JSON.stringify({ token: 'a"b' }).replace('a', '%61'),
                quotedOddBackslashes: JSON.stringify({ token: 'a\\"b' }).replace('a', '%61'),
                quotedEvenBackslashes: JSON.stringify({ token: 'a\\' }).replace('a', '%61'),
                quotedSingleEscape: "token='%61\\'b'",
                quotedFullQuoteEncoding: '"token":"%61%22%62"',
                headerFullyEncoded: 'Authorization: Bearer %61%2c%62',
                headerPartialPipe: 'Authorization: Bearer %61|b | next',
                formLowercase: 'FACTORY_TOKEN=a%2c%2f%3ab&next=true',
                formPlus: 'FACTORY_API_KEY=a+b&next=true',
                formPartialSemicolon: 'FACTORY_TOKEN=%61;b&next=true',
                mixedUnicode: 'token=%61%20%e4%B8%aD%2c%62',
                unquotedPartialParentheses: 'password=%61(b))',
                unquotedPartialSemicolon: 'token=%61;b; next=true',
                repeated: 'token=a%2Cb; password=a%2cb',
                ordinaryLookalikes: [
                  '/docs/a%2cb-suffix',
                  'token=a%2cbeta',
                  'token=%61%2c%62%78',
                  'token=%78%61%2c%62',
                  'token=%61%2g%62',
                  'https://factory.test?token=%61,bx&next=true',
                  'token=%61,beta',
                  '"apiKey":"%61|bx"',
                  '"token":"%61\\"bx"',
                  "token='%61\\'bx'",
                  'token="%61\\qb"',
                  'token="%61\\',
                  "token='%61\\",
                  'password=%61(b)x)',
                  'Authorization: Bearer a+b',
                  '"token":"a+b"',
                  'ordinary a%2cb text',
                  'ordinary %61%2c%62 text',
                  'https://factory.test?tokenish=%61%2c%62',
                  'token=a%2gb',
                  'token=A%2cb'
                ]
              }
            }
          }
        }
      }, undefined]
    } as unknown as Parameters<typeof sanitizeTaskBaseForPersistence>[0]

    const sanitized = sanitizeTaskBaseForPersistence(base)
    const configContent = (sanitized.configs[0]?.adapters?.droid as {
      configContent: { echoes: Record<string, unknown> }
    }).configContent

    expect(configContent).not.toHaveProperty('credentials')
    expect(configContent.echoes).toMatchObject({
      exactLowercase: '[REDACTED]',
      queryLowercase: 'https://factory.test?token=[REDACTED]&next=true',
      queryPlus: 'https://factory.test?token=[REDACTED]&next=true',
      queryPartialComma: 'https://factory.test?token=[REDACTED]&next=true',
      quotedMixed: '"apiKey":"[REDACTED]"',
      quotedFullyEncoded: '"apiKey":"[REDACTED]"',
      quotedPartialPipe: '"apiKey":"[REDACTED]"',
      quotedDoubleEscape: '{"token":"[REDACTED]"}',
      quotedOddBackslashes: '{"token":"[REDACTED]"}',
      quotedEvenBackslashes: '{"token":"[REDACTED]"}',
      quotedSingleEscape: "token='[REDACTED]'",
      quotedFullQuoteEncoding: '"token":"[REDACTED]"',
      headerFullyEncoded: 'Authorization: Bearer [REDACTED]',
      headerPartialPipe: 'Authorization: Bearer [REDACTED] | next',
      formLowercase: 'FACTORY_TOKEN=[REDACTED]&next=true',
      formPlus: 'FACTORY_API_KEY=[REDACTED]&next=true',
      formPartialSemicolon: 'FACTORY_TOKEN=[REDACTED]&next=true',
      mixedUnicode: 'token=[REDACTED]',
      unquotedPartialParentheses: 'password=[REDACTED])',
      unquotedPartialSemicolon: 'token=[REDACTED]; next=true',
      repeated: 'token=[REDACTED]; password=[REDACTED]',
      ordinaryLookalikes: [
        '/docs/a%2cb-suffix',
        'token=a%2cbeta',
        'token=%61%2c%62%78',
        'token=%78%61%2c%62',
        'token=%61%2g%62',
        'https://factory.test?token=%61,bx&next=true',
        'token=%61,beta',
        '"apiKey":"%61|bx"',
        '"token":"%61\\"bx"',
        "token='%61\\'bx'",
        'token="%61\\qb"',
        'token="%61\\',
        "token='%61\\",
        'password=%61(b)x)',
        'Authorization: Bearer a+b',
        '"token":"a+b"',
        'ordinary a%2cb text',
        'ordinary %61%2c%62 text',
        'https://factory.test?tokenish=%61%2c%62',
        'token=a%2gb',
        'token=A%2cb'
      ]
    })
  })

  it('does not mutate source configs or non-Droid content while sanitizing aliases and assets', () => {
    const secret = 'alias-config-secret-value'
    const base = {
      ctxId: 'immutability',
      cwd: '/workspace',
      env: {},
      configs: [{
        adapters: {
          droidAlias: {
            packageId: '@oneworks/adapter-droid',
            configContent: { token: secret, marker: 'alias' }
          },
          pi: { configContent: { marker: 'pi-unchanged' } }
        }
      }, undefined],
      assets: {
        leakedCopy: secret,
        safe: { path: '/workspace/data', label: 'alpha' }
      }
    } as unknown as Parameters<typeof sanitizeTaskBaseForPersistence>[0]
    const snapshot = structuredClone(base)

    const sanitized = sanitizeTaskBaseForPersistence(base)

    expect(base).toEqual(snapshot)
    expect(sanitized.assets).toEqual({
      leakedCopy: '[REDACTED]',
      safe: { path: '/workspace/data', label: 'alpha' }
    })
    expect(sanitized.configs[0]?.adapters?.pi).toEqual({ configContent: { marker: 'pi-unchanged' } })
  })
})
