import { describe, expect, it, vi } from 'vitest'

import type { AdapterOutputEvent, AdapterQueryOptions } from '@oneworks/types'

import { GoosePermissionBridge } from '../src/runtime/interaction'

const request = (options: Array<{ kind: string; name: string; optionId: string }>) =>
  ({
    options,
    sessionId: 'native-session',
    toolCall: {
      kind: 'execute',
      name: 'developer__execute',
      rawInput: { command: 'echo secret' },
      title: 'Execute'
    }
  }) as never

const createBridge = (permissionMode?: AdapterQueryOptions['permissionMode']) => {
  const events: AdapterOutputEvent[] = []
  const bridge = new GoosePermissionBridge({
    permissionMode,
    runtime: 'server',
    sessionId: 'oneworks-session',
    type: 'create',
    onEvent: event => events.push(event)
  }, event => events.push(event))
  return { bridge, events }
}

describe('goose permission bridge', () => {
  it('deduplicates semantic choices and maps framework decisions to exact native ids', async () => {
    const { bridge, events } = createBridge()
    const pending = bridge.handle(request([
      { kind: 'allow_once', name: 'Allow native A', optionId: 'native-allow-a' },
      { kind: 'allow_once', name: 'Allow native B', optionId: 'native-allow-b' },
      { kind: 'allow_always', name: 'Allow session', optionId: 'native-allow-always' },
      { kind: 'reject_once', name: 'Deny', optionId: 'native-deny' },
      { kind: 'unknown', name: 'Unknown', optionId: 'native-unknown' }
    ]))
    const interaction = events.find(event => event.type === 'interaction_request')
    expect(interaction?.type).toBe('interaction_request')
    if (interaction?.type !== 'interaction_request') throw new Error('Missing interaction request')
    expect(interaction.data.payload.options?.map(option => option.value)).toEqual([
      'allow_once',
      'allow_session',
      'deny_once'
    ])
    expect(interaction.data.payload.question).not.toContain('echo secret')

    bridge.respond(interaction.data.id, 'allow_project')
    await expect(pending).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'native-allow-a' }
    })
  })

  it('does not escalate automatic modes when a once option is available', async () => {
    const allow = createBridge('bypassPermissions')
    await expect(allow.bridge.handle(request([
      { kind: 'allow_always', name: 'Always', optionId: 'native-always' },
      { kind: 'allow_once', name: 'Once', optionId: 'native-once' }
    ]))).resolves.toEqual({ outcome: { outcome: 'selected', optionId: 'native-once' } })

    const deny = createBridge('plan')
    await expect(deny.bridge.handle(request([
      { kind: 'reject_always', name: 'Always', optionId: 'native-reject-always' },
      { kind: 'reject_once', name: 'Once', optionId: 'native-reject-once' }
    ]))).resolves.toEqual({ outcome: { outcome: 'selected', optionId: 'native-reject-once' } })
  })

  it('cancels sparse unknown choices and settles pending requests once', async () => {
    const unknown = createBridge()
    await expect(unknown.bridge.handle(request([
      { kind: 'future_kind', name: 'Future', optionId: 'future-id' }
    ]))).resolves.toEqual({ outcome: { outcome: 'cancelled' } })
    expect(unknown.events).toEqual([])

    const pendingBridge = createBridge()
    const settle = vi.fn()
    const pending = pendingBridge.bridge.handle(request([
      { kind: 'allow_once', name: 'Once', optionId: 'native-once' }
    ])).then(settle)
    pendingBridge.bridge.cancelAll()
    pendingBridge.bridge.cancelAll()
    await pending
    expect(settle).toHaveBeenCalledOnce()
    expect(settle).toHaveBeenCalledWith({ outcome: { outcome: 'cancelled' } })
  })
})
