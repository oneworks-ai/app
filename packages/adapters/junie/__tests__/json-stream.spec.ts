import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import type { AdapterOutputEvent } from '@oneworks/types'

import { createJunieJsonStreamParser } from '#~/protocol/json-stream.js'

const fixtureUrl = new URL('../__fixtures__/junie-2651.4.0-a2ux-descriptors.jsonl', import.meta.url)
const terminalResult = (result = 'done') => ({ type: 'result', result, errorCode: [] })

const parse = async (
  input: string,
  chunkSizes = [input.length],
  options: { expectedSessionId?: string } = {}
) => {
  const events: AdapterOutputEvent[] = []
  const diagnostics: Array<{ code: string; eventType?: string }> = []
  const sessions: string[] = []
  const parser = createJunieJsonStreamParser({
    expectedSessionId: options.expectedSessionId,
    model: 'default',
    onDiagnostic: diagnostic => diagnostics.push(diagnostic),
    onEvent: event => events.push(event),
    onSessionId: sessionId => sessions.push(sessionId)
  })
  let offset = 0
  let index = 0
  while (offset < input.length) {
    const size = chunkSizes[index % chunkSizes.length]
    parser.push(input.slice(offset, offset + size))
    offset += size
    index += 1
  }
  return { diagnostics, events, result: parser.finish(), sessions }
}

