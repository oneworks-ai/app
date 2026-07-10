import { describe, expect, it } from 'vitest'

import {
  DEFAULT_SUPPORTED_PROTOCOL_RANGE,
  RuntimeCommandSchema,
  RuntimeEventSchema,
  RuntimeSessionCommandEnvelopeSchema,
  assertProtocolCompatible,
  getCurrentProtocolVersion,
  isProtocolCompatible,
  parseJsonlLine,
  serializeJsonlRecord
} from '../src/index'

describe('runtime protocol versioning', () => {
  it('uses the package version as the current protocol version', async () => {
    const packageJson = await import('../package.json')
    const [major] = packageJson.default.version.split('.')

    expect(getCurrentProtocolVersion()).toBe(packageJson.default.version)
    expect(DEFAULT_SUPPORTED_PROTOCOL_RANGE).toBe(`^${major}.0.0`)
  })

  it('accepts compatible patch and minor versions within the same major', () => {
    expect(isProtocolCompatible('1.0.1', '^1.0.0')).toBe(true)
    expect(isProtocolCompatible('1.2.0', '^1.0.0')).toBe(true)
  })

  it('rejects incompatible major versions and invalid versions', () => {
    expect(isProtocolCompatible('2.0.0', '^1.0.0')).toBe(false)
    expect(isProtocolCompatible('not-semver', '^1.0.0')).toBe(false)

    expect(() => assertProtocolCompatible('not-semver')).toThrow(
      /Invalid runtime protocol version/
    )
    expect(() => assertProtocolCompatible('2.0.0', '^1.0.0')).toThrow(
      /not compatible/
    )
  })
})

describe('runtime JSONL helpers', () => {
  it('preserves unknown additive fields when parsing and serializing', () => {
    const parsed = parseJsonlLine(
      '{"protocolVersion":"1.0.0","id":"evt_1","seq":1,"ts":1,"sessionId":"sess_1","type":"message","customField":{"nested":true}}',
      { schema: RuntimeEventSchema }
    )

    expect(parsed.customField).toEqual({ nested: true })

    const serialized = serializeJsonlRecord(parsed, { schema: RuntimeEventSchema })
    expect(JSON.parse(serialized)).toEqual(expect.objectContaining({
      customField: { nested: true }
    }))
    expect(serialized.endsWith('\n')).toBe(true)
  })
})

describe('runtime command schema', () => {
  it('validates supported runtime commands', () => {
    const result = RuntimeCommandSchema.safeParse({
      protocolVersion: '1.0.0',
      supportedProtocolRange: '^1.0.0',
      id: 'cmd_1',
      ts: 1777000000300,
      sessionId: 'sess_123',
      type: 'send_message',
      priority: 20,
      source: 'ui',
      content: 'Continue verification.',
      effort: 'ultra',
      fastMode: true,
      commandId: 'cmd_parent',
      causedByCommandId: 'cmd_root',
      inReplyToCommandId: 'cmd_prev',
      parentEventId: 'evt_prev',
      runId: 'run_1',
      operationId: 'op_1',
      roomId: 'room_1',
      memberKey: 'entity:dev',
      visibility: 'room'
    })

    expect(result.success).toBe(true)
    expect(result.data).toEqual(expect.objectContaining({ effort: 'ultra', fastMode: true }))
  })

  it('rejects commands with invalid protocol versions or missing required fields', () => {
    expect(
      RuntimeCommandSchema.safeParse({
        protocolVersion: '1',
        id: 'cmd_1',
        ts: 1,
        sessionId: 'sess_1',
        type: 'send_message',
        priority: 20,
        source: 'ui'
      }).success
    ).toBe(false)

    expect(
      RuntimeCommandSchema.safeParse({
        protocolVersion: '1.0.0',
        id: 'cmd_1',
        ts: 1,
        sessionId: 'sess_1',
        type: 'send_message',
        priority: 20
      }).success
    ).toBe(false)
  })
})

describe('runtime session command envelope schema', () => {
  it('accepts payload fields for CLI protocol mode compatibility', () => {
    const result = RuntimeSessionCommandEnvelopeSchema.safeParse({
      protocolVersion: '1.0.0',
      commandId: 'cmd_1',
      type: 'session.start',
      payload: {
        entity: 'dev',
        message: 'Start delegated work'
      }
    })

    expect(result.success).toBe(true)
  })
})

describe('runtime event schema', () => {
  it('validates supported runtime events', () => {
    const result = RuntimeEventSchema.safeParse({
      protocolVersion: '1.0.0',
      id: 'evt_1',
      seq: 1,
      ts: 1777000000100,
      sessionId: 'sess_123',
      type: 'message',
      role: 'assistant',
      content: 'I will verify the flow.',
      commandId: 'cmd_1',
      causedByCommandId: 'cmd_1',
      inReplyToCommandId: 'cmd_1',
      parentEventId: 'evt_0',
      runId: 'run_1',
      operationId: 'op_1',
      roomId: 'room_1',
      memberKey: 'entity:dev',
      visibility: 'room'
    })

    expect(result.success).toBe(true)
  })

  it('rejects events with invalid protocol versions or unsupported types', () => {
    expect(
      RuntimeEventSchema.safeParse({
        protocolVersion: '1.0',
        id: 'evt_1',
        seq: 1,
        ts: 1,
        sessionId: 'sess_1',
        type: 'message'
      }).success
    ).toBe(false)

    expect(
      RuntimeEventSchema.safeParse({
        protocolVersion: '1.0.0',
        id: 'evt_1',
        seq: 1,
        ts: 1,
        sessionId: 'sess_1',
        type: 'unknown_event'
      }).success
    ).toBe(false)
  })
})
