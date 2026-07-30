import { createHash } from 'node:crypto'

import {
  CODEX_PROJECT_CONFIG_INVALID_ERROR_CODE,
  CodexProjectConfigInvalidDetailsSchema,
  RuntimeActivationCommandSchema,
  RuntimeProjectConfigRecoveryGrantEventSchema,
  RuntimeProjectConfigRecoveryGrantSchema,
  isRuntimeActivationCommand
} from '@oneworks/runtime-protocol'
import type { RuntimeProjectConfigRecoveryGrant } from '@oneworks/runtime-protocol'
import type { RuntimeCommand, RuntimeEvent } from './types'

/** Server-written authorization.  A recovery-shaped command alone is never a grant. */
export type ProjectConfigRecoveryGrant = RuntimeProjectConfigRecoveryGrant
export interface ProjectConfigRecoveryAuthority {
  adapter: string
  runtimeAdapter: 'codex'
  sessionId: string
  workspaceFolder: string
}
export type ProjectConfigRecoveryClassification = 'authentic' | 'inert' | 'superseded'

export interface ProjectConfigRecoveryGrantRecord {
  eventId: string
  eventSeq: number
  grant: ProjectConfigRecoveryGrant
}

export const projectConfigRecoveryPayloadDigest = (command: RuntimeCommand) => {
  const payload = canonicalRuntimeActivationPayload(command)
  return payload == null ? undefined : createHash('sha256').update(payload).digest('hex')
}

export const projectConfigRecoveryGrantRecordsFromEvents = (
  events: RuntimeEvent[]
): ProjectConfigRecoveryGrantRecord[] => events.flatMap(event => {
  const parsedEvent = RuntimeProjectConfigRecoveryGrantEventSchema.safeParse(event)
  if (!parsedEvent.success) return []
  const parsed = RuntimeProjectConfigRecoveryGrantSchema.safeParse(parsedEvent.data.recoveryGrant)
  return parsed.success && parsed.data.sessionId === parsedEvent.data.sessionId
    ? [{
        eventId: parsedEvent.data.id,
        eventSeq: parsedEvent.data.seq,
        grant: parsed.data
      }]
    : []
})

export const projectConfigRecoveryGrantsFromEvents = (events: RuntimeEvent[]) =>
  projectConfigRecoveryGrantRecordsFromEvents(events).map(record => record.grant)