describe('junie json-stream protocol', () => {
  it('parses the sanitized official-JAR descriptor fixture across arbitrary chunks', async () => {
    const input = await readFile(fixtureUrl, 'utf8')
    const output = await parse(input, [1, 13, 2, 47, 3, 101])

    expect(output.result).toEqual({
      didFatalError: false,
      didResult: true,
      didStop: true,
      eventCount: 5,
      sessionId: 'session-2651-sanitized'
    })
    expect(output.sessions).toEqual(['session-2651-sanitized'])
    expect(output.diagnostics).toContainEqual(expect.objectContaining({
      code: 'unknown_event',
      eventType: 'eap-future-decoration'
    }))
    expect(output.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'message',
        data: expect.objectContaining({ content: 'Hello world' })
      }),
      expect.objectContaining({
        type: 'message',
        data: expect.objectContaining({
          content: [expect.objectContaining({ type: 'tool_use', name: 'adapter:junie:Read' })]
        })
      }),
      { type: 'stop' }
    ]))
  })

  it('accepts multiple events in one chunk and diagnoses duplicate terminal events', async () => {
    const terminal = JSON.stringify(terminalResult())
    const output = await parse(`${terminal}\n${terminal}\n`)
    expect(output.events.filter(event => event.type === 'stop')).toHaveLength(1)
    expect(output.diagnostics).toContainEqual(expect.objectContaining({ code: 'duplicate_terminal' }))
  })

  it('fails visibly on truncated JSON at EOF', async () => {
    const output = await parse('{"type":"step","output":"cut')
    expect(output.result.didFatalError).toBe(true)
    expect(output.events).toContainEqual(expect.objectContaining({
      type: 'error',
      data: expect.objectContaining({ code: 'junie_protocol_invalid_json', fatal: true })
    }))
  })

  it.each(['FutureAgentFailureEvent', 'SessionFinishedEvent', 'TerminalProtocolChangedEvent'])(
    'fails visibly on unknown failure or terminal-shaped event %s',
    async type => {
      const output = await parse(`${JSON.stringify({ type })}\n`)
      expect(output.result).toEqual(expect.objectContaining({ didFatalError: true, didStop: true }))
      expect(output.events).toContainEqual(expect.objectContaining({
        type: 'error',
        data: expect.objectContaining({ code: 'junie_protocol_unknown_terminal', fatal: true })
      }))
    }
  )

  it('rejects a session event that violates the pinned wire contract', async () => {
    const output = await parse(`${JSON.stringify({ type: 'session', timestamp: 1786608000000 })}\n`)
    expect(output.events).toContainEqual(expect.objectContaining({
      type: 'error',
      data: expect.objectContaining({ code: 'junie_protocol_session_id_missing', fatal: true })
    }))
  })

  it('never learns a native session id from an unknown event', async () => {
    const output = await parse(`${
      JSON.stringify({
        type: 'eap-future-decoration',
        sessionId: 'must-not-cache'
      })
    }\n`)
    expect(output.sessions).toEqual([])
    expect(output.diagnostics).toContainEqual(expect.objectContaining({ code: 'unknown_event' }))
  })

  it('suppresses post-terminal events without learning a late session id', async () => {
    const output = await parse([
      JSON.stringify(terminalResult()),
      JSON.stringify({ type: 'session', sessionId: 'must-not-cache-after-terminal' })
    ].join('\n'))
    expect(output.sessions).toEqual([])
    expect(output.diagnostics).toContainEqual(expect.objectContaining({ code: 'post_terminal_event' }))
  })

  it('fails a terminal-shaped protocol change after a confirmed result', async () => {
    const output = await parse([
      JSON.stringify({ type: 'session', sessionId: 'session-pinned' }),
      JSON.stringify(terminalResult()),
      JSON.stringify({ type: 'FutureAgentFailureEvent', message: 'late failure' })
    ].join('\n'))

    expect(output.result).toEqual(expect.objectContaining({ didFatalError: true, didResult: true }))
    expect(output.events.filter(event => event.type === 'stop')).toHaveLength(1)
    expect(output.events).toContainEqual(expect.objectContaining({
      type: 'error',
      data: expect.objectContaining({ code: 'junie_protocol_unknown_terminal', fatal: true })
    }))
  })

  it.each([
    ['missing result', { type: 'result', errorCode: [] }],
    ['null result', { type: 'result', result: null, errorCode: [] }],
    ['non-string result', { type: 'result', result: 42, errorCode: [] }],
    ['missing errorCode', { type: 'result', result: 'done' }],
    ['non-array errorCode', { type: 'result', result: 'done', errorCode: 0 }],
    ['non-object usage', { type: 'result', result: 'done', errorCode: ['bad'] }],
    ['usage without model', { type: 'result', result: 'done', errorCode: [{ calls: 1 }] }],
    ['usage without calls', { type: 'result', result: 'done', errorCode: [{ model: 'm' }] }],
    ['usage with fractional calls', { type: 'result', result: 'done', errorCode: [{ model: 'm', calls: 1.5 }] }],
    ['usage with invalid token count', {
      type: 'result',
      result: 'done',
      errorCode: [{ model: 'm', calls: 1, outputTokens: '1' }]
    }]
  ])('rejects a pinned terminal result with %s', async (_label, event) => {
    const output = await parse(`${JSON.stringify(event)}\n`)

    expect(output.result).toEqual(expect.objectContaining({ didFatalError: true, didResult: false, didStop: true }))
    expect(output.events).toContainEqual(expect.objectContaining({
      type: 'error',
      data: expect.objectContaining({ code: 'junie_protocol_invalid_result', fatal: true })
    }))
    expect(output.events.filter(item => item.type === 'stop')).toHaveLength(1)
  })

  it('accepts the descriptor-shaped errorCode usage array', async () => {
    const output = await parse(`${
      JSON.stringify({
        ...terminalResult(''),
        errorCode: [{
          model: 'anthropic/claude',
          calls: 2,
          cost: null,
          inputTokens: 10,
          cacheInputTokens: 0,
          cacheCreateTokens: null,
          outputTokens: 5
        }]
      })
    }\n`)

    expect(output.result).toEqual(expect.objectContaining({ didFatalError: false, didResult: true, didStop: true }))
  })

  it('invalidates a prior result when a malformed duplicate terminal arrives', async () => {
    const output = await parse([
      JSON.stringify(terminalResult()),
      JSON.stringify({ type: 'result', result: 'late', errorCode: null })
    ].join('\n'))

    expect(output.result).toEqual(expect.objectContaining({ didFatalError: true, didResult: true, didStop: true }))
    expect(output.events).toContainEqual(expect.objectContaining({
      type: 'error',
      data: expect.objectContaining({ code: 'junie_protocol_invalid_result', fatal: true })
    }))
    expect(output.events.filter(item => item.type === 'stop')).toHaveLength(1)
  })

  it('fails when resume emits a session id other than the exact cached id', async () => {
    const output = await parse(
      `${JSON.stringify({ type: 'session', sessionId: 'session-other' })}\n`,
      [2, 1, 19],
      { expectedSessionId: 'session-cached' }
    )

    expect(output.sessions).toEqual([])
    expect(output.result.sessionId).toBeUndefined()
    expect(output.events).toContainEqual(expect.objectContaining({
      type: 'error',
      data: expect.objectContaining({ code: 'junie_protocol_session_id_mismatch', fatal: true })
    }))
  })
})
