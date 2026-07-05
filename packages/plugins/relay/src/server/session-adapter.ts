import type {
  RelayForwardingJob,
  RelayForwardingJobStatusUpdate,
  RelayLocalSession,
  RelayLocalSessionAdapter,
  RelayLocalSessionSnapshot,
  RelayLocalSessionSubmitInput
} from './session-types.js'
import { isRecord, toString } from './utils.js'

const toOptionalNumber = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

const toOptionalString = (value: unknown) => {
  const text = toString(value)
  return text === '' ? undefined : text
}

export const normalizeLocalRelaySession = (value: unknown): RelayLocalSession | undefined => {
  if (!isRecord(value)) return undefined
  const id = toOptionalString(value.id)
  if (id == null) return undefined
  return {
    id,
    userId: toOptionalString(value.userId),
    title: toOptionalString(value.title),
    status: toOptionalString(value.status),
    createdAt: toOptionalNumber(value.createdAt),
    updatedAt: toOptionalNumber(value.updatedAt),
    messageCount: toOptionalNumber(value.messageCount),
    model: toOptionalString(value.model),
    adapter: toOptionalString(value.adapter),
    workspaceFolder: toOptionalString(value.workspaceFolder)
  }
}

export const createLocalRelaySessionSnapshot = async (
  adapter: Pick<RelayLocalSessionAdapter, 'listSessions'>,
  deviceId: string
): Promise<RelayLocalSessionSnapshot> => ({
  deviceId,
  sessions: (await adapter.listSessions())
    .map(normalizeLocalRelaySession)
    .filter((session): session is RelayLocalSession => session != null),
  updatedAt: new Date().toISOString()
})

export const buildSessionSubmitInput = (job: RelayForwardingJob): RelayLocalSessionSubmitInput => ({
  jobId: job.id,
  sessionId: job.sessionId,
  message: job.payload?.message ?? '',
  mode: job.mode,
  requestId: job.requestId
})

const normalizeErrorCode = (value: unknown) => {
  const raw = isRecord(value) && typeof value.code === 'string' && value.code.trim() !== ''
    ? value.code
    : value instanceof Error && /^[\w.:-]+$/.test(value.message.trim())
    ? value.message
    : value instanceof Error && value.name !== '' && value.name !== 'Error'
    ? value.name
    : 'forwarding_failed'
  const code = raw.trim().replace(/[^\w.:-]/g, '_').slice(0, 80)
  return code === '' ? 'forwarding_failed' : code
}

export const submitLocalRelaySessionMessage = async (
  adapter: Pick<RelayLocalSessionAdapter, 'submitMessage'>,
  job: RelayForwardingJob
): Promise<RelayForwardingJobStatusUpdate> => {
  if (job.payload?.message == null || job.payload.message.trim() === '') {
    return {
      status: 'failed',
      errorCode: 'payload_missing'
    }
  }
  try {
    const result = await adapter.submitMessage(buildSessionSubmitInput(job))
    return {
      result,
      status: 'succeeded'
    }
  } catch (error) {
    return {
      status: 'failed',
      errorCode: normalizeErrorCode(error)
    }
  }
}
