import { describe, expect, it } from 'vitest'

import type { Config } from '@oneworks/types'

import { buildSections } from '#~/routes/config-helpers.js'

describe('config helpers', () => {
  it('masks voice credentials and sensitive header values in config sections', () => {
    const sections = buildSections(
      {
        env: {
          OPENAI_API_KEY: 'sk-test',
          PUBLIC_FLAG: 'true'
        },
        voice: {
          speechToText: {
            defaultServiceId: 'openai',
            services: {
              openai: {
                provider: 'openai-transcriptions',
                apiKey: 'sk-direct',
                apiKeyEnv: 'OPENAI_API_KEY',
                model: 'gpt-4o-transcribe'
              },
              local: {
                provider: 'custom-http',
                request: {
                  url: 'http://127.0.0.1:8787/transcribe',
                  headers: {
                    Authorization: 'Bearer token',
                    'X-Api-Key': 'service-key',
                    'X-Trace-Id': 'trace'
                  }
                }
              }
            }
          }
        }
      } satisfies Config
    )

    const services = sections.voice?.speechToText?.services as Record<string, Record<string, unknown>> | undefined
    const openai = services?.openai
    const local = services?.local as { request?: { headers?: Record<string, string> } } | undefined

    expect(sections.general.env?.OPENAI_API_KEY).toBe('******')
    expect(sections.general.env?.PUBLIC_FLAG).toBe('true')
    expect(openai?.apiKey).toBe('******')
    expect(openai?.apiKeyEnv).toBe('OPENAI_API_KEY')
    expect(local?.request?.headers?.Authorization).toBe('******')
    expect(local?.request?.headers?.['X-Api-Key']).toBe('******')
    expect(local?.request?.headers?.['X-Trace-Id']).toBe('trace')
  })

  it('masks secret-like model service fields before returning config sections', () => {
    const sections = buildSections(
      {
        env: {
          API_TOKEN: 'secret-token',
          SAFE_NAME: 'visible'
        },
        modelServices: {
          kimi: {
            provider: 'moonshot-cn',
            apiKey: 'secret-kimi',
            management: {
              apiKey: 'secret-management'
            }
          }
        }
      } satisfies Config
    )

    expect(sections.modelServices?.kimi).toMatchObject({
      provider: 'moonshot-cn',
      apiKey: '******',
      management: {
        apiKey: '******'
      }
    })
    expect(sections.general.env).toEqual({
      API_TOKEN: '******',
      SAFE_NAME: 'visible'
    })
  })
})
