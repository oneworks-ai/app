import { describe, expect, it } from 'vitest'

import {
  UnsupportedProtocolFeatureError,
  translateRequestToResponses,
  translateResponsesToResponse
} from '../src/index.js'

// Scenario shapes independently rewritten from CLIProxyAPI MIT fixtures at
// f43aad7637ad813745bf7d341acb5663617570c5.
describe('protocol ingress to Responses', () => {
  it('preserves Chat multi-turn function calls and outputs', () => {
    const translated = translateRequestToResponses({
      source: 'openai-chat-completions',
      request: {
        model: 'gpt-example',
        messages: [
          { role: 'system', content: 'Be precise.' },
          { role: 'user', content: 'Weather?' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'call_1',
              type: 'function',
              function: { name: 'weather', arguments: '{"city":"Shanghai"}' }
            }]
          },
          { role: 'tool', tool_call_id: 'call_1', content: 'sunny' }
        ],
        tools: [{ type: 'function', function: { name: 'weather', parameters: { type: 'object' } } }],
        max_tokens: 2048,
        stream: true
      }
    })
    expect(translated).toMatchObject({
      model: 'gpt-example',
      stream: true,
      input: [
        { type: 'message', role: 'developer' },
        { type: 'message', role: 'user' },
        { type: 'function_call', call_id: 'call_1', name: 'weather' },
        { type: 'function_call_output', call_id: 'call_1', output: 'sunny' }
      ],
      tools: [{ type: 'function', name: 'weather' }],
      max_output_tokens: 2048
    })
  })

  it('accepts the nested reasoning effort emitted by OpenAI-compatible clients', () => {
    const translated = translateRequestToResponses({
      source: 'openai-chat-completions',
      request: {
        messages: [{ role: 'user', content: 'Hello' }],
        reasoning: { effort: 'medium', enabled: true }
      }
    })

    expect(translated.reasoning).toEqual({ effort: 'medium' })
    expect(translateRequestToResponses({
      source: 'openai-chat-completions',
      request: {
        messages: [],
        reasoning: { effort: 'medium', enabled: false }
      }
    })).not.toHaveProperty('reasoning')
    expect(() =>
      translateRequestToResponses({
        source: 'openai-chat-completions',
        request: {
          messages: [],
          reasoning: { summary: 'detailed' }
        }
      })
    ).toThrow('Chat reasoning controls: summary')
  })

  it('converts Anthropic and Gemini tool history to Responses', () => {
    const anthropic = translateRequestToResponses({
      source: 'anthropic-messages',
      request: {
        model: 'gpt-example',
        max_tokens: 1024,
        system: 'Be precise.',
        messages: [
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'call_a', name: 'weather', input: { city: 'Shanghai' } }]
          },
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_a', content: 'sunny' }] }
        ]
      }
    })
    const gemini = translateRequestToResponses({
      source: 'gemini-generate-content',
      request: {
        contents: [
          { role: 'model', parts: [{ functionCall: { id: 'call_g', name: 'weather', args: { city: 'Shanghai' } } }] },
          {
            role: 'user',
            parts: [{ functionResponse: { id: 'call_g', name: 'weather', response: { weather: 'sunny' } } }]
          }
        ]
      }
    })
    expect(anthropic.input).toMatchObject([
      { type: 'message', role: 'developer' },
      { type: 'function_call', call_id: 'call_a' },
      { type: 'function_call_output', call_id: 'call_a' }
    ])
    expect(gemini.input).toMatchObject([
      { type: 'function_call', call_id: 'call_g' },
      { type: 'function_call_output', call_id: 'call_g' }
    ])
  })

  it('preserves content order around tool calls for Anthropic and Gemini', () => {
    const anthropic = translateRequestToResponses({
      source: 'anthropic-messages',
      request: {
        messages: [{
          role: 'assistant',
          content: [
            { type: 'text', text: 'before' },
            { type: 'tool_use', id: 'call_a', name: 'weather', input: {} },
            { type: 'text', text: 'after' }
          ]
        }]
      }
    })
    const gemini = translateRequestToResponses({
      source: 'gemini-generate-content',
      request: {
        contents: [{
          role: 'model',
          parts: [
            { text: 'before' },
            { functionCall: { id: 'call_g', name: 'weather', args: {} } },
            { text: 'after' }
          ]
        }]
      }
    })

    for (const translated of [anthropic, gemini]) {
      expect(translated.input).toMatchObject([
        { type: 'message', content: [{ text: 'before' }] },
        { type: 'function_call' },
        { type: 'message', content: [{ text: 'after' }] }
      ])
    }
  })

  it('fails closed for orphan outputs and unsupported controls', () => {
    expect(() =>
      translateRequestToResponses({
        source: 'openai-chat-completions',
        request: { messages: [{ role: 'tool', tool_call_id: 'missing', content: 'nope' }] }
      })
    ).toThrow(UnsupportedProtocolFeatureError)
    expect(() =>
      translateRequestToResponses({
        source: 'openai-chat-completions',
        request: { messages: [], temperature: 0 }
      })
    ).toThrow(UnsupportedProtocolFeatureError)
  })
})

describe('responses egress', () => {
  const response = {
    id: 'resp_1',
    model: 'gpt-example',
    status: 'completed',
    output: [
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hello' }] },
      { type: 'function_call', call_id: 'call_1', name: 'weather', arguments: '{"city":"Shanghai"}' }
    ],
    usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 }
  }

  it('converts Responses to Chat, Anthropic, and Gemini tool responses', () => {
    const chat = translateResponsesToResponse({ target: 'openai-chat-completions', response })
    const anthropic = translateResponsesToResponse({ target: 'anthropic-messages', response })
    const gemini = translateResponsesToResponse({ target: 'gemini-generate-content', response })
    expect(chat).toMatchObject({
      choices: [{ message: { content: 'Hello', tool_calls: [{ id: 'call_1' }] }, finish_reason: 'tool_calls' }]
    })
    expect(anthropic).toMatchObject({
      content: [{ type: 'text' }, { type: 'tool_use', id: 'call_1' }],
      stop_reason: 'tool_use'
    })
    expect(gemini).toMatchObject({
      candidates: [{ content: { parts: [{ text: 'Hello' }, { functionCall: { id: 'call_1' } }] } }]
    })
  })

  it('fails closed when the canonical response failed', () => {
    expect(() =>
      translateResponsesToResponse({
        target: 'openai-chat-completions',
        response: { status: 'failed', error: { message: 'blocked' }, output: [] }
      })
    ).toThrow('blocked')
  })
})
