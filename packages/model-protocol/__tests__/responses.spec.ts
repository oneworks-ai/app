/* eslint-disable max-lines -- one fixture suite audits the complete request/response/stream protocol star. */
import { describe, expect, it } from 'vitest'

import {
  UnsupportedProtocolFeatureError,
  createResponseStreamTranslator,
  translateResponseToResponses,
  translateResponsesRequest
} from '../src/index.js'

// Scenario shapes independently rewritten from CLIProxyAPI MIT fixtures at
// f43aad7637ad813745bf7d341acb5663617570c5.
const request = {
  model: 'example-model',
  instructions: 'Be precise',
  input: [
    { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'Use tools when needed.' }] },
    {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'Inspect this.' }, {
        type: 'input_image',
        image_url: 'data:image/png;base64,aGVsbG8='
      }]
    },
    { type: 'function_call', call_id: 'call_1', name: 'weather', arguments: '{"city":"Shanghai"}' },
    { type: 'function_call_output', call_id: 'call_1', output: 'sunny' }
  ],
  tools: [{
    type: 'function',
    name: 'weather',
    description: 'Weather',
    parameters: { type: 'object', properties: { city: { type: 'string' } } }
  }],
  tool_choice: { type: 'function', name: 'weather' },
  max_output_tokens: 321,
  reasoning: { effort: 'medium' },
  text: { format: { type: 'json_schema', name: 'answer', schema: { type: 'object' }, strict: true } },
  stream: true
}

describe('responses request star', () => {
  it('passes native Responses through without mutation', () => {
    const translated = translateResponsesRequest({ target: 'openai-responses', request })
    expect(translated).toEqual(request)
    expect(translated).not.toBe(request)
  })

  it('converts Responses to Chat Completions', () => {
    const translated = translateResponsesRequest({
      target: 'openai-chat-completions',
      request: { ...request, text: { ...request.text, verbosity: 'low' } }
    })
    expect(translated.model).toBe('example-model')
    expect(translated.max_tokens).toBe(321)
    expect(translated.reasoning_effort).toBe('medium')
    expect(translated.verbosity).toBe('low')
    expect(translated.response_format).toMatchObject({ type: 'json_schema' })
    expect(translated.tools).toMatchObject([{ type: 'function', function: { name: 'weather' } }])
    expect(translated.messages).toMatchObject([
      { role: 'system', content: 'Be precise' },
      { role: 'developer' },
      { role: 'user' },
      { role: 'assistant', tool_calls: [{ function: { name: 'weather' } }] },
      { role: 'tool', tool_call_id: 'call_1' }
    ])
  })

  it('converts Responses to Anthropic Messages including data-url image and function IO', () => {
    const translated = translateResponsesRequest({
      target: 'anthropic-messages',
      request: { ...request, max_output_tokens: 4096, tool_choice: 'auto' }
    })
    expect(translated.system).toContain('Be precise')
    expect(translated.max_tokens).toBe(4096)
    expect(translated.thinking).toEqual({ type: 'enabled', budget_tokens: 1024 })
    expect(translated.tools).toMatchObject([{ name: 'weather', input_schema: { type: 'object' } }])
    expect(translated.messages).toMatchObject([
      { role: 'user', content: [{ type: 'text' }, { type: 'image', source: { type: 'base64' } }] },
      { role: 'assistant', content: [{ type: 'tool_use', name: 'weather' }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1' }] }
    ])
  })

  it('converts Responses to Gemini GenerateContent', () => {
    const translated = translateResponsesRequest({ target: 'gemini-generate-content', request })
    expect(translated.systemInstruction).toBeTruthy()
    expect(translated.generationConfig).toMatchObject({
      maxOutputTokens: 321,
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingBudget: 1024 }
    })
    expect(translated.tools).toMatchObject([{ functionDeclarations: [{ name: 'weather' }] }])
    expect(translated.contents).toMatchObject([
      { role: 'user', parts: [{ text: 'Inspect this.' }, { inlineData: { mimeType: 'image/png' } }] },
      { role: 'model', parts: [{ functionCall: { name: 'weather' } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'weather' } }] }
    ])
  })

  it('fails closed for unsupported built-in tools and content semantics', () => {
    expect(() =>
      translateResponsesRequest({
        target: 'openai-chat-completions',
        request: { input: [], tools: [{ type: 'computer_use' }] }
      })
    ).toThrow(UnsupportedProtocolFeatureError)
    expect(() => translateResponsesRequest({ target: 'anthropic-messages', request }))
      .toThrow(UnsupportedProtocolFeatureError)
    expect(() =>
      translateResponsesRequest({
        target: 'anthropic-messages',
        request: { input: [{ type: 'message', role: 'user', content: [{ type: 'input_audio', audio: 'nope' }] }] }
      })
    ).toThrow(UnsupportedProtocolFeatureError)
  })

  it('preserves Chat controls and fails closed when target protocols lack equivalents', () => {
    expect(translateResponsesRequest({
      target: 'openai-chat-completions',
      request: {
        input: 'hello',
        store: false,
        parallel_tool_calls: true,
        tools: [{ type: 'function', name: 'run', strict: true }]
      }
    })).toMatchObject({ store: false, parallel_tool_calls: true })
    expect(() =>
      translateResponsesRequest({
        target: 'anthropic-messages',
        request: { input: 'hello', store: false }
      })
    ).toThrow(UnsupportedProtocolFeatureError)
    expect(() =>
      translateResponsesRequest({
        target: 'anthropic-messages',
        request: { input: 'hello', parallel_tool_calls: false }
      })
    ).toThrow(UnsupportedProtocolFeatureError)
    expect(() =>
      translateResponsesRequest({
        target: 'gemini-generate-content',
        request: { input: 'hello', tools: [{ type: 'function', name: 'run', strict: true }] }
      })
    ).toThrow(UnsupportedProtocolFeatureError)
    for (const target of ['anthropic-messages', 'gemini-generate-content'] as const) {
      expect(() => translateResponsesRequest({ target, request: { input: 'hello', text: { verbosity: 'high' } } }))
        .toThrow(UnsupportedProtocolFeatureError)
    }
    expect(() =>
      translateResponsesRequest({
        target: 'openai-chat-completions',
        request: { input: 'hello', text: { unsupported: true } }
      })
    ).toThrow(UnsupportedProtocolFeatureError)
    expect(() =>
      translateResponsesRequest({
        target: 'openai-chat-completions',
        request: { input: 'hello', reasoning: { unsupported: true } }
      })
    ).toThrow(UnsupportedProtocolFeatureError)
  })
})

