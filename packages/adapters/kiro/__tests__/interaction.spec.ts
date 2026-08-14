import { describe, expect, it, vi } from 'vitest'

import type { AdapterOutputEvent, AdapterQueryOptions } from '@oneworks/types'

import type { KiroAcpClient } from '../src/protocol/client'
import type { AcpMessage } from '../src/protocol/types'
import { KiroInteractionBridge } from '../src/runtime/interaction'

const permissionMessage = (options: unknown, id = 'permission-1'): AcpMessage => ({
  jsonrpc: '2.0',
  id,
  method: 'session/request_permission',
  params: {
    options,
    toolCall: { kind: 'edit', title: 'write_file', rawInput: { secret: 'must-not-reach-errors' } }
  }
})

const createBridge = (permissionMode: AdapterQueryOptions['permissionMode'] = 'default') => {
  const respond = vi.fn().mockResolvedValue(undefined)
  const events: AdapterOutputEvent[] = []
  const errors: unknown[] = []
  const bridge = new KiroInteractionBridge(
    { respond } as unknown as KiroAcpClient,
    {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-permission',
      permissionMode,
      onEvent: event => events.push(event)
    },
    event => events.push(event),
    error => errors.push(error)
  )
  return { bridge, errors, events, respond }
}

const options = {
  once: { optionId: 'native-allow-once', name: 'Allow once', kind: 'allow_once' },
  always: { optionId: 'native-allow-always', name: 'Always allow', kind: 'allow_always' },
  reject: { optionId: 'native-reject-once', name: 'Reject once', kind: 'reject_once' }
}

