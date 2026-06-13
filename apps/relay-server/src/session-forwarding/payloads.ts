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

export interface RelayForwardingPayloadRepository {
  clearPayload: (jobId: string) => Promise<void>
  clearResult: (jobId: string) => Promise<void>
  consumePayload: (jobId: string) => Promise<RelayForwardingPayload | undefined>
  consumeResult: (jobId: string) => Promise<RelayForwardingResultPayload | undefined>
  getPayload: (jobId: string) => Promise<RelayForwardingPayload | undefined>
  hasResult: (jobId: string) => Promise<boolean>
  rememberPayload: (
    jobId: string,
    input: {
      message: string
      requestId?: string
    }
  ) => Promise<RelayForwardingPayload>
  rememberResult: (jobId: string, result: unknown) => Promise<RelayForwardingResultPayload>
}

export const measurePayloadSize = (message: string) => Buffer.byteLength(message, 'utf8')

const serializeJsonPayload = (value: unknown) => JSON.stringify(value) ?? 'null'

export const measureJsonPayloadSize = (value: unknown) => Buffer.byteLength(serializeJsonPayload(value), 'utf8')

export const createMemoryForwardingPayloadRepository = (): RelayForwardingPayloadRepository => ({
  clearPayload: async (jobId: string) => {
    payloads.delete(jobId)
  },
  clearResult: async (jobId: string) => {
    results.delete(jobId)
  },
  consumePayload: async (jobId: string) => {
    const payload = payloads.get(jobId)
    payloads.delete(jobId)
    return payload
  },
  consumeResult: async (jobId: string) => {
    const result = results.get(jobId)
    results.delete(jobId)
    return result
  },
  getPayload: async (jobId: string) => payloads.get(jobId),
  hasResult: async (jobId: string) => results.has(jobId),
  rememberPayload: async (jobId, input) => {
    const payload: RelayForwardingPayload = {
      message: input.message,
      payloadSize: measurePayloadSize(input.message),
      requestId: input.requestId
    }
    payloads.set(jobId, payload)
    return payload
  },
  rememberResult: async (jobId, result) => {
    const payload: RelayForwardingResultPayload = {
      result,
      resultSize: measureJsonPayloadSize(result)
    }
    results.set(jobId, payload)
    return payload
  }
})

let forwardingPayloadRepository: RelayForwardingPayloadRepository = createMemoryForwardingPayloadRepository()

export const setForwardingPayloadRepository = (repository: RelayForwardingPayloadRepository | undefined) => {
  forwardingPayloadRepository = repository ?? createMemoryForwardingPayloadRepository()
}

export const rememberForwardingPayload = async (
  jobId: string,
  input: {
    message: string
    requestId?: string
  }
) => await forwardingPayloadRepository.rememberPayload(jobId, input)

export const getForwardingPayload = async (jobId: string) => await forwardingPayloadRepository.getPayload(jobId)

export const consumeForwardingPayload = async (jobId: string) => await forwardingPayloadRepository.consumePayload(jobId)

export const clearForwardingPayload = async (jobId: string) => {
  await forwardingPayloadRepository.clearPayload(jobId)
}

export const rememberForwardingResult = async (jobId: string, result: unknown) =>
  await forwardingPayloadRepository.rememberResult(jobId, result)

export const consumeForwardingResult = async (jobId: string) => await forwardingPayloadRepository.consumeResult(jobId)

export const hasForwardingResult = async (jobId: string) => await forwardingPayloadRepository.hasResult(jobId)

export const clearForwardingResult = async (jobId: string) => {
  await forwardingPayloadRepository.clearResult(jobId)
}
