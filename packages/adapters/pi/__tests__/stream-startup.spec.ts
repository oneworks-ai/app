import { PassThrough } from 'node:stream'

import { describe, expect, it, vi } from 'vitest'

import type { AdapterCtx, AdapterOutputEvent, AdapterQueryOptions } from '@oneworks/types'

import { createStreamPiSession } from '#~/runtime/session/stream.js'

type StreamDependencies = NonNullable<Parameters<typeof createStreamPiSession>[3]>

const createCtx = (): AdapterCtx => ({
  ctxId: 'pi-stream-startup-test',
  cwd: '/workspace',
  env: {},
  cache: {
    get: async () => undefined,
    set: async () => ({ cachePath: '/unused/cache' })
  },
  logger: {
    stream: new PassThrough(),
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined
  },
  configs: [{}, undefined]
})

const createExitingDependencies = (exitOn: 'get_commands' | 'prompt'): StreamDependencies => {
  const exitListeners: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = []
  return {
    spawnProcess: () => ({ pid: 12345, killed: false, kill: () => true }),
    createClient: () => ({
      capturedStderr: '',
      close: async () => undefined,
      notify: async () => undefined,
      onError: () => () => false,
      onEvent: () => () => false,
      onExit: (listener: (code: number | null, signal: NodeJS.Signals | null) => void) => {
        exitListeners.push(listener)
        return () => false
      },
      request: async (command: { type: string }) => {
        if (command.type === 'get_state') {
          return { sessionId: 'session-clean-exit', model: { provider: 'mock', id: 'pi-test' } }
        }
        if (command.type !== exitOn) return { commands: [] }
        exitListeners.forEach(listener => listener(0, null))
        if (exitOn === 'get_commands') throw new Error('Pi process exited before responding.')
        return undefined
      }
    })
  } as unknown as StreamDependencies
}

const createOptions = (events: AdapterOutputEvent[], withDescription: boolean): AdapterQueryOptions => ({
  type: 'create',
  runtime: 'cli',
  sessionId: 'session-clean-exit',
  permissionMode: 'default',
  ...(withDescription ? { description: 'initial' } : {}),
  onEvent: event => events.push(event)
})

const base = {
  args: [],
  binaryPath: '/unused/fake-pi',
  model: 'mock/pi-test',
  spawnEnv: {},
  tools: []
}

