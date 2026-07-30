import { describe, expect, it } from 'vitest'

import {
  DEFAULT_SUPPORTED_PROTOCOL_RANGE,
  ProjectedRuntimeKnownErrorDataSchema,
  RuntimeActivationCommandSchema,
  RuntimeCommandDraftSchema,
  RuntimeCommandSchema,
  RuntimeEventSchema,
  RuntimeProjectConfigRecoveryGrantSchema,
  RuntimePublicErrorDataSchema,
  RuntimeSessionCommandEnvelopeSchema,
  RuntimeSessionCommandPayloadSchema,
  assertProtocolCompatible,
  getCurrentProtocolVersion,
  isRuntimeActivationCommand,
  isProtocolCompatible,
  parseJsonlLine,
  serializeJsonlRecord
} from '../src/index'
import type {
  RuntimeCommand,
  RuntimeCommandDraft,
  RuntimeSessionCommandEnvelope,
  RuntimeSessionCommandPayload
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
  it('keeps the server recovery grant a strict session-bound internal contract', () => {
    const grant = {
      schemaVersion: 1,
      type: 'project_config_recovery_grant',
      recoveryCommandId: 'cmd_recovery',
      idempotencyKey: 'key',
      sessionId: 'sess_123',
      attemptCommandId: 'cmd_attempt',
      failureEventId: 'evt_failure',
      failureEventSeq: 3,
      payloadDigest: 'a'.repeat(64),
      authorizationId: '11111111-1111-4111-8111-111111111111',
      commandIndex: 1,
      workspaceFolder: '/workspace/root',
      adapter: 'codex',
      runtimeAdapter: 'codex'
    }
    expect(RuntimeProjectConfigRecoveryGrantSchema.parse(grant)).toEqual(grant)
    expect(RuntimeProjectConfigRecoveryGrantSchema.safeParse({ ...grant, extra: true }).success).toBe(false)
    expect(RuntimeProjectConfigRecoveryGrantSchema.safeParse({ ...grant, sessionId: '' }).success).toBe(false)
    expect(RuntimeEventSchema.safeParse({
      protocolVersion: '1.0.0', id: 'evt_grant', seq: 4, ts: 4,
      sessionId: 'sess_123', type: 'project_config_recovery_granted',
      source: 'server:project-config-recovery', recoveryGrant: grant
    }).success).toBe(true)
    expect(RuntimeEventSchema.safeParse({
      protocolVersion: '1.0.0', id: 'evt_grant', seq: 4, ts: 4,
      sessionId: 'sess_123', type: 'project_config_recovery_granted',
      source: 'client', recoveryGrant: grant
    }).success).toBe(false)
    expect(RuntimeEventSchema.safeParse({
      protocolVersion: '1.0.0', id: 'evt_grant', seq: 4, ts: 4,
      sessionId: 'sess_123', type: 'project_config_recovery_granted',
      source: 'server:project-config-recovery', recoveryGrant: grant,
      arbitraryAuthority: true
    }).success).toBe(false)
    expect(RuntimeEventSchema.safeParse({
      protocolVersion: '1.0.0', id: 'evt_grant', seq: 4, ts: 4,
      sessionId: 'sess_123', type: 'project_config_recovery_granted'
    }).success).toBe(false)
  })

  it('validates supported runtime commands', () => {
    const result = RuntimeCommandSchema.safeParse({
      protocolVersion: '1.0.0',
      supportedProtocolRange: '^1.0.0',
      id: 'cmd_1',
      ts: 1777000000300,
      sessionId: 'sess_123',
      type: 'resume',
      priority: 20,
      source: 'ui',
      content: 'Continue verification.',
      effort: 'ultra',
      fastMode: true,
      projectConfigPolicy: 'global-only',
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
    expect(result.data).toEqual(expect.objectContaining({
      effort: 'ultra',
      fastMode: true,
      projectConfigPolicy: 'global-only'
    }))
  })

  it('preserves account, systemPrompt and updateConfiguredSkills through the public envelope', () => {
    const envelope = RuntimeSessionCommandEnvelopeSchema.parse({
      protocolVersion: '1.0.0', commandId: 'protocol-start', type: 'session.start',
      entity: 'dev', content: 'start', account: 'work',
      systemPrompt: 'system', updateConfiguredSkills: true
    })
    expect(envelope).toEqual(expect.objectContaining({
      account: 'work', systemPrompt: 'system', updateConfiguredSkills: true
    }))
    expect(RuntimeSessionCommandEnvelopeSchema.parse({
      protocolVersion: '1.0.0',
      commandId: 'protocol-start-payload',
      type: 'session.start',
      payload: {
        account: 'work',
        systemPrompt: 'system',
        updateConfiguredSkills: true
      }
    }).payload).toEqual({
      type: 'session.start',
      account: 'work',
      systemPrompt: 'system',
      updateConfiguredSkills: true
    })
  })

  it('exports compile-time discriminated start-only command contracts', () => {
    const startPayload = {
      type: 'session.start',
      account: 'work',
      systemPrompt: 'system',
      updateConfiguredSkills: true
    } satisfies RuntimeSessionCommandPayload
    const startEnvelope = {
      protocolVersion: '1.0.0',
      commandId: 'protocol-start-types',
      type: 'session.start',
      account: 'work',
      systemPrompt: 'system',
      updateConfiguredSkills: true,
      payload: startPayload
    } satisfies RuntimeSessionCommandEnvelope
    const storedStart = {
      protocolVersion: '1.0.0',
      id: 'cmd-start-types',
      ts: 1,
      sessionId: 'sess_1',
      type: 'start',
      priority: 20,
      source: 'runtime-protocol',
      account: 'work',
      systemPrompt: 'system',
      updateConfiguredSkills: true
    } satisfies RuntimeCommand
    const draftStart = {
      id: 'cmd-start-draft-types',
      sessionId: 'sess_1',
      type: 'start',
      source: 'runtime-protocol',
      account: 'work',
      systemPrompt: 'system',
      updateConfiguredSkills: true
    } satisfies RuntimeCommandDraft

    const invalidResumeEnvelope = {
      protocolVersion: '1.0.0',
      commandId: 'protocol-resume-types',
      type: 'session.resume',
      message: 'continue',
      // @ts-expect-error account is a session.start-only field.
      account: 'forbidden'
    } satisfies RuntimeSessionCommandEnvelope
    const invalidMessagePayload = {
      type: 'session.message',
      message: 'continue',
      // @ts-expect-error systemPrompt is a session.start-only field.
      systemPrompt: 'forbidden'
    } satisfies RuntimeSessionCommandPayload
    const invalidMessageEnvelope = {
      protocolVersion: '1.0.0',
      commandId: 'protocol-message-types',
      type: 'session.message',
      message: 'continue',
      // @ts-expect-error systemPrompt is a session.start-only field.
      systemPrompt: 'forbidden'
    } satisfies RuntimeSessionCommandEnvelope
    const invalidNestedResumeEnvelope = {
      protocolVersion: '1.0.0',
      commandId: 'protocol-nested-resume-types',
      type: 'session.resume',
      message: 'continue',
      payload: {
        type: 'session.resume',
        message: 'continue',
        // @ts-expect-error account is a nested session.start-only field.
        account: 'forbidden'
      }
    } satisfies RuntimeSessionCommandEnvelope
    const invalidControlEnvelope = {
      protocolVersion: '1.0.0',
      commandId: 'protocol-stop-types',
      type: 'session.stop',
      // @ts-expect-error updateConfiguredSkills is a session.start-only field.
      updateConfiguredSkills: true
    } satisfies RuntimeSessionCommandEnvelope
    const invalidNestedControlEnvelope = {
      protocolVersion: '1.0.0',
      commandId: 'protocol-nested-stop-types',
      type: 'session.stop',
      payload: {
        type: 'session.stop',
        // @ts-expect-error updateConfiguredSkills is a nested session.start-only field.
        updateConfiguredSkills: true
      }
    } satisfies RuntimeSessionCommandEnvelope
    const invalidStoredResume = {
      protocolVersion: '1.0.0',
      id: 'cmd-resume-types',
      ts: 1,
      sessionId: 'sess_1',
      type: 'resume',
      priority: 20,
      source: 'runtime-protocol',
      message: 'continue',
      // @ts-expect-error account is a stored start-only field.
      account: 'forbidden'
    } satisfies RuntimeCommand
    const invalidDraftControl = {
      id: 'cmd-stop-draft-types',
      sessionId: 'sess_1',
      type: 'stop',
      source: 'runtime-protocol',
      // @ts-expect-error systemPrompt is a stored start-only field.
      systemPrompt: 'forbidden'
    } satisfies RuntimeCommandDraft
    const invalidStoredMessage = {
      protocolVersion: '1.0.0',
      id: 'cmd-message-types',
      ts: 1,
      sessionId: 'sess_1',
      type: 'send_message',
      priority: 20,
      source: 'runtime-protocol',
      message: 'continue',
      // @ts-expect-error systemPrompt is a stored start-only field.
      systemPrompt: 'forbidden'
    } satisfies RuntimeCommand

    expect([
      startEnvelope,
      storedStart,
      draftStart,
      invalidResumeEnvelope,
      invalidMessagePayload,
      invalidMessageEnvelope,
      invalidNestedResumeEnvelope,
      invalidControlEnvelope,
      invalidNestedControlEnvelope,
      invalidStoredResume,
      invalidDraftControl,
      invalidStoredMessage
    ]).toHaveLength(12)
  })

  it.each(['account', 'systemPrompt', 'updateConfiguredSkills'] as const)(
    'rejects start-only %s on resume, message and control envelopes',
    (field) => {
      const value = field === 'updateConfiguredSkills' ? true : 'forbidden'
      for (const type of ['session.resume', 'session.message', 'session.stop'] as const) {
        expect(RuntimeSessionCommandPayloadSchema.safeParse({
          type,
          ...(type === 'session.resume' || type === 'session.message'
            ? { message: 'valid activation' }
            : {}),
          [field]: value
        }).success).toBe(false)
        expect(RuntimeSessionCommandEnvelopeSchema.safeParse({
          protocolVersion: '1.0.0',
          commandId: `protocol-${type}-${field}`,
          type,
          sessionId: 'sess_1',
          ...(type === 'session.resume' || type === 'session.message'
            ? { message: 'valid activation' }
            : {}),
          [field]: value
        }).success).toBe(false)
        expect(RuntimeSessionCommandEnvelopeSchema.safeParse({
          protocolVersion: '1.0.0',
          commandId: `protocol-payload-${type}-${field}`,
          type,
          sessionId: 'sess_1',
          payload: {
            ...(type === 'session.resume' || type === 'session.message'
              ? { message: 'valid activation' }
              : {}),
            [field]: value
          }
        }).success).toBe(false)
      }
    }
  )

  it.each(['account', 'systemPrompt', 'updateConfiguredSkills'] as const)(
    'rejects start-only %s on stored non-start commands',
    (field) => {
      const value = field === 'updateConfiguredSkills' ? true : 'forbidden'
      for (const type of ['resume', 'send_message', 'stop'] as const) {
        const activation = type === 'stop' ? {} : { message: 'valid activation' }
        expect(RuntimeCommandSchema.safeParse({
          protocolVersion: '1.0.0',
          id: `cmd-${type}-${field}`,
          ts: 1,
          sessionId: 'sess_1',
          type,
          priority: 20,
          source: 'runtime-protocol',
          ...activation,
          [field]: value
        }).success).toBe(false)
        expect(RuntimeCommandDraftSchema.safeParse({
          id: `cmd-draft-${type}-${field}`,
          sessionId: 'sess_1',
          type,
          source: 'runtime-protocol',
          ...activation,
          [field]: value
        }).success).toBe(false)
      }
    }
  )

  it('uses one activation predicate and validates replayable recovery content', () => {
    expect(['start', 'resume', 'send_message'].filter(type =>
      isRuntimeActivationCommand({ type })
    )).toEqual(['start', 'resume', 'send_message'])
    expect(isRuntimeActivationCommand({ type: 'submit_input' })).toBe(false)

    expect(RuntimeCommandSchema.parse({
      protocolVersion: '1.0.0',
      id: 'cmd_recovery',
      ts: 1,
      sessionId: 'sess_1',
      type: 'resume',
      priority: 20,
      source: 'web',
      content: 'visible prompt',
      message: 'visible prompt',
      contentItems: [{ type: 'file', path: '/tmp/context.md' }],
      runtimeContentItems: [
        { type: 'text', text: 'exact prompt' },
        { type: 'file', path: '/tmp/context.md' }
      ],
      messageDelivery: 'bridge',
      projectConfigPolicy: 'global-only'
    })).toEqual(expect.objectContaining({
      contentItems: [{ type: 'file', path: '/tmp/context.md' }],
      runtimeContentItems: [
        { type: 'text', text: 'exact prompt' },
        { type: 'file', path: '/tmp/context.md' }
      ]
    }))
  })

  it('rejects unknown project config recovery policies', () => {
    const result = RuntimeCommandSchema.safeParse({
      protocolVersion: '1.0.0',
      id: 'cmd_1',
      ts: 1,
      sessionId: 'sess_1',
      type: 'resume',
      priority: 20,
      source: 'web',
      projectConfigPolicy: 'ignore-everything'
    })

    expect(result.success).toBe(false)
  })

  it('accepts project config policy only on start or resume commands', () => {
    expect(RuntimeCommandSchema.safeParse({
      protocolVersion: '1.0.0',
      id: 'cmd-start-global-only',
      ts: 1,
      sessionId: 'sess_1',
      type: 'start',
      priority: 20,
      source: 'web',
      content: 'start with the recovery policy',
      projectConfigPolicy: 'global-only'
    }).success).toBe(true)
    expect(RuntimeCommandSchema.safeParse({
      protocolVersion: '1.0.0',
      id: 'cmd-send-global-only',
      ts: 1,
      sessionId: 'sess_1',
      type: 'send_message',
      priority: 20,
      source: 'web',
      content: 'this policy is not valid for messages',
      projectConfigPolicy: 'global-only'
    }).success).toBe(false)
  })

  it('validates authoritative failure-generation recovery command context', () => {
    const base = {
      protocolVersion: '1.0.0',
      id: 'cmd_recovery',
      ts: 1,
      sessionId: 'sess_1',
      type: 'resume',
      priority: 20,
      source: 'web',
      message: 'retry the exact failed prompt',
      projectConfigPolicy: 'global-only'
    }
    expect(RuntimeActivationCommandSchema.safeParse({
      ...base,
      recovery: {
        kind: 'codex-project-config',
        attemptCommandId: 'cmd_start',
        replacedActivationCommandId: 'cmd_start',
        failureEventId: 'evt_failure',
        failureEventSeq: 7,
        idempotencyKey: 'recovery-key',
        grantEventId: 'evt_grant',
        grantEventSeq: 8,
        grantAuthorizationId: '11111111-1111-4111-8111-111111111111',
        grantCommandIndex: 1
      }
    }).success).toBe(true)
    expect(RuntimeActivationCommandSchema.safeParse({
      ...base,
      recovery: {
        kind: 'codex-project-config',
        attemptCommandId: '',
        replacedActivationCommandId: '',
        failureEventId: '',
        failureEventSeq: -1,
        idempotencyKey: '',
        grantEventId: '',
        grantEventSeq: 0,
        grantAuthorizationId: 'invalid',
        grantCommandIndex: -1
      }
    }).success).toBe(false)
  })

  it('rejects empty and unsupported bridge activation payloads', () => {
    const base = {
      protocolVersion: '1.0.0',
      id: 'cmd_activation',
      ts: 1,
      sessionId: 'sess_1',
      priority: 20,
      source: 'web'
    }
    expect(RuntimeActivationCommandSchema.safeParse({
      ...base,
      type: 'resume',
      message: '   '
    }).success).toBe(false)
    expect(RuntimeActivationCommandSchema.safeParse({
      ...base,
      type: 'send_message',
      contentItems: [{ type: 'video', url: '/secret.mp4' }]
    }).success).toBe(false)
    expect(RuntimeActivationCommandSchema.safeParse({
      ...base,
      type: 'stop'
    }).success).toBe(false)
    expect(RuntimeActivationCommandSchema.safeParse({
      ...base,
      type: 'start',
      messageDelivery: 'bridge',
      runtimeContentItems: [
        { type: 'text', text: 'prompt' },
        { type: 'file', path: '/workspace/context.md' }
      ]
    }).success).toBe(true)
    for (const item of [
      { type: 'text', text: 'prompt' },
      { type: 'image', url: 'https://example.test/image.png', path: '/image.png' },
      { type: 'file', path: '/workspace/context.md', name: 'context.md', size: 10 },
      { type: 'tool_use', id: 'tool-1', name: 'read', input: { path: '/workspace/a' } },
      { type: 'tool_result', tool_use_id: 'tool-1', content: 'ok', is_error: false }
    ]) {
      expect(RuntimeActivationCommandSchema.safeParse({
        ...base,
        type: 'resume',
        contentItems: [item]
      }).success).toBe(true)
    }
    for (const item of [
      { type: 'text', text: 'prompt', secret: true },
      { type: 'tool_use', id: 'tool-1', name: 'read' },
      { type: 'tool_result', tool_use_id: 'tool-1' }
    ]) {
      expect(RuntimeActivationCommandSchema.safeParse({
        ...base,
        type: 'resume',
        contentItems: [item]
      }).success).toBe(false)
    }
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
    expect(RuntimeSessionCommandEnvelopeSchema.safeParse({
      protocolVersion: '1.0.0',
      commandId: 'cmd_2',
      type: 'session.start',
      payload: {
        entity: 'dev',
        message: 'Start delegated work',
        secret: 'must-not-cross-the-command-boundary'
      }
    }).success).toBe(false)
  })

  it('validates public resume activation content instead of accepting empty or unsupported input', () => {
    const base = {
      protocolVersion: '1.0.0',
      commandId: 'cmd_resume',
      sessionId: 'sess_1',
      type: 'session.resume'
    }
    expect(RuntimeSessionCommandEnvelopeSchema.safeParse({
      ...base,
      runtimeContentItems: [
        { type: 'text', text: 'continue' },
        { type: 'file', path: '/workspace/context.md' }
      ]
    }).success).toBe(true)
    expect(RuntimeSessionCommandEnvelopeSchema.safeParse(base).success).toBe(false)
    expect(RuntimeSessionCommandEnvelopeSchema.safeParse({
      ...base,
      contentItems: [{ type: 'video', url: '/workspace/secret.mp4' }]
    }).success).toBe(false)
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

  it('preserves explicit structured startup diagnostics', () => {
    const result = RuntimeEventSchema.safeParse({
      protocolVersion: '1.0.0',
      id: 'evt_failure',
      seq: 1,
      ts: 1777000000100,
      sessionId: 'sess_123',
      type: 'session_failed',
      error: 'Invalid project config.',
      code: 'codex_project_config_invalid',
      details: {
        adapter: 'codex-alias',
        runtimeAdapter: 'codex',
        configSource: 'project',
        configPath: '.codex/config.toml',
        workspaceSource: 'active-session-workspace',
        workspaceFolder: '/workspace/root',
        sessionId: 'sess_123',
        reason: 'wire_api is unsupported',
        line: 4,
        column: 7
      },
      fatal: true
    })

    expect(result.success).toBe(true)
    expect(result.data).toEqual(expect.objectContaining({
      code: 'codex_project_config_invalid',
      details: {
        adapter: 'codex-alias',
        runtimeAdapter: 'codex',
        configSource: 'project',
        configPath: '.codex/config.toml',
        workspaceSource: 'active-session-workspace',
        workspaceFolder: '/workspace/root',
        sessionId: 'sess_123',
        reason: 'wire_api is unsupported',
        line: 4,
        column: 7
      }
    }))
  })

  it('rejects malformed known diagnostics and arbitrary details on extensible errors', () => {
    const base = {
      protocolVersion: '1.0.0',
      id: 'evt_failure',
      seq: 1,
      ts: 1777000000100,
      sessionId: 'sess_123',
      type: 'session_failed',
      fatal: true
    }
    expect(RuntimeEventSchema.safeParse({
      ...base,
      code: 'codex_project_config_invalid',
      details: {
        configPath: '../../forged.toml',
        workspaceFolder: '/tmp/forged'
      }
    }).success).toBe(false)
    expect(RuntimeEventSchema.safeParse({
      ...base,
      code: 'future_adapter_failure',
      details: {
        futureField: true
      }
    }).success).toBe(false)
    expect(RuntimeEventSchema.safeParse({
      ...base,
      code: 'future_adapter_failure'
    }).success).toBe(true)
  })

  it('validates the projected known error contract consumed by clients', () => {
    const data = {
      code: 'codex_project_config_invalid',
      fatal: true,
      message: 'Invalid project config.',
      details: {
        adapter: 'codex',
        runtimeAdapter: 'codex',
        configSource: 'project',
        configPath: '.codex/config.toml',
        workspaceSource: 'active-session-workspace',
        workspaceFolder: '/workspace/root',
        sessionId: 'sess_123',
        reason: 'Invalid TOML syntax.',
        runtimeEventId: 'evt_failure',
        runtimeEventSeq: 3,
        line: 2,
        column: 1
      }
    }
    expect(ProjectedRuntimeKnownErrorDataSchema.safeParse(data).success).toBe(true)
    expect(ProjectedRuntimeKnownErrorDataSchema.safeParse({
      ...data,
      details: {
        ...data.details,
        runtimeEventSeq: -1
      }
    }).success).toBe(false)
  })

  it('does not let malformed known details fall through the public extensibility branch', () => {
    expect(RuntimePublicErrorDataSchema.safeParse({
      code: 'codex_project_config_invalid',
      fatal: true,
      message: 'Invalid project config.'
    }).success).toBe(false)
    expect(RuntimePublicErrorDataSchema.safeParse({
      code: 'future_runtime_error',
      fatal: true,
      message: 'Future runtime failure.'
    }).success).toBe(true)
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