describe('kiro native permission option scope', () => {
  it.each(['dontAsk', 'bypassPermissions'] as const)(
    'auto-allows %s only through the actual request-scoped option without UI',
    async (permissionMode) => {
      const test = createBridge(permissionMode)
      expect(test.bridge.handle(permissionMessage([options.always, options.once, options.reject]))).toBe(true)
      await vi.waitFor(() => expect(test.respond).toHaveBeenCalledTimes(1))
      expect(test.respond).toHaveBeenCalledWith('permission-1', {
        outcome: { outcome: 'selected', optionId: 'native-allow-once' }
      })
      expect(test.events).toEqual([])
      expect(test.errors).toEqual([])
      expect(JSON.stringify(test.respond.mock.calls)).not.toContain('reject')
      expect(JSON.stringify(test.respond.mock.calls)).not.toContain('allow-always')
    }
  )

  it.each(
    [
      ['dontAsk', [options.always]],
      ['bypassPermissions', [options.reject]],
      ['acceptEdits', [options.always]]
    ] as const
  )('fails %s visibly instead of escalating a sparse native option set', async (permissionMode, sparse) => {
    const test = createBridge(permissionMode)
    test.bridge.handle(permissionMessage([...sparse]))
    await vi.waitFor(() => expect(test.errors).toHaveLength(1))
    expect(test.respond).toHaveBeenCalledTimes(1)
    expect(test.respond).toHaveBeenCalledWith('permission-1', { outcome: { outcome: 'cancelled' } })
    expect(test.events).toEqual([])
    expect(String(test.errors[0])).toContain('request-scoped allow option')
    expect(String(test.errors[0])).not.toContain('must-not-reach-errors')
  })

  it('derives localized presentation semantics from exact native IDs without adapter-owned copy', async () => {
    const test = createBridge('default')
    test.bridge.handle(permissionMessage([options.always, options.once, options.reject]))
    const interaction = test.events[0]
    expect(interaction?.type).toBe('interaction_request')
    if (interaction?.type !== 'interaction_request') throw new Error('Expected interaction')
    expect(interaction.data.payload.options).toEqual([
      expect.objectContaining({
        label: 'Always allow',
        value: 'native-allow-always',
        permission: { adapterLabel: 'Kiro', semantic: 'allow_persistent' }
      }),
      expect.objectContaining({
        label: 'Allow once',
        value: 'native-allow-once',
        permission: { adapterLabel: 'Kiro', semantic: 'allow_once' }
      }),
      expect.objectContaining({
        label: 'Reject once',
        value: 'native-reject-once',
        permission: { adapterLabel: 'Kiro', semantic: 'deny_once' }
      })
    ])
    expect(interaction.data.payload.question).toBe('write_file')
    expect(JSON.stringify(interaction.data.payload)).not.toContain('允许 Kiro')
    expect(JSON.stringify(interaction.data.payload)).not.toContain('this request only')
    await test.bridge.respond(interaction.data.id, 'native-allow-once')
    await test.bridge.respond(interaction.data.id, 'native-allow-always')
    expect(test.respond).toHaveBeenCalledTimes(1)
    expect(test.respond).toHaveBeenCalledWith('permission-1', {
      outcome: { outcome: 'selected', optionId: 'native-allow-once' }
    })
  })

  it.each(
    [
      ['only allow_always rejects an allow_once fallback', [options.always], 'allow_once', 'cancelled'],
      ['remembered allow_session uses allow_once', [options.once], 'allow_session', 'native-allow-once'],
      ['remembered allow_project uses allow_once', [options.once], 'allow_project', 'native-allow-once'],
      ['remembered allow fails closed without allow_once', [options.always], 'allow_session', 'cancelled'],
      ['reject-only maps deny_once exactly', [options.reject], 'deny_once', 'native-reject-once'],
      ['remembered deny_session uses reject_once', [options.reject], 'deny_session', 'native-reject-once'],
      ['remembered deny_project uses reject_once', [options.reject], 'deny_project', 'native-reject-once'],
      [
        'remembered deny fails closed without reject_once',
        [{
          optionId: 'native-reject-always',
          name: 'Always reject',
          kind: 'reject_always'
        }],
        'deny_project',
        'cancelled'
      ],
      ['cancel never aliases a reject option', [options.reject], 'cancel', 'cancelled']
    ] as const
  )('%s', async (_label, sparse, decision, expected) => {
    const test = createBridge('plan')
    test.bridge.handle(permissionMessage([...sparse]))
    const interaction = test.events[0]
    if (interaction?.type !== 'interaction_request') throw new Error('Expected interaction')
    await test.bridge.respond(interaction.data.id, decision)
    expect(test.respond).toHaveBeenCalledTimes(1)
    expect(test.respond.mock.calls[0]?.[1]).toEqual(
      expected === 'cancelled'
        ? { outcome: { outcome: 'cancelled' } }
        : { outcome: { outcome: 'selected', optionId: expected } }
    )
  })

  it.each(
    [
      [options.always, 'native-allow-always'],
      [{ optionId: 'native-reject-always', name: 'Always reject', kind: 'reject_always' }, 'native-reject-always']
    ] as const
  )('selects persistent native option %s only by its exact current-response ID', async (nativeOption, optionId) => {
    const test = createBridge('default')
    test.bridge.handle(permissionMessage([nativeOption]))
    const interaction = test.events[0]
    if (interaction?.type !== 'interaction_request') throw new Error('Expected interaction')
    await test.bridge.respond(interaction.data.id, optionId)
    expect(test.respond).toHaveBeenCalledTimes(1)
    expect(test.respond).toHaveBeenCalledWith('permission-1', {
      outcome: { outcome: 'selected', optionId }
    })
  })

  it('normalizes documented kind aliases, retains unknown choices, and de-duplicates option IDs', async () => {
    const test = createBridge('default')
    test.bridge.handle(permissionMessage([
      { optionId: 'once', name: 'Once', kind: 'AllowOnce' },
      { optionId: 'once', name: 'Duplicate', kind: 'allow_always' },
      { optionId: 'unknown', name: 'Ask Kiro', kind: 'future_scope' },
      { name: 'Missing ID', kind: 'allow_once' }
    ]))
    const interaction = test.events[0]
    if (interaction?.type !== 'interaction_request') throw new Error('Expected interaction')
    expect(interaction.data.payload.options).toEqual([
      expect.objectContaining({
        label: 'Once',
        value: 'once',
        permission: { adapterLabel: 'Kiro', semantic: 'allow_once' }
      }),
      expect.objectContaining({
        label: 'Ask Kiro',
        value: 'unknown',
        permission: {
          adapterLabel: 'Kiro',
          nativeLabel: 'Ask Kiro',
          semantic: 'native_unknown'
        }
      })
    ])
    await test.bridge.respond(interaction.data.id, 'unknown')
    expect(test.respond).toHaveBeenCalledWith('permission-1', {
      outcome: { outcome: 'selected', optionId: 'unknown' }
    })
  })

  it('settles missing options and pending cancellation exactly once', async () => {
    const missing = createBridge('default')
    missing.bridge.handle(permissionMessage([]))
    await vi.waitFor(() => expect(missing.errors).toHaveLength(1))
    expect(missing.respond).toHaveBeenCalledTimes(1)
    expect(missing.events).toEqual([])

    const pending = createBridge('default')
    pending.bridge.handle(permissionMessage([options.once]))
    await pending.bridge.cancelAll()
    await pending.bridge.cancelAll()
    expect(pending.respond).toHaveBeenCalledTimes(1)
    expect(pending.respond).toHaveBeenCalledWith('permission-1', { outcome: { outcome: 'cancelled' } })
  })
})