describe('non-stream upstream response star', () => {
  it('converts Chat text, multiple tools, and usage', () => {
    const translated = translateResponseToResponses({
      source: 'openai-chat-completions',
      requestId: 'chat_1',
      response: {
        choices: [{
          message: {
            content: 'Hello',
            tool_calls: [{ id: 'call_1', function: { name: 'a', arguments: '{}' } }, {
              id: 'call_2',
              function: { name: 'b', arguments: '{"x":1}' }
            }]
          }
        }],
        usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 }
      }
    })
    expect(translated).toMatchObject({
      id: 'resp_chat_1',
      status: 'completed',
      usage: { input_tokens: 5, output_tokens: 7, total_tokens: 12 }
    })
    expect(translated.output).toMatchObject([
      { type: 'message', content: [{ type: 'output_text', text: 'Hello' }] },
      { type: 'function_call', name: 'a' },
      { type: 'function_call', name: 'b' }
    ])
  })

  it('converts Anthropic and Gemini text/tools/usage', () => {
    const anthropic = translateResponseToResponses({
      source: 'anthropic-messages',
      requestId: 'a',
      response: {
        content: [{ type: 'text', text: 'Hi' }, {
          type: 'tool_use',
          id: 'tool',
          name: 'weather',
          input: { city: 'Shanghai' }
        }],
        usage: { input_tokens: 2, output_tokens: 3 }
      }
    })
    const gemini = translateResponseToResponses({
      source: 'gemini-generate-content',
      requestId: 'g',
      response: {
        candidates: [{
          content: {
            parts: [{ text: 'Hi' }, { functionCall: { id: 'tool', name: 'weather', args: { city: 'Shanghai' } } }]
          }
        }],
        usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3, totalTokenCount: 5 }
      }
    })
    expect(anthropic).toMatchObject({ usage: { input_tokens: 2, output_tokens: 3 } })
    expect(gemini).toMatchObject({ usage: { total_tokens: 5 } })
  })

  it('preserves provider reasoning as Responses summary items', () => {
    const anthropic = translateResponseToResponses({
      source: 'anthropic-messages',
      requestId: 'a-reasoning',
      response: {
        content: [
          { type: 'thinking', thinking: 'Inspect first.', signature: 'opaque-signature' },
          { type: 'text', text: 'Done.' }
        ]
      }
    })
    const gemini = translateResponseToResponses({
      source: 'gemini-generate-content',
      requestId: 'g-reasoning',
      response: {
        candidates: [{ content: { parts: [{ text: 'Think.', thought: true }, { text: 'Done.' }] } }]
      }
    })

    expect(anthropic.output).toMatchObject([
      {
        type: 'reasoning',
        encrypted_content: expect.stringContaining('owmp:v1:'),
        summary: [{ text: 'Inspect first.' }]
      },
      { type: 'message', content: [{ text: 'Done.' }] }
    ])
    expect(gemini.output).toMatchObject([
      { type: 'reasoning', summary: [{ text: 'Think.' }] },
      { type: 'message', content: [{ text: 'Done.' }] }
    ])
  })

  it('round-trips signed Anthropic reasoning and groups parallel function calls by turn', () => {
    const first = translateResponseToResponses({
      source: 'anthropic-messages',
      response: {
        content: [
          { type: 'thinking', thinking: 'Inspect first.', signature: 'opaque-signature' },
          { type: 'tool_use', id: 'call_a', name: 'a', input: {} },
          { type: 'tool_use', id: 'call_b', name: 'b', input: {} }
        ]
      }
    })
    const reasoning = (first.output as any[]).find(item => item.type === 'reasoning')
    const translated = translateResponsesRequest({
      target: 'anthropic-messages',
      request: {
        max_output_tokens: 4096,
        reasoning: { effort: 'medium', summary: 'none' },
        input: [
          reasoning,
          { type: 'function_call', call_id: 'call_a', name: 'a', arguments: '{}' },
          { type: 'function_call', call_id: 'call_b', name: 'b', arguments: '{}' },
          { type: 'function_call_output', call_id: 'call_a', output: 'A' },
          { type: 'function_call_output', call_id: 'call_b', output: 'B' }
        ]
      }
    })
    expect(translated.messages).toMatchObject([
      {
        role: 'assistant',
        content: [
          { type: 'thinking', signature: 'opaque-signature' },
          { type: 'tool_use', id: 'call_a' },
          { type: 'tool_use', id: 'call_b' }
        ]
      },
      { role: 'user', content: [{ type: 'tool_result' }, { type: 'tool_result' }] }
    ])
  })

  it('preserves Gemini function-call thought signatures through a Responses carrier', () => {
    const first = translateResponseToResponses({
      source: 'gemini-generate-content',
      response: {
        candidates: [{
          content: {
            parts: [{ thoughtSignature: 'gemini-signature', functionCall: { id: 'call_g', name: 'run', args: {} } }]
          },
          finishReason: 'STOP'
        }]
      }
    })
    const translated = translateResponsesRequest({
      target: 'gemini-generate-content',
      request: { input: first.output as any }
    })
    expect(translated.contents).toMatchObject([{
      role: 'model',
      parts: [{ functionCall: { id: 'call_g', name: 'run' }, thoughtSignature: 'gemini-signature' }]
    }])
  })

  it('fails closed instead of dropping parallel choices or heterogeneous Chat content', () => {
    expect(() =>
      translateResponseToResponses({
        source: 'openai-chat-completions',
        response: { choices: [{ message: { content: 'one' } }, { message: { content: 'two' } }] }
      })
    ).toThrow(UnsupportedProtocolFeatureError)
    expect(() =>
      translateResponseToResponses({
        source: 'openai-chat-completions',
        response: { choices: [{ message: { content: [{ type: 'text', text: 'hidden' }] } }] }
      })
    ).toThrow(UnsupportedProtocolFeatureError)
  })

  it('maps truncation and Gemini reasoning usage without declaring success', () => {
    const chat = translateResponseToResponses({
      source: 'openai-chat-completions',
      response: {
        choices: [{
          finish_reason: 'length',
          message: {
            tool_calls: [{ id: 'partial', function: { name: 'run', arguments: '{"x":' } }]
          }
        }]
      }
    })
    const gemini = translateResponseToResponses({
      source: 'gemini-generate-content',
      response: {
        candidates: [{ content: { parts: [{ text: 'partial' }] }, finishReason: 'MAX_TOKENS' }],
        usageMetadata: {
          promptTokenCount: 10,
          cachedContentTokenCount: 3,
          candidatesTokenCount: 2,
          thoughtsTokenCount: 4,
          totalTokenCount: 16
        }
      }
    })
    expect(chat).toMatchObject({
      status: 'incomplete',
      output: [{ type: 'function_call', status: 'incomplete' }]
    })
    expect(gemini).toMatchObject({
      status: 'incomplete',
      output: [{ type: 'message', status: 'incomplete' }],
      usage: {
        input_tokens: 10,
        input_tokens_details: { cached_tokens: 3 },
        output_tokens: 6,
        output_tokens_details: { reasoning_tokens: 4 },
        total_tokens: 16
      }
    })
  })

  it('includes Anthropic cache token columns in Responses input usage', () => {
    expect(translateResponseToResponses({
      source: 'anthropic-messages',
      response: {
        content: [{ type: 'text', text: 'done' }],
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 10,
          cache_creation_input_tokens: 2,
          cache_read_input_tokens: 3,
          output_tokens: 4
        }
      }
    })).toMatchObject({
      usage: {
        input_tokens: 15,
        input_tokens_details: { cached_tokens: 3, cache_creation_tokens: 2 },
        output_tokens: 4,
        total_tokens: 19
      }
    })
  })

  it('fails closed for blocked or empty Gemini responses and malformed Anthropic blocks', () => {
    expect(translateResponseToResponses({
      source: 'gemini-generate-content',
      response: { promptFeedback: { blockReason: 'SAFETY', blockReasonMessage: 'blocked input' }, candidates: [] }
    })).toMatchObject({ status: 'failed', error: { message: 'SAFETY' } })
    expect(translateResponseToResponses({
      source: 'gemini-generate-content',
      response: { candidates: [] }
    })).toMatchObject({ status: 'failed' })
    expect(() =>
      translateResponseToResponses({
        source: 'anthropic-messages',
        response: { content: [{ type: 'tool_use', id: 'call', name: 'run', input: 'not-an-object' }] }
      })
    ).toThrow(UnsupportedProtocolFeatureError)
    expect(() =>
      translateResponseToResponses({
        source: 'gemini-generate-content',
        response: {
          candidates: [{
            content: { parts: [{ functionCall: { id: 'call', name: 'run', args: 'not-an-object' } }] },
            finishReason: 'STOP'
          }]
        }
      })
    ).toThrow(UnsupportedProtocolFeatureError)
    expect(translateResponsesRequest({
      target: 'openai-chat-completions',
      request: { input: 'hello', temperature: 0, top_p: 0.5, service_tier: 'priority' }
    })).toMatchObject({ temperature: 0, top_p: 0.5, service_tier: 'priority' })
    for (const control of ['max_tool_calls', 'truncation', 'previous_response_id']) {
      expect(() =>
        translateResponsesRequest({
          target: 'openai-chat-completions',
          request: { input: 'hello', [control]: control === 'max_tool_calls' ? 1 : 'value' }
        })
      ).toThrow(UnsupportedProtocolFeatureError)
    }
  })
})

