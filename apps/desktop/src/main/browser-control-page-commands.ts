import { randomBytes } from 'node:crypto'

import type { WebContents } from 'electron'

import type { BrowserControlPageCommand, BrowserControlPageCommandRequest } from '@oneworks/types'

import { BROWSER_CONTROL_PAGE_COMMAND_CHANNEL } from './constants'

const defaultCommandTimeoutMs = 10_000
const mutationCommandTypes = new Set<BrowserControlPageCommand['type']>([
  'close',
  'duplicate',
  'move',
  'set_device_mode',
  'set_devtools',
  'show'
])

interface PendingPageCommand {
  hostWebContentsId: number
  reject: (error: Error) => void
  resolve: (result: unknown) => void
}

interface PageCommandCompletion {
  error?: { code?: string; message: string }
  ok: boolean
  requestId: string
  result?: unknown
}

const pendingCommands = new Map<string, PendingPageCommand>()
const hostMutationTails = new Map<number, Promise<void>>()

const commandError = (message: string, code: string, statusCode = 409) =>
  Object.assign(new Error(message), { code, statusCode })

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const parseCompletion = (input: unknown): PageCommandCompletion => {
  if (!isRecord(input) || typeof input.requestId !== 'string' || input.requestId.trim() === '') {
    throw commandError('A browser page command request id is required.', 'INVALID_PAGE_COMMAND_COMPLETION', 400)
  }
  if (typeof input.ok !== 'boolean') {
    throw commandError('A browser page command completion status is required.', 'INVALID_PAGE_COMMAND_COMPLETION', 400)
  }
  if (input.ok) return { ok: true, requestId: input.requestId, result: input.result }
  const error = isRecord(input.error) ? input.error : undefined
  if (typeof error?.message !== 'string' || error.message.trim() === '') {
    throw commandError(
      'A failed browser page command must include an error message.',
      'INVALID_PAGE_COMMAND_COMPLETION',
      400
    )
  }
  return {
    error: {
      ...(typeof error.code === 'string' && error.code.trim() !== '' ? { code: error.code } : {}),
      message: error.message
    },
    ok: false,
    requestId: input.requestId
  }
}

const sendImmediately = async (
  host: WebContents,
  input: Omit<BrowserControlPageCommandRequest, 'requestId'>,
  timeoutMs: number
): Promise<unknown> => {
  if (host.isDestroyed()) {
    throw commandError('The internal browser host window is unavailable.', 'WORKSPACE_WINDOW_UNAVAILABLE')
  }

  const requestId = randomBytes(12).toString('hex')
  return await new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      pendingCommands.delete(requestId)
      host.off('destroyed', handleDestroyed)
      clearTimeout(timer)
      callback()
    }
    const handleDestroyed = () =>
      finish(() =>
        reject(commandError(
          'The internal browser host window closed before applying the command.',
          'WORKSPACE_WINDOW_UNAVAILABLE'
        ))
      )
    const timer = setTimeout(() =>
      finish(() =>
        reject(commandError(
          'Timed out waiting for the internal browser page UI.',
          'PAGE_COMMAND_TIMEOUT',
          408
        ))
      ), timeoutMs)
    pendingCommands.set(requestId, {
      hostWebContentsId: host.id,
      reject: error => finish(() => reject(error)),
      resolve: result => finish(() => resolve(result))
    })
    host.once('destroyed', handleDestroyed)
    try {
      host.send(BROWSER_CONTROL_PAGE_COMMAND_CHANNEL, { ...input, requestId })
    } catch (error) {
      finish(() =>
        reject(commandError(
          error instanceof Error ? error.message : 'Failed to send the internal browser page command.',
          'PAGE_COMMAND_SEND_FAILED'
        ))
      )
    }
  })
}

const enqueueHostMutation = async <T>(hostWebContentsId: number, action: () => Promise<T>): Promise<T> => {
  const previous = hostMutationTails.get(hostWebContentsId) ?? Promise.resolve()
  const result = previous.catch(() => undefined).then(action)
  const tail = result.then(
    () => undefined,
    () => undefined
  )
  hostMutationTails.set(hostWebContentsId, tail)
  void tail.finally(() => {
    if (hostMutationTails.get(hostWebContentsId) === tail) hostMutationTails.delete(hostWebContentsId)
  })
  return await result
}

export const sendBrowserControlPageCommand = async (
  host: WebContents,
  input: Omit<BrowserControlPageCommandRequest, 'requestId'>,
  options: { timeoutMs?: number } = {}
): Promise<unknown> => {
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? Math.max(1, Math.round(options.timeoutMs ?? defaultCommandTimeoutMs))
    : defaultCommandTimeoutMs
  const send = async () => await sendImmediately(host, input, timeoutMs)
  return mutationCommandTypes.has(input.command.type)
    ? await enqueueHostMutation(host.id, send)
    : await send()
}

export const completeBrowserControlPageCommand = (
  hostWebContentsId: number,
  input: unknown
) => {
  const completion = parseCompletion(input)
  const pending = pendingCommands.get(completion.requestId)
  if (pending == null) return { accepted: false }
  if (pending.hostWebContentsId !== hostWebContentsId) {
    throw commandError('The browser page command belongs to another window.', 'PAGE_COMMAND_OWNER_MISMATCH', 403)
  }

  if (completion.ok) pending.resolve(completion.result)
  else {
    pending.reject(commandError(
      completion.error?.message || 'The internal browser page command failed.',
      completion.error?.code || 'PAGE_COMMAND_FAILED'
    ))
  }
  return { accepted: true }
}

export type SendBrowserControlPageCommand = (
  host: WebContents,
  input: {
    command: BrowserControlPageCommand
    pageId: string
    panelPageId: string
    sessionId?: string
  }
) => Promise<unknown>
