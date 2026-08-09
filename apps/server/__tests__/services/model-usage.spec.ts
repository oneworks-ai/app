import { describe, expect, it } from 'vitest'

import {
  modelUsageInputFromMessage,
  modelUsageReportingEnabled,
  modelUsageTeamScopeFromModelService
} from '../../src/services/model-usage.js'

describe('session model usage', () => {
  it('maps assistant usage and the Model Service selector without content', () => {
    const measurement = modelUsageInputFromMessage({
      adapter: 'codex',
      fallbackModel: 'fallback',
      message: {
        content: 'private response text',
        createdAt: Date.parse('2026-08-09T03:00:00.000Z'),
        id: 'message-1',
        model: 'team-openai,gpt-5.6',
        role: 'assistant',
        usage: {
          cache_creation_input_tokens: 5,
          cache_read_input_tokens: 200,
          input_tokens: 900,
          output_tokens: 300
        }
      },
      sessionId: 'private-session'
    })

    expect(measurement).toMatchObject({
      adapter: 'codex',
      cacheCreationInputTokens: 5,
      cachedInputTokens: 200,
      eventId: 'message-1',
      inputTokens: 900,
      model: 'gpt-5.6',
      modelService: 'team-openai',
      outputTokens: 300
    })
    expect(JSON.stringify(measurement)).not.toContain('private response text')
  })

  it('ignores user messages and assistant messages without usage', () => {
    const base = { content: 'hello', createdAt: 1, id: 'message', role: 'user' as const }
    expect(modelUsageInputFromMessage({ message: base, sessionId: 'session' })).toBeUndefined()
    expect(modelUsageInputFromMessage({
      message: { ...base, role: 'assistant' },
      sessionId: 'session'
    })).toBeUndefined()
  })

  it('gates usage before constructing an event and defaults reporting on', () => {
    const message = {
      content: 'private response text',
      createdAt: 1,
      id: 'message',
      model: 'openai,gpt-5',
      role: 'assistant' as const,
      usage: { input_tokens: 10, output_tokens: 5 }
    }

    expect(modelUsageInputFromMessage({
      message,
      reportingEnabled: false,
      sessionId: 'session'
    })).toBeUndefined()
    expect(modelUsageReportingEnabled(undefined)).toBe(true)
    expect(modelUsageReportingEnabled({ modelUsageReporting: true })).toBe(true)
    expect(modelUsageReportingEnabled({ modelUsageReporting: { enabled: false } })).toBe(false)
  })

  it('uses a team policy only for Model Services downloaded from that team', () => {
    const diagnostics = {
      modelUsageReporting: {
        enabled: false,
        teams: {
          'team-1': {
            enabled: false,
            mode: 'required' as const,
            slug: 'platform-team',
            userCanControl: false
          },
          'team-2': {
            enabled: false,
            mode: 'optional' as const,
            userCanControl: true
          }
        }
      }
    }

    expect(modelUsageReportingEnabled(diagnostics, 'team-1')).toBe(true)
    expect(modelUsageReportingEnabled(diagnostics, 'platform-team')).toBe(true)
    expect(modelUsageReportingEnabled(diagnostics, 'team-2')).toBe(false)
    expect(modelUsageReportingEnabled(diagnostics, 'unknown-team')).toBe(true)
    expect(modelUsageTeamScopeFromModelService({
      personal: {
        apiBaseUrl: 'https://personal.example/v1'
      },
      'team-openai': {
        apiBaseUrl: 'https://team.example/v1',
        extra: {
          oneworks: {
            relayTeamId: 'team-2'
          }
        }
      }
    }, 'team-openai,gpt-5')).toBe('team-2')
    expect(modelUsageTeamScopeFromModelService({
      personal: {
        apiBaseUrl: 'https://personal.example/v1'
      }
    }, 'personal,gpt-5')).toBeUndefined()
    expect(modelUsageReportingEnabled(diagnostics)).toBe(false)
  })
})
