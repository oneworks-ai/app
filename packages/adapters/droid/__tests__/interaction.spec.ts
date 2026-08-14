import { AskUserResultSchema } from '@factory/droid-sdk'
import { describe, expect, it, vi } from 'vitest'

import type { AdapterOutputEvent, AdapterQueryOptions } from '@oneworks/types'

import { DroidInteractionBridge } from '../src/runtime/interaction'
import type { FactoryRequest } from '../src/runtime/protocol/types'

const baseRequest = (method: string, params: Record<string, unknown>): FactoryRequest => ({
  jsonrpc: '2.0',
  type: 'request',
  factoryApiVersion: '1.0.0',
  factoryProtocolVersion: '1.151.0',
  id: `request-${method}`,
  method,
  params
})

const options = (permissionMode: AdapterQueryOptions['permissionMode'] = 'default'): AdapterQueryOptions => ({
  type: 'create',
  runtime: 'cli',
  sessionId: 'session-1',
  permissionMode,
  onEvent: () => undefined
})

const createClient = () => ({
  respond: vi.fn(async (_id: string, _result: unknown) => undefined),
  respondError: vi.fn(async (
    _id: string,
    _error: { code: number; data?: unknown; message: string }
  ) => undefined)
})

const sparseArray = <T>(length: number, index: number, value: T) => {
  const result: T[] = []
  result.length = length
  result[index] = value
  return result
}

