import { Buffer } from 'node:buffer'

import { describe, expect, it } from 'vitest'

import { createGooseRedactor } from '../src/runtime/redaction'

describe('goose persistent artifact redaction', () => {
  it('scrubs config-only credentials recursively while retaining routing metadata', () => {
    const apiKey = 'config-only-api-key-value'
    const managementKey = 'config-only-management-key'
    const profileToken = 'config-only-profile-token'
    const mapSecret = 'config-only-map-secret'
    const setSecret = 'config-only-set-secret'
    const artifact = {
      configs: [{
        modelServices: {
          routed: {
            apiBaseUrl: 'https://models.example.test/v1',
            apiKey,
            apiKeyEnv: 'ROUTED_API_KEY',
            apiProtocol: 'openai_chat_completions',
            management: {
              apiKey: managementKey,
              authorizationUrl: 'https://models.example.test/oauth',
              enabled: true,
              headers: { Authorization: `Bearer ${managementKey}`, 'X-Region': 'east' }
            },
            maxOutputTokens: 8_192,
            profiles: {
              coding: {
                provider: 'openai',
                providerOptions: {
                  access_token: profileToken,
                  note: `token=${profileToken}; encoded=${Buffer.from(profileToken).toString('base64')}`
                }
              }
            },
            provider: 'openai',
            services: {
              nested: {
                extra: {
                  authentication: {
                    mode: 'bearer',
                    token: profileToken
                  }
                }
              }
            }
          }
        }
      }],
      configState: {
        effectiveProjectConfig: { extra: new Map([['clientSecret', mapSecret]]) },
        mergedConfig: { extra: new Set([{ privateKey: setSecret }]) },
        projectConfig: { authorization: `Bearer ${profileToken}` },
        userConfig: { credentialRevision: 'revision-7', credentialUpdatedAt: 1_786_612_800_000 }
      },
      error: Object.assign(new Error(`request failed with ${apiKey}`), {
        api_key: apiKey
      }),
      summary: `embedded=${encodeURIComponent(managementKey)}`
    }

    const redacted = createGooseRedactor({}).redactArtifactValue(artifact)
    const serialized = JSON.stringify({
      ...redacted,
      configState: {
        ...redacted.configState,
        effectiveProjectConfig: {
          extra: [...redacted.configState.effectiveProjectConfig.extra.entries()]
        },
        mergedConfig: {
          extra: [...redacted.configState.mergedConfig.extra.values()]
        }
      },
      error: {
        api_key: redacted.error.api_key,
        message: redacted.error.message,
        stack: redacted.error.stack
      }
    })

    for (const secret of [apiKey, managementKey, profileToken, mapSecret, setSecret]) {
      expect(serialized).not.toContain(secret)
      expect(serialized).not.toContain(encodeURIComponent(secret))
      expect(serialized).not.toContain(Buffer.from(secret).toString('base64'))
    }
    expect(serialized).toContain('[REDACTED]')
    expect(redacted.configs[0]!.modelServices.routed).toMatchObject({
      apiBaseUrl: 'https://models.example.test/v1',
      apiKey: '[REDACTED]',
      apiKeyEnv: 'ROUTED_API_KEY',
      apiProtocol: 'openai_chat_completions',
      maxOutputTokens: 8_192,
      provider: 'openai'
    })
    expect(redacted.configs[0]!.modelServices.routed.management).toMatchObject({
      authorizationUrl: 'https://models.example.test/oauth',
      enabled: true,
      headers: { Authorization: '[REDACTED]', 'X-Region': 'east' }
    })
    expect(redacted.configs[0]!.modelServices.routed.services.nested.extra.authentication).toEqual({
      mode: 'bearer',
      token: '[REDACTED]'
    })
    expect(redacted.configState.userConfig).toEqual({
      credentialRevision: 'revision-7',
      credentialUpdatedAt: 1_786_612_800_000
    })
  })

  it('keeps raw runtime input intact and still applies environment-secret redaction', () => {
    const envSecret = 'environment-secret-value'
    const configSecret = 'configuration-secret-value'
    const value = { apiKey: configSecret, message: `${envSecret}:${configSecret}` }
    const redacted = createGooseRedactor({ OPENAI_API_KEY: envSecret }).redactArtifactValue(value)

    expect(value).toEqual({ apiKey: configSecret, message: `${envSecret}:${configSecret}` })
    expect(redacted).toEqual({ apiKey: '[REDACTED]', message: '[REDACTED]:[REDACTED]' })
  })

  it('uses config credential sources to scrub later generic hook and log strings', () => {
    const configSecret = 'config-source-only-secret'
    const redactor = createGooseRedactor({}, [{
      modelServices: { private: { apiKey: configSecret } }
    }])

    expect(redactor.redactArtifactValue({
      hookMessage: `failed=${configSecret}`,
      logData: Buffer.from(configSecret).toString('base64')
    })).toEqual({
      hookMessage: 'failed=[REDACTED]',
      logData: '[REDACTED]'
    })
  })
})
