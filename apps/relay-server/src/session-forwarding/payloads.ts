import { Buffer } from 'node:buffer'

export interface RelayForwardingPayload {
  message: string
  payloadSize: number
  requestId?: string
}

export interface RelayForwardingResultPayload {
  result: unknown
  resultSize: number
}

const payloads = new Map<string, RelayForwardingPayload>()
const results = new Map<string, RelayForwardingResultPayload>()

export const measurePayloadSize = (message: string) => Buffer.byteLength(message, 'utf8')

const serializeJsonPayload = (value: unknown) => JSON.stringify(value) ?? 'null'

export const measureJsonPayloadSize = (value: unknown) => Buffer.byteLength(serializeJsonPayload(value), 'utf8')

export const rememberForwardingPayload = (
  jobId: string,
  input: {
    message: string
    requestId?: string
  }
) => {
  const payload: RelayForwardingPayload = {
    message: input.message,
    payloadSize: measurePayloadSize(input.message),
    requestId: input.requestId
  }
  payloads.set(jobId, payload)
  return payload
}

export const getForwardingPayload = (jobId: string) => payloads.get(jobId)

export const consumeForwardingPayload = (jobId: string) => {
  const payload = payloads.get(jobId)
  payloads.delete(jobId)
  return payload
}

export const clearForwardingPayload = (jobId: string) => {
  payloads.delete(jobId)
}

export const rememberForwardingResult = (jobId: string, result: unknown) => {
  const payload: RelayForwardingResultPayload = {
    result,
    resultSize: measureJsonPayloadSize(result)
  }
  results.set(jobId, payload)
  return payload
}

export const consumeForwardingResult = (jobId: string) => {
  const result = results.get(jobId)
  results.delete(jobId)
  return result
}

export const hasForwardingResult = (jobId: string) => results.has(jobId)

export const clearForwardingResult = (jobId: string) => {
  results.delete(jobId)
}