describe('droid interaction bridge', () => {
  it('maps normalized permission decisions back to exact native values', async () => {
    const client = createClient()
    const events: AdapterOutputEvent[] = []
    const bridge = new DroidInteractionBridge(
      client as never,
      options(),
      event => events.push(event),
      vi.fn()
    )
    bridge.handle(baseRequest('droid.request_permission', {
      toolUses: [{ toolUse: { type: 'tool_use', id: 'tool-1', name: 'Read', input: {} } }],
      options: [{ label: 'Proceed once', value: 'proceed_once' }, { label: 'Cancel', value: 'cancel' }]
    }))
    const permission = events.at(-1)
    expect(permission).toEqual(expect.objectContaining({ type: 'interaction_request' }))
    if (permission?.type !== 'interaction_request') throw new Error('missing permission interaction')
    expect(permission.data.payload.options).toEqual([
      expect.objectContaining({ value: 'allow_once' }),
      expect.objectContaining({ value: 'deny_once' })
    ])
    await bridge.respond(permission.data.id, 'allow_once')
    expect(client.respond).toHaveBeenCalledWith('request-droid.request_permission', {
      selectedOption: 'proceed_once'
    })
  })

  it.each(
    [
      ['allow_once', 'proceed_once'],
      ['allow_session', 'proceed_always'],
      ['allow_project', 'project-allow'],
      ['deny_once', 'cancel'],
      ['deny_session', 'session-deny'],
      ['deny_project', 'project-deny'],
      ['cancel', 'cancel']
    ] as const
  )('maps server decision %s to native option %s once', async (decision, nativeValue) => {
    const client = createClient()
    const events: AdapterOutputEvent[] = []
    const bridge = new DroidInteractionBridge(
      client as never,
      options(),
      event => events.push(event),
      vi.fn()
    )
    bridge.handle(baseRequest('droid.request_permission', {
      options: [
        { label: 'Once', value: 'proceed_once' },
        { label: 'Duplicate once', value: 'proceed_once' },
        { label: 'Session', value: 'proceed_always' },
        { label: 'Project', value: 'project-allow', action: 'allow', scope: 'project' },
        { label: 'Cancel', value: 'cancel' },
        { label: 'Deny session', value: 'session-deny', action: 'deny', scope: 'session' },
        { label: 'Deny project', value: 'project-deny', action: 'deny', scope: 'project' },
        { label: 'Unknown', value: 'future-unknown' }
      ]
    }))
    const permission = events.at(-1)
    if (permission?.type !== 'interaction_request') throw new Error('missing permission interaction')
    expect(permission.data.payload.options?.map(option => option.value)).toEqual([
      'allow_once',
      'allow_session',
      'allow_project',
      'deny_once',
      'deny_session',
      'deny_project'
    ])
    await bridge.respond(permission.data.id, decision)
    await bridge.respond(permission.data.id, decision)
    expect(client.respond).toHaveBeenCalledWith('request-droid.request_permission', {
      selectedOption: nativeValue
    })
    expect(client.respond).toHaveBeenCalledTimes(1)
  })

  it('asks native multi-question requests sequentially and sends no fabricated answers', async () => {
    const client = createClient()
    const events: AdapterOutputEvent[] = []
    const bridge = new DroidInteractionBridge(
      client as never,
      options(),
      event => events.push(event),
      vi.fn()
    )
    bridge.handle(baseRequest('droid.ask_user', {
      toolCallId: 'tool-2',
      questions: [
        { index: 1, topic: 'Scope', question: 'Which package?', options: [] },
        { index: 2, topic: 'Test', question: 'Which suite?', options: [] }
      ]
    }))
    const first = events.at(-1)
    if (first?.type !== 'interaction_request') throw new Error('missing ask-user interaction')
    expect(first.data.payload.question).toContain('Which package?')
    await bridge.respond(first.data.id, 'adapter-droid')
    expect(client.respond).not.toHaveBeenCalled()
    const second = events.at(-1)
    if (second?.type !== 'interaction_request') throw new Error('missing second ask-user interaction')
    expect(second.data.payload.question).toContain('Which suite?')
    await bridge.respond(second.data.id, 'vitest')
    expect(client.respond).toHaveBeenCalledWith('request-droid.ask_user', {
      answers: [
        { index: 1, question: 'Which package?', answer: 'adapter-droid' },
        { index: 2, question: 'Which suite?', answer: 'vitest' }
      ]
    })
    expect(AskUserResultSchema.safeParse(client.respond.mock.calls.at(-1)?.[1]).success).toBe(true)
  })

  it('encodes multi-select options in official CLI order and appends one custom answer', async () => {
    const client = createClient()
    const events: AdapterOutputEvent[] = []
    const bridge = new DroidInteractionBridge(
      client as never,
      options(),
      event => events.push(event),
      vi.fn()
    )
    bridge.handle(baseRequest('droid.ask_user', {
      toolCallId: 'tool-multi',
      questions: [{
        index: 1,
        topic: 'Targets',
        question: 'Which targets?',
        options: ['runtime', 'history'],
        multiSelect: true
      }]
    }))
    const interaction = events.at(-1)
    if (interaction?.type !== 'interaction_request') throw new Error('missing multi-select interaction')
    await bridge.respond(interaction.data.id, ['history', 'custom target', 'runtime'])
    expect(client.respond).toHaveBeenCalledWith('request-droid.ask_user', {
      answers: [{ index: 1, question: 'Which targets?', answer: 'runtime, history, custom target' }]
    })
    expect(AskUserResultSchema.safeParse(client.respond.mock.calls.at(-1)?.[1]).success).toBe(true)
  })

  it.each([
    { label: 'multiple custom', value: ['custom-a', 'custom-b'], message: 'at most one custom' },
    {
      label: 'sparse',
      value: sparseArray(2, 1, 'runtime'),
      message: 'dense string array'
    }
  ])('rejects $label multi-select answers before the SDK wire', async ({ value, message }) => {
    const client = createClient()
    const events: AdapterOutputEvent[] = []
    const bridge = new DroidInteractionBridge(client as never, options(), event => events.push(event), vi.fn())
    bridge.handle(baseRequest('droid.ask_user', {
      toolCallId: 'tool-invalid-answer',
      questions: [{
        index: 1,
        topic: 'Targets',
        question: 'Which targets?',
        options: ['runtime', 'history'],
        multiSelect: true
      }]
    }))
    const interaction = events.at(-1)
    if (interaction?.type !== 'interaction_request') throw new Error('missing multi-select interaction')
    await expect(bridge.respond(interaction.data.id, value)).rejects.toThrow(message)
    expect(client.respond).not.toHaveBeenCalled()
    expect(client.respondError).toHaveBeenCalledWith(
      'request-droid.ask_user',
      expect.objectContaining({ code: -32602 })
    )
  })

  it('preserves one duplicate-looking value as the official custom answer', async () => {
    const client = createClient()
    const events: AdapterOutputEvent[] = []
    const bridge = new DroidInteractionBridge(client as never, options(), event => events.push(event), vi.fn())
    bridge.handle(baseRequest('droid.ask_user', {
      toolCallId: 'tool-duplicate-custom',
      questions: [{
        index: 1,
        topic: 'Targets',
        question: 'Which targets?',
        options: ['runtime', 'history'],
        multiSelect: true
      }]
    }))
    const interaction = events.at(-1)
    if (interaction?.type !== 'interaction_request') throw new Error('missing multi-select interaction')
    await bridge.respond(interaction.data.id, ['runtime', 'runtime'])
    expect(client.respond).toHaveBeenCalledWith('request-droid.ask_user', {
      answers: [{ index: 1, question: 'Which targets?', answer: 'runtime, runtime' }]
    })
  })

  it('keeps a multi-select custom answer named cancel distinct from explicit cancellation', async () => {
    const client = createClient()
    const events: AdapterOutputEvent[] = []
    const bridge = new DroidInteractionBridge(client as never, options(), event => events.push(event), vi.fn())
    bridge.handle(baseRequest('droid.ask_user', {
      toolCallId: 'tool-cancel-custom',
      questions: [{
        index: 1,
        topic: 'Targets',
        question: 'Which targets?',
        options: ['runtime'],
        multiSelect: true
      }]
    }))
    const interaction = events.at(-1)
    if (interaction?.type !== 'interaction_request') throw new Error('missing multi-select interaction')
    await bridge.respond(interaction.data.id, ['cancel'])
    expect(client.respond).toHaveBeenCalledWith('request-droid.ask_user', {
      answers: [{ index: 1, question: 'Which targets?', answer: 'cancel' }]
    })
  })

  it('maps an empty multi-select array to SDK cancellation exactly once', async () => {
    const client = createClient()
    const events: AdapterOutputEvent[] = []
    const bridge = new DroidInteractionBridge(client as never, options(), event => events.push(event), vi.fn())
    bridge.handle(baseRequest('droid.ask_user', {
      toolCallId: 'tool-explicit-cancel',
      questions: [{
        index: 1,
        topic: 'Targets',
        question: 'Which targets?',
        options: ['runtime'],
        multiSelect: true
      }]
    }))
    const interaction = events.at(-1)
    if (interaction?.type !== 'interaction_request') throw new Error('missing multi-select interaction')
    await bridge.respond(interaction.data.id, [])
    await bridge.respond(interaction.data.id, [])
    expect(client.respond).toHaveBeenCalledWith('request-droid.ask_user', { cancelled: true, answers: [] })
    expect(client.respond).toHaveBeenCalledTimes(1)
  })

  it('fails closed before presentation for duplicate native options and sparse questions', () => {
    const duplicateClient = createClient()
    const duplicateEvents: AdapterOutputEvent[] = []
    const duplicateBridge = new DroidInteractionBridge(
      duplicateClient as never,
      options(),
      event => duplicateEvents.push(event),
      vi.fn()
    )
    duplicateBridge.handle(baseRequest('droid.ask_user', {
      toolCallId: 'tool-duplicate-options',
      questions: [{
        index: 1,
        topic: 'Targets',
        question: 'Which targets?',
        options: ['Runtime', ' runtime '],
        multiSelect: true
      }]
    }))
    expect(duplicateEvents).toEqual([])
    expect(duplicateClient.respondError).toHaveBeenCalledWith(
      'request-droid.ask_user',
      expect.objectContaining({ code: -32602 })
    )

    const sparseClient = createClient()
    const sparseEvents: AdapterOutputEvent[] = []
    const sparseBridge = new DroidInteractionBridge(
      sparseClient as never,
      options(),
      event => sparseEvents.push(event),
      vi.fn()
    )
    sparseBridge.handle(baseRequest('droid.ask_user', {
      toolCallId: 'tool-sparse',
      questions: sparseArray(2, 1, { index: 2, topic: 'Second', question: 'Second?', options: [] })
    }))
    expect(sparseEvents).toEqual([])
    expect(sparseClient.respondError).toHaveBeenCalledWith(
      'request-droid.ask_user',
      expect.objectContaining({ code: -32602 })
    )
  })

  it('auto-resolves bypass permissions using a native proceed outcome', () => {
    const client = createClient()
    const events: AdapterOutputEvent[] = []
    const bridge = new DroidInteractionBridge(
      client as never,
      options('bypassPermissions'),
      event => events.push(event),
      vi.fn()
    )
    bridge.handle(baseRequest('droid.request_permission', {
      toolUses: [],
      options: [{ label: 'Auto', value: 'proceed_auto_run' }, { label: 'Cancel', value: 'cancel' }]
    }))
    expect(events).toEqual([])
    expect(client.respond).toHaveBeenCalledWith('request-droid.request_permission', {
      selectedOption: 'proceed_auto_run'
    })
  })

  it('denies dontAsk permissions without surfacing an interaction', () => {
    const client = createClient()
    const events: AdapterOutputEvent[] = []
    const bridge = new DroidInteractionBridge(
      client as never,
      options('dontAsk'),
      event => events.push(event),
      vi.fn()
    )
    bridge.handle(baseRequest('droid.request_permission', {
      toolUses: [],
      options: [{ label: 'Always', value: 'proceed_always' }, { label: 'Cancel', value: 'cancel' }]
    }))
    expect(events).toEqual([])
    expect(client.respond).toHaveBeenCalledWith('request-droid.request_permission', {
      selectedOption: 'cancel'
    })
  })

  it('cancels every outstanding permission and ask-user request during interrupt/close cleanup', async () => {
    const client = createClient()
    const bridge = new DroidInteractionBridge(client as never, options(), () => undefined, vi.fn())
    bridge.handle(baseRequest('droid.request_permission', {
      toolUses: [],
      options: [{ label: 'Cancel', value: 'cancel' }]
    }))
    bridge.handle(baseRequest('droid.ask_user', {
      toolCallId: 'tool-2',
      questions: [{ index: 1, topic: 'Question', question: 'Continue?', options: [] }]
    }))
    await bridge.cancelAll()
    await bridge.cancelAll()
    await bridge.respond('droid-permission:request-droid.request_permission', 'allow_once')
    await bridge.respond('droid-question:request-droid.ask_user:1', 'yes')
    expect(client.respond).toHaveBeenCalledWith('request-droid.request_permission', { selectedOption: 'cancel' })
    expect(client.respond).toHaveBeenCalledWith('request-droid.ask_user', { cancelled: true, answers: [] })
    expect(client.respond).toHaveBeenCalledTimes(2)
  })
})