describe('pi stream startup', () => {
  it('awaits client cleanup and preserves the startup RPC error', async () => {
    const startupError = new Error('Pi state request failed.')
    let finishClose: () => void = () => undefined
    const closeFinished = new Promise<void>(resolve => {
      finishClose = resolve
    })
    const close = vi.fn(async () => closeFinished)
    const dependencies = {
      spawnProcess: () => ({ pid: 12345, killed: false, kill: () => true }),
      createClient: () => ({
        capturedStderr: '',
        close,
        notify: async () => undefined,
        onError: () => () => false,
        onEvent: () => () => false,
        onExit: () => () => false,
        request: async () => {
          throw startupError
        }
      })
    } as unknown as StreamDependencies

    const startup = createStreamPiSession(base, createCtx(), createOptions([], false), dependencies)

    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())
    finishClose()
    await expect(startup).rejects.toBe(startupError)
  })

  it('rejects creation when Pi exits cleanly during the initial prompt request', async () => {
    const events: AdapterOutputEvent[] = []

    await expect(createStreamPiSession(
      base,
      createCtx(),
      createOptions(events, true),
      createExitingDependencies('prompt')
    )).rejects.toThrow('Pi exited before the active turn settled.')
    expect(events).toContainEqual(expect.objectContaining({
      type: 'error',
      data: expect.objectContaining({ fatal: true, message: 'Pi exited before the active turn settled.' })
    }))
    expect(events).toContainEqual(expect.objectContaining({
      type: 'exit',
      data: expect.objectContaining({ exitCode: 1 })
    }))
  })

  it('rejects an idle startup when Pi exits while commands are being discovered', async () => {
    const events: AdapterOutputEvent[] = []

    await expect(createStreamPiSession(
      base,
      createCtx(),
      createOptions(events, false),
      createExitingDependencies('get_commands')
    )).rejects.toThrow('Pi exited during session startup.')
    expect(events).toContainEqual({ type: 'exit', data: { exitCode: 0 } })
    expect(events.some(event => event.type === 'init')).toBe(false)
  })

  it('fails an active post-init turn when Pi exits cleanly before settling', async () => {
    const events: AdapterOutputEvent[] = []
    const exitListeners: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = []
    const dependencies = {
      spawnProcess: () => ({ pid: 12345, killed: false, kill: () => true }),
      createClient: () => ({
        capturedStderr: '',
        close: async () => undefined,
        notify: async () => undefined,
        onError: () => () => false,
        onEvent: () => () => false,
        onExit: (listener: (code: number | null, signal: NodeJS.Signals | null) => void) => {
          exitListeners.push(listener)
          return () => false
        },
        request: async (command: { type: string }) => {
          if (command.type === 'get_state') {
            return { sessionId: 'session-clean-exit', model: { provider: 'mock', id: 'pi-test' } }
          }
          if (command.type === 'get_commands') return { commands: [] }
          exitListeners.forEach(listener => listener(0, null))
          return undefined
        }
      })
    } as unknown as StreamDependencies
    const session = await createStreamPiSession(base, createCtx(), createOptions(events, false), dependencies)

    session.emit({ type: 'message', content: [{ type: 'text', text: 'Continue' }] })

    await vi.waitFor(() => {
      expect(events).toContainEqual(expect.objectContaining({
        type: 'error',
        data: expect.objectContaining({ fatal: true, message: 'Pi exited before the active turn settled.' })
      }))
      expect(events).toContainEqual(expect.objectContaining({
        type: 'exit',
        data: expect.objectContaining({ exitCode: 1 })
      }))
    })
  })

  it('closes with exit code one when a Pi interaction response cannot be sent', async () => {
    const events: AdapterOutputEvent[] = []
    let onEvent: ((event: Record<string, unknown>) => void) | undefined
    const close = vi.fn(async () => undefined)
    const dependencies = {
      spawnProcess: () => ({ pid: 12345, killed: false, kill: () => true }),
      createClient: () => ({
        capturedStderr: '',
        close,
        notify: async () => {
          throw new Error('Pi RPC write failed')
        },
        onError: () => () => false,
        onEvent: (listener: (event: Record<string, unknown>) => void) => {
          onEvent = listener
          return () => false
        },
        onExit: () => () => false,
        request: async (command: { type: string }) =>
          command.type === 'get_state'
            ? { sessionId: 'session-clean-exit', model: { provider: 'mock', id: 'pi-test' } }
            : { commands: [] }
      })
    } as unknown as StreamDependencies
    const session = await createStreamPiSession(base, createCtx(), createOptions(events, false), dependencies)

    onEvent?.({ type: 'extension_ui_request', id: 'input-1', method: 'input', title: 'Name?' })
    session.respondInteraction?.('pi-ui:input-1', 'Ada')

    await vi.waitFor(() => {
      expect(events).toContainEqual(expect.objectContaining({
        type: 'error',
        data: expect.objectContaining({ fatal: true, message: 'Pi RPC write failed' })
      }))
      expect(events).toContainEqual(expect.objectContaining({
        type: 'exit',
        data: expect.objectContaining({ exitCode: 1 })
      }))
      expect(close).toHaveBeenCalledOnce()
    })
  })

  it('fails and closes an idle Pi turn when image preprocessing cannot read its file', async () => {
    const events: AdapterOutputEvent[] = []
    const close = vi.fn(async () => undefined)
    const dependencies = {
      spawnProcess: () => ({ pid: 12345, killed: false, kill: () => true }),
      createClient: () => ({
        capturedStderr: '',
        close,
        notify: async () => undefined,
        onError: () => () => false,
        onEvent: () => () => false,
        onExit: () => () => false,
        request: async (command: { type: string }) =>
          command.type === 'get_state'
            ? { sessionId: 'session-clean-exit', model: { provider: 'mock', id: 'pi-test' } }
            : { commands: [] }
      })
    } as unknown as StreamDependencies
    const session = await createStreamPiSession(base, createCtx(), createOptions(events, false), dependencies)

    session.emit({
      type: 'message',
      content: [{
        type: 'image',
        url: 'file:///missing-pi-image.png',
        path: '/missing-pi-image.png',
        mimeType: 'image/png'
      }]
    })

    await vi.waitFor(() => {
      expect(events).toContainEqual(expect.objectContaining({
        type: 'operation',
        data: expect.objectContaining({ type: 'operation_failed', operationId: 'pi-turn' })
      }))
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'error', data: expect.objectContaining({ fatal: true }) })
      )
      expect(events).toContainEqual(expect.objectContaining({
        type: 'exit',
        data: expect.objectContaining({ exitCode: 1 })
      }))
      expect(close).toHaveBeenCalledOnce()
    })
  })

  it('keeps an active Pi turn alive when steer image preprocessing fails', async () => {
    const events: AdapterOutputEvent[] = []
    let onEvent: ((event: Record<string, unknown>) => void) | undefined
    const close = vi.fn(async () => undefined)
    const dependencies = {
      spawnProcess: () => ({ pid: 12345, killed: false, kill: () => true }),
      createClient: () => ({
        capturedStderr: '',
        close,
        notify: async () => undefined,
        onError: () => () => false,
        onEvent: (listener: (event: Record<string, unknown>) => void) => {
          onEvent = listener
          return () => false
        },
        onExit: () => () => false,
        request: async (command: { type: string }) =>
          command.type === 'get_state'
            ? { sessionId: 'session-clean-exit', model: { provider: 'mock', id: 'pi-test' } }
            : { commands: [] }
      })
    } as unknown as StreamDependencies
    const session = await createStreamPiSession(base, createCtx(), createOptions(events, false), dependencies)

    onEvent?.({ type: 'agent_start' })
    session.emit({
      type: 'message',
      content: [{
        type: 'image',
        url: 'file:///missing-pi-image.png',
        path: '/missing-pi-image.png',
        mimeType: 'image/png'
      }]
    })

    await vi.waitFor(() =>
      expect(events).toContainEqual(expect.objectContaining({
        type: 'error',
        data: expect.objectContaining({ fatal: false })
      }))
    )
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'exit' }))
    expect(close).not.toHaveBeenCalled()
  })

  it('does not report a fatal error when stopping races pending image preprocessing', async () => {
    const events: AdapterOutputEvent[] = []
    const close = vi.fn(async () => undefined)
    const dependencies = {
      spawnProcess: () => ({ pid: 12345, killed: false, kill: () => true }),
      createClient: () => ({
        capturedStderr: '',
        close,
        notify: async () => undefined,
        onError: () => () => false,
        onEvent: () => () => false,
        onExit: () => () => false,
        request: async (command: { type: string }) =>
          command.type === 'get_state'
            ? { sessionId: 'session-clean-exit', model: { provider: 'mock', id: 'pi-test' } }
            : { commands: [] }
      })
    } as unknown as StreamDependencies
    const session = await createStreamPiSession(base, createCtx(), createOptions(events, false), dependencies)

    session.emit({
      type: 'message',
      content: [{
        type: 'image',
        url: 'file:///missing-pi-image.png',
        path: '/missing-pi-image.png',
        mimeType: 'image/png'
      }]
    })
    session.stop?.()

    await new Promise(resolve => setTimeout(resolve, 25))
    expect(events).not.toContainEqual(expect.objectContaining({
      type: 'error',
      data: expect.objectContaining({ fatal: true })
    }))
    expect(close).toHaveBeenCalledOnce()
  })
})