const stableJson = (value: unknown): string => {
  if (value == null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null'
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key =>
      `${JSON.stringify(key)}:${stableJson(record[key])}`
    ).join(',')}}`
  }
  throw new Error('Activation payload must be JSON serializable.')
}

export const canonicalRuntimeActivationPayload = (command: RuntimeCommand) => {
  const parsed = RuntimeActivationCommandSchema.safeParse(command)
  if (!parsed.success) return undefined
  const value = parsed.data
  const content = value.runtimeContentItems ?? value.contentItems ??
    value.runtimeMessage ?? value.content ?? value.message
  return content == null ? undefined : stableJson(content)
}

export const buildProjectConfigRecoveryIdempotencyKey = (
  sessionId: string,
  attemptCommandId: string,
  failureEventId: string,
  failureEventSeq: number
) => createHash('sha256')
  .update(`${sessionId}\0${attemptCommandId}\0${failureEventId}\0${failureEventSeq}`)
  .digest('hex')

const resolveBaseRecoveryAuthority = (
  command: RuntimeCommand,
  commands: RuntimeCommand[],
  events: RuntimeEvent[],
  authority: ProjectConfigRecoveryAuthority
) => {
  const recovery = command.recovery
  if (
    recovery == null ||
    command.type !== 'resume' ||
    command.source !== 'project_config_recovery' ||
    command.messageDelivery !== 'bridge' ||
    command.projectConfigPolicy !== 'global-only' ||
    command.adapter !== authority.adapter ||
    command.sessionId !== authority.sessionId ||
    authority.runtimeAdapter !== 'codex' ||
    recovery.kind !== 'codex-project-config' ||
    recovery.attemptCommandId !== recovery.replacedActivationCommandId
  ) return undefined
  const matchingCommands = commands.filter(candidate => candidate.id === command.id)
  const commandIndex = commands.findIndex(candidate => candidate.id === command.id)
  if (matchingCommands.length !== 1 || commandIndex < 0) return undefined
  const original = commands.find(candidate =>
    candidate.id === recovery.attemptCommandId &&
    candidate.sessionId === authority.sessionId &&
    isRuntimeActivationCommand(candidate)
  )
  if (original == null) return undefined
  const failure = events.some(event =>
    event.id === recovery.failureEventId &&
    event.seq === recovery.failureEventSeq &&
    event.sessionId === command.sessionId &&
    event.type === 'session_failed' &&
    event.causedByCommandId === recovery.attemptCommandId &&
    event.code === CODEX_PROJECT_CONFIG_INVALID_ERROR_CODE &&
    event.fatal === true
  )
  const currentFailure = events.find(event =>
    event.id === recovery.failureEventId && event.seq === recovery.failureEventSeq
  )
  const strictDetails = CodexProjectConfigInvalidDetailsSchema.safeParse(currentFailure?.details)
  const grantRecord = projectConfigRecoveryGrantRecordsFromEvents(events).find(candidate =>
    candidate.eventId === recovery.grantEventId &&
    candidate.eventSeq === recovery.grantEventSeq &&
    candidate.grant.authorizationId === recovery.grantAuthorizationId &&
    candidate.grant.commandIndex === recovery.grantCommandIndex &&
    candidate.grant.commandIndex === commandIndex &&
    candidate.grant.recoveryCommandId === command.id &&
    candidate.grant.idempotencyKey === recovery.idempotencyKey &&
    candidate.grant.sessionId === command.sessionId &&
    candidate.grant.attemptCommandId === recovery.attemptCommandId &&
    candidate.grant.failureEventId === recovery.failureEventId &&
    candidate.grant.failureEventSeq === recovery.failureEventSeq &&
    candidate.grant.payloadDigest === projectConfigRecoveryPayloadDigest(command) &&
    candidate.grant.workspaceFolder === authority.workspaceFolder &&
    candidate.grant.adapter === authority.adapter &&
    candidate.grant.runtimeAdapter === authority.runtimeAdapter
  )
  const grant = grantRecord?.grant
  const latestTerminalBeforeGrant = grantRecord == null
    ? undefined
    : events.findLast(event =>
      event.seq < grantRecord.eventSeq &&
      (
        event.type === 'session_failed' ||
        event.type === 'session_completed' ||
        event.type === 'session_stopped'
      )
    )
  const valid = failure &&
    latestTerminalBeforeGrant?.id === recovery.failureEventId &&
    strictDetails.success &&
    strictDetails.data.sessionId === authority.sessionId &&
    strictDetails.data.runtimeAdapter === authority.runtimeAdapter &&
    strictDetails.data.configSource === 'project' &&
    strictDetails.data.adapter === authority.adapter &&
    strictDetails.data.adapter === grant?.adapter &&
    strictDetails.data.workspaceFolder === authority.workspaceFolder &&
    strictDetails.data.workspaceFolder === grant?.workspaceFolder &&
    grant != null &&
    recovery.grantEventSeq > recovery.failureEventSeq &&
    recovery.idempotencyKey === buildProjectConfigRecoveryIdempotencyKey(
      command.sessionId,
      recovery.attemptCommandId,
      recovery.failureEventId,
      recovery.failureEventSeq
    ) &&
    canonicalRuntimeActivationPayload(original) != null &&
    canonicalRuntimeActivationPayload(original) === canonicalRuntimeActivationPayload(command)
  if (!valid || grantRecord == null || grant == null) return undefined
  return { grant, grantEventSeq: grantRecord.eventSeq, original, recovery }
}

export const classifyProjectConfigRecovery = (
  command: RuntimeCommand,
  commands: RuntimeCommand[],
  events: RuntimeEvent[],
  authority: ProjectConfigRecoveryAuthority
): ProjectConfigRecoveryClassification => {
  const resolved = resolveBaseRecoveryAuthority(command, commands, events, authority)
  if (resolved == null) return 'inert'

  const supersededByLifecycle = events.some(event =>
    event.seq > resolved.recovery.failureEventSeq &&
    event.seq < resolved.grantEventSeq &&
    (
      event.type === 'session_started' ||
      event.type === 'session_resumed' ||
      (event.type === 'status_changed' && event.status === 'running')
    )
  )
  const attemptIndex = commands.findIndex(candidate => candidate.id === resolved.original.id)
  const recoveryIndex = commands.findIndex(candidate => candidate.id === command.id)
  const supersededByOrdinaryActivation = commands
    .slice(attemptIndex + 1, recoveryIndex)
    .some(candidate =>
      candidate.sessionId === authority.sessionId &&
      candidate.recovery == null &&
      isRuntimeActivationCommand(candidate)
    )
  if (supersededByLifecycle || supersededByOrdinaryActivation) return 'superseded'

  const firstAuthenticRecovery = commands.find(candidate =>
    resolveBaseRecoveryAuthority(candidate, commands, events, authority) != null
  )
  return firstAuthenticRecovery?.id === command.id ? 'authentic' : 'superseded'
}

export const isAuthenticProjectConfigRecovery = (
  command: RuntimeCommand,
  commands: RuntimeCommand[],
  events: RuntimeEvent[],
  authority: ProjectConfigRecoveryAuthority
) => classifyProjectConfigRecovery(command, commands, events, authority) === 'authentic'
