import { describe, expect, it, vi } from 'vitest'

import type { AdapterCtx, AdapterOutputEvent, AdapterQueryOptions } from '@oneworks/types'

import { PI_PERMISSION_ALLOW, PI_PERMISSION_PREFIX } from '#~/runtime/common/permission.js'
import type { PiRpcClient } from '#~/runtime/protocol/client.js'
import type { PiRpcEvent } from '#~/runtime/protocol/types.js'
import { PiInteractionBridge } from '#~/runtime/session/interaction.js'

describe('pi interaction bridge', () => {
  it('remembers an allowed tool for the rest of the session', async () => {
    const notify = vi.fn(async () => undefined)
    const events: AdapterOutputEvent[] = []
    const bridge = new PiInteractionBridge(
      { notify } as unknown as PiRpcClient,
      {
        configs: [{ permissions: {} }, undefined],
        logger: { warn: vi.fn() }
      } as unknown as AdapterCtx,
      {
        sessionId: 'session-pi-permission',
        permissionMode: 'default'
      } as AdapterQueryOptions,
      event => events.push(event)
    )
    const permissionTitle = `${PI_PERMISSION_PREFIX}${
      JSON.stringify({
        toolName: 'bash',
        input: { command: 'git status' }
      })
    }`

    bridge.handle({
      type: 'extension_ui_request',
      id: 'permission-1',
      method: 'select',
      title: permissionTitle,
      options: ['Allow', 'Deny']
    } as PiRpcEvent)

    const interaction = events.find(event => event.type === 'interaction_request')
    expect(interaction).toEqual(expect.objectContaining({
      type: 'interaction_request',
      data: expect.objectContaining({
        payload: expect.objectContaining({ kind: 'permission', sessionId: 'session-pi-permission' })
      })
    }))
    if (interaction?.type !== 'interaction_request') throw new Error('Expected a permission interaction')
    bridge.respond(interaction.data.id, 'allow_session')

    await vi.waitFor(() =>
      expect(notify).toHaveBeenCalledWith({
        type: 'extension_ui_response',
        id: 'permission-1',
        value: PI_PERMISSION_ALLOW
      })
    )

    bridge.handle({
      type: 'extension_ui_request',
      id: 'permission-2',
      method: 'select',
      title: permissionTitle,
      options: ['Allow', 'Deny']
    } as PiRpcEvent)

    await vi.waitFor(() =>
      expect(notify).toHaveBeenCalledWith({
        type: 'extension_ui_response',
        id: 'permission-2',
        value: PI_PERMISSION_ALLOW
      })
    )
    expect(events.filter(event => event.type === 'interaction_request')).toHaveLength(1)
  })

  it('pairs extension status updates by statusKey instead of fire-and-forget request ids', () => {
    const events: AdapterOutputEvent[] = []
    const bridge = new PiInteractionBridge(
      { notify: vi.fn() } as unknown as PiRpcClient,
      { configs: [{}, undefined], logger: { warn: vi.fn() } } as unknown as AdapterCtx,
      { sessionId: 'session-status' } as AdapterQueryOptions,
      event => events.push(event)
    )

    bridge.handle({
      type: 'extension_ui_request',
      id: 'rpc-start',
      method: 'setStatus',
      statusKey: 'review',
      statusText: 'Reviewing'
    })
    bridge.handle({
      type: 'extension_ui_request',
      id: 'rpc-clear',
      method: 'setStatus',
      statusKey: 'review'
    })

    expect(events).toEqual([
      expect.objectContaining({
        type: 'operation',
        data: expect.objectContaining({ operationId: 'pi-extension-review', type: 'operation_started' })
      }),
      expect.objectContaining({
        type: 'operation',
        data: expect.objectContaining({ operationId: 'pi-extension-review', type: 'operation_completed' })
      })
    ])
  })

  it('treats an empty generic interaction response as a cancellation', async () => {
    const notify = vi.fn(async () => undefined)
    const events: AdapterOutputEvent[] = []
    const bridge = new PiInteractionBridge(
      { notify } as unknown as PiRpcClient,
      { configs: [{}, undefined], logger: { warn: vi.fn() } } as unknown as AdapterCtx,
      { sessionId: 'session-question' } as AdapterQueryOptions,
      event => events.push(event)
    )

    bridge.handle({ type: 'extension_ui_request', id: 'question-1', method: 'input', title: 'Name?' })
    const interaction = events.find(event => event.type === 'interaction_request')
    if (interaction?.type !== 'interaction_request') throw new Error('Expected a generic interaction')
    bridge.respond(interaction.data.id, [])

    await vi.waitFor(() => {
      expect(notify).toHaveBeenCalledWith({ type: 'extension_ui_response', id: 'question-1', cancelled: true })
    })
  })

  it('preserves editor whitespace and an empty input value', async () => {
    const notify = vi.fn(async () => undefined)
    const events: AdapterOutputEvent[] = []
    const bridge = new PiInteractionBridge(
      { notify } as unknown as PiRpcClient,
      { configs: [{}, undefined], logger: { warn: vi.fn() } } as unknown as AdapterCtx,
      { sessionId: 'session-question' } as AdapterQueryOptions,
      event => events.push(event)
    )

    bridge.handle({ type: 'extension_ui_request', id: 'editor-1', method: 'editor', title: 'Edit?' })
    const editorInteraction = events.find(event => event.type === 'interaction_request')
    if (editorInteraction?.type !== 'interaction_request') throw new Error('Expected an editor interaction')
    bridge.respond(editorInteraction.data.id, '  first line\nsecond line  \n')

    bridge.handle({ type: 'extension_ui_request', id: 'input-1', method: 'input', title: 'Name?' })
    const inputInteraction = events.at(-1)
    if (inputInteraction?.type !== 'interaction_request') throw new Error('Expected an input interaction')
    bridge.respond(inputInteraction.data.id, '')

    await vi.waitFor(() => {
      expect(notify).toHaveBeenCalledWith({
        type: 'extension_ui_response',
        id: 'editor-1',
        value: '  first line\nsecond line  \n'
      })
      expect(notify).toHaveBeenCalledWith({
        type: 'extension_ui_response',
        id: 'input-1',
        value: ''
      })
    })
  })

  it('reports a fatal error when sending a generic interaction response fails', async () => {
    const notify = vi.fn(async () => {
      throw new Error('Pi RPC write failed')
    })
    const events: AdapterOutputEvent[] = []
    const onSendError = vi.fn()
    const bridge = new PiInteractionBridge(
      { notify } as unknown as PiRpcClient,
      { configs: [{}, undefined], logger: { warn: vi.fn() } } as unknown as AdapterCtx,
      { sessionId: 'session-question' } as AdapterQueryOptions,
      event => events.push(event),
      onSendError
    )

    bridge.handle({ type: 'extension_ui_request', id: 'question-1', method: 'input', title: 'Name?' })
    const interaction = events.find(event => event.type === 'interaction_request')
    if (interaction?.type !== 'interaction_request') throw new Error('Expected a generic interaction')
    bridge.respond(interaction.data.id, 'Ada')

    await vi.waitFor(() =>
      expect(onSendError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Pi RPC write failed' }))
    )
  })

  it('reports a fatal error when an automatic configured permission response fails', async () => {
    const notify = vi.fn(async () => {
      throw new Error('Pi automatic permission write failed')
    })
    const events: AdapterOutputEvent[] = []
    const onSendError = vi.fn()
    const bridge = new PiInteractionBridge(
      { notify } as unknown as PiRpcClient,
      {
        configs: [{ permissions: { allow: ['Bash'] } }, undefined],
        logger: { warn: vi.fn() }
      } as unknown as AdapterCtx,
      { sessionId: 'session-permission' } as AdapterQueryOptions,
      event => events.push(event),
      onSendError
    )

    bridge.handle({
      type: 'extension_ui_request',
      id: 'permission-1',
      method: 'select',
      title: `${PI_PERMISSION_PREFIX}${JSON.stringify({ toolName: 'bash', input: {} })}`,
      options: ['Allow', 'Deny']
    } as PiRpcEvent)

    await vi.waitFor(() =>
      expect(onSendError).toHaveBeenCalledWith(expect.objectContaining({
        message: 'Pi automatic permission write failed'
      }))
    )
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'interaction_request' }))
  })
})
