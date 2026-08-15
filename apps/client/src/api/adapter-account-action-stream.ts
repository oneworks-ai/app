import type {
  AdapterManageAccountOptions,
  AdapterManageAccountProgressEvent,
  AdapterManageAccountResult
} from '@oneworks/types'
import { ApiError, createApiUrl, fetchApiResponse, jsonHeaders } from './base'

type StreamEvent =
  | { type: 'progress'; phase: NonNullable<AdapterManageAccountProgressEvent['phase']> }
  | { type: 'result'; result: AdapterManageAccountResult }
  | { type: 'error'; error: { code: string; details?: unknown; message: string; status: number } }
const LIMIT = 64 * 1024
const PHASES = new Set(['preparing', 'awaiting-authorization', 'verifying', 'saving'])
const record = (v: unknown): v is Record<string, unknown> => v != null && typeof v === 'object' && !Array.isArray(v)

const toResponseError = async (response: Response) => {
  let payload: unknown
  try { payload = JSON.parse(await response.text()) as unknown } catch { payload = undefined }
  const error = record(payload) && payload.success === false && record(payload.error) ? payload.error : undefined
  return new ApiError(response.status, {
    code: typeof error?.code === 'string' ? error.code : 'request_failed',
    message: typeof error?.message === 'string' ? error.message : `Request failed with status ${response.status}`,
    ...(error?.details !== undefined ? { details: error.details } : {})
  })
}

const parse = (frame: string): StreamEvent | undefined => {
  const data = frame.split(/\r?\n/u).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart())
    .join('\n')
  if (!data) return undefined
  const value = JSON.parse(data) as unknown
  if (!record(value)) throw new Error('Adapter account action returned an invalid stream event.')
  if (value.type === 'progress' && typeof value.phase === 'string' && PHASES.has(value.phase)) {
    return value as StreamEvent
  }
  if (value.type === 'result' && record(value.result)) return value as StreamEvent
  if (
    value.type === 'error' && record(value.error) && typeof value.error.code === 'string' &&
    typeof value.error.message === 'string' && typeof value.error.status === 'number'
  ) return value as StreamEvent
  throw new Error('Adapter account action returned an invalid stream event.')
}

export const streamAdapterAccountAction = async (params: {
  adapter: string
  options: Pick<AdapterManageAccountOptions, 'action' | 'account' | 'creditId' | 'model' | 'operationId' | 'refresh'>
  onProgress: (event: Pick<AdapterManageAccountProgressEvent, 'phase'>) => void
  signal?: AbortSignal
}) => {
  const url = createApiUrl(`/api/adapters/${encodeURIComponent(params.adapter)}/accounts/actions`)
  url.searchParams.set('stream', 'true')
  const response = await fetchApiResponse(url, {
    method: 'POST',
    timeoutMs: 0,
    headers: { ...jsonHeaders, Accept: 'text/event-stream' },
    body: JSON.stringify(params.options),
    signal: params.signal
  })
  if (!response.ok) throw await toResponseError(response)
  if (response.body == null) throw new Error('Adapter account action did not return a response stream.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result: AdapterManageAccountResult | undefined
  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      if (buffer.length > LIMIT) throw new Error('Adapter account action returned an oversized progress event.')
      const frames = buffer.replaceAll('\r\n', '\n').split('\n\n')
      buffer = done ? '' : frames.pop() ?? ''
      for (const frame of frames) {
        const event = parse(frame)
        if (event?.type === 'progress') params.onProgress({ phase: event.phase })
        else if (event?.type === 'result') result = event.result
        else if (event?.type === 'error') throw new ApiError(event.error.status, event.error)
      }
      if (done) break
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined)
    throw error
  } finally {
    reader.releaseLock()
  }
  if (result == null) throw new Error('Adapter account action ended before returning a result.')
  return result
}