describe('request-scoped Responses SSE state machine', () => {
  it('handles arbitrary Chat chunks, tool argument deltas, usage tail and completion', () => {
    const stream = createResponseStreamTranslator({ source: 'openai-chat-completions', requestId: 'one' })
    const first = stream.push(
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n' +
        'data: {"choices":[{"delta":{"content":"lo","tool_calls":[{"index":0,"id":"call_1","function":{"name":"weather","arguments":"{\\"city\\":"}}]}}]}\n\n'
    )
    const second = stream.push(
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"Shanghai\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n'
    )
    const usageTail = stream.push(
      'data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":4,"total_tokens":7}}\n\n'
    )
    const completed = stream.push('data: [DONE]\n\n')
    expect(first.join('')).toContain('response.output_text.delta')
    expect(first.join('')).toContain('response.function_call_arguments.delta')
    expect(second.join('')).not.toContain('response.completed')
    expect(usageTail.join('')).not.toContain('response.completed')
    expect(completed.join('')).toContain('response.completed')
    expect(completed.join('')).toContain('"input_tokens":3')
    expect(stream.finish()).toEqual([])
  })

  it('replays tool arguments received before the tool name', () => {
    const stream = createResponseStreamTranslator({ source: 'openai-chat-completions', requestId: 'late-name' })
    const beforeName = stream.push(
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"arguments":"{\\"city\\":"}}]}}]}\n\n'
    ).join('')
    const afterName = stream.push(
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"weather","arguments":"\\"Shanghai\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n'
    ).join('')
    const completed = stream.push('data: [DONE]\n\n').join('')

    expect(beforeName).not.toContain('response.output_item.added')
    expect(afterName).toContain('response.output_item.added')
    expect(afterName).toContain('"delta":"{\\"city\\":"')
    expect(completed).toContain('"arguments":"{\\"city\\":\\"Shanghai\\"}"')
    expect(completed).toContain('"output_index":0')
  })

  it('maps Anthropic content blocks and appends Gemini incremental chunks independently', () => {
    const anthropic = createResponseStreamTranslator({ source: 'anthropic-messages', requestId: 'a' })
    const a = anthropic.push(
      'event: content_block_start\ndata: {"index":0,"content_block":{"type":"tool_use","id":"call_a","name":"weather"}}\n\nevent: content_block_delta\ndata: {"index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"city\\":\\"Shanghai\\"}"}}\n\nevent: message_stop\ndata: {}\n\n'
    ).join('')
    const gemini = createResponseStreamTranslator({ source: 'gemini-generate-content', requestId: 'g' })
    const g = gemini.push(
      'data: {"candidates":[{"content":{"parts":[{"text":"Hel"}]}}]}\n\ndata: {"candidates":[{"content":{"parts":[{"text":"lo"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":2}}\n\n'
    ).join('')
    expect(a).toContain('function_call_arguments.done')
    expect(g).toContain('"delta":"Hel"')
    expect(g).toContain('"delta":"lo"')
  })

  it('does not trim a Gemini delta merely because it starts with the previous chunk', () => {
    const stream = createResponseStreamTranslator({ source: 'gemini-generate-content', requestId: 'prefix' })
    const output = stream.push(
      'data: {"candidates":[{"content":{"parts":[{"text":"a"}]}}]}\n\n' +
        'data: {"candidates":[{"content":{"parts":[{"text":"apple"}]},"finishReason":"STOP"}]}\n\n'
    ).join('')
    expect(output).toContain('"delta":"a"')
    expect(output).toContain('"delta":"apple"')
    expect(output).toContain('"text":"aapple"')
  })

  it('emits Anthropic tools that arrive complete in content_block_start', () => {
    const stream = createResponseStreamTranslator({ source: 'anthropic-messages', requestId: 'complete-tool' })
    const output = stream.push(
      'event: content_block_start\ndata: {"index":0,"content_block":{"type":"tool_use","id":"call_a","name":"weather","input":{"city":"Shanghai"}}}\n\n' +
        'event: message_stop\ndata: {}\n\n'
    ).join('')
    expect(output).toContain('response.output_item.added')
    expect(output).toContain('"arguments":"{\\"city\\":\\"Shanghai\\"}"')
  })

  it('streams reasoning summaries without exposing them as assistant text', () => {
    const anthropic = createResponseStreamTranslator({ source: 'anthropic-messages', requestId: 'reasoning' })
    const output = anthropic.push(
      'event: content_block_start\ndata: {"index":0,"content_block":{"type":"thinking","thinking":"","signature":"sig"}}\n\n' +
        'event: content_block_delta\ndata: {"index":0,"delta":{"type":"thinking_delta","thinking":"Inspect first."}}\n\n' +
        'event: content_block_start\ndata: {"index":1,"content_block":{"type":"text","text":""}}\n\n' +
        'event: content_block_delta\ndata: {"index":1,"delta":{"type":"text_delta","text":"Done."}}\n\n' +
        'event: message_stop\ndata: {}\n\n'
    ).join('')

    expect(output).toContain('response.reasoning_summary_text.delta')
    expect(output).toContain('"delta":"Inspect first."')
    expect(output).toContain('"encrypted_content":"owmp:v1:')
    expect(output).toContain('"output_index":0')
    expect(output).toContain('"output_index":1')
    expect(output).toContain('"delta":"Done."')
  })

  it('keeps concurrent request state isolated and does not silently absorb malformed SSE', () => {
    const one = createResponseStreamTranslator({ source: 'openai-chat-completions', requestId: 'one' })
    const two = createResponseStreamTranslator({ source: 'openai-chat-completions', requestId: 'two' })
    expect(one.push('data: {"choices":[{"delta":{"content":"one"}}]}\n\n').join('')).toContain('"id":"resp_one"')
    expect(two.push('data: {"choices":[{"delta":{"content":"two"}}]}\n\n').join('')).toContain('"id":"resp_two"')
    expect(() => one.push('data: nope\n\n')).toThrow(UnsupportedProtocolFeatureError)
  })

  it('adds monotonically increasing Responses sequence numbers', () => {
    const stream = createResponseStreamTranslator({ source: 'openai-chat-completions', requestId: 'sequence' })
    const output = stream.push(
      'data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n'
    ).join('')
    const numbers = [...output.matchAll(/"sequence_number":(\d+)/g)].map((match) => Number(match[1]))
    expect(numbers).toEqual(numbers.map((_, index) => index))
    expect(numbers.length).toBeGreaterThan(5)
  })

  it('fails closed for multi-choice and heterogeneous Chat stream content', () => {
    const multi = createResponseStreamTranslator({ source: 'openai-chat-completions' })
    expect(() =>
      multi.push(
        'data: {"choices":[{"delta":{"content":"one"}},{"delta":{"content":"two"}}]}\n\n'
      )
    ).toThrow(UnsupportedProtocolFeatureError)
    const heterogeneous = createResponseStreamTranslator({ source: 'openai-chat-completions' })
    expect(() =>
      heterogeneous.push(
        'data: {"choices":[{"delta":{"content":[{"type":"text","text":"hidden"}]}}]}\n\n'
      )
    ).toThrow(UnsupportedProtocolFeatureError)
  })

  it('emits an incomplete terminal without completing partial tool arguments', () => {
    const stream = createResponseStreamTranslator({ source: 'openai-chat-completions' })
    const output = stream.push(
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call","function":{"name":"run","arguments":"{\\"x\\":"}}]},"finish_reason":"length"}]}\n\n' +
        'data: [DONE]\n\n'
    ).join('')
    expect(output).toContain('response.incomplete')
    expect(output).toContain('"status":"incomplete"')
    expect(output).not.toContain('response.function_call_arguments.done')
  })

  it('enforces a total upstream SSE byte limit', () => {
    const stream = createResponseStreamTranslator({
      source: 'openai-chat-completions',
      maxInputBytes: 16
    })
    expect(() => stream.push('data: {"choices":[]}\n\n')).toThrow(UnsupportedProtocolFeatureError)
  })

  it('parses CRLF boundaries split across transport chunks', () => {
    const stream = createResponseStreamTranslator({ source: 'openai-chat-completions', requestId: 'crlf' })
    expect(stream.push('data: {"choices":[{"delta":{"content":"hello"}}]}\r').join(''))
      .not.toContain('response.output_text.delta')
    expect(stream.push('\n\r').join('')).not.toContain('response.output_text.delta')
    expect(stream.push('\n').join('')).toContain('response.output_text.delta')
    expect(stream.push('data: [DONE]\r\n\r\n').join('')).toContain('response.completed')
  })

  it('emits a Responses failure lifecycle for an upstream error event', () => {
    const stream = createResponseStreamTranslator({ source: 'anthropic-messages', requestId: 'error' })
    expect(stream.push('event: error\ndata: {"error":{"message":"overloaded"}}\n\n').join('')).toContain(
      'response.failed'
    )
  })

  it('fails blocked and empty Gemini streams with a sequenced lifecycle', () => {
    const blocked = createResponseStreamTranslator({ source: 'gemini-generate-content', requestId: 'blocked' })
    const blockedOutput = blocked.push(
      'data: {"promptFeedback":{"blockReason":"SAFETY","blockReasonMessage":"blocked input"},"candidates":[]}\n\n'
    ).join('')
    expect(blockedOutput).toContain('response.failed')
    expect(blockedOutput).toContain('"sequence_number":2')

    const empty = createResponseStreamTranslator({ source: 'gemini-generate-content', requestId: 'empty' })
    expect(empty.finish().join('')).toContain('response.failed')
  })

  it('rejects Gemini stream function calls with non-object arguments', () => {
    const stream = createResponseStreamTranslator({ source: 'gemini-generate-content' })
    expect(() =>
      stream.push(
        'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"run","args":"bad"}}]},"finishReason":"STOP"}]}\n\n'
      )
    ).toThrow(UnsupportedProtocolFeatureError)
  })

  it('emits a sequenced protocol-conversion failure after prior deltas', () => {
    const stream = createResponseStreamTranslator({ source: 'openai-chat-completions', requestId: 'failure' })
    const before = stream.push('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n').join('')
    const failed = stream.fail('malformed upstream').join('')
    const beforeNumbers = [...before.matchAll(/"sequence_number":(\d+)/g)].map(match => Number(match[1]))
    const failedNumbers = [...failed.matchAll(/"sequence_number":(\d+)/g)].map(match => Number(match[1]))
    expect(failed).toContain('response.failed')
    expect(failedNumbers[0]).toBe(Math.max(...beforeNumbers) + 1)
  })
})
