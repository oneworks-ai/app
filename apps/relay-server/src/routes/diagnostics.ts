/* eslint-disable max-lines -- ingestion, privacy projection, and admin analysis share one bounded route contract. */
import { Buffer } from 'node:buffer'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { resolveAuthContext } from '../auth/permissions.js'
import { deviceTokenMatches } from '../devices/private-metadata.js'
import { normalizeOtlpModelUsage } from '../diagnostics/model-usage.js'
import { normalizeOtlpLogs } from '../diagnostics/otlp.js'
import { appendRelayDiagnosticEvents, diagnosticRetention } from '../diagnostics/store.js'
import { getBearerToken, sendJson } from '../http.js'
import { personalModelUsageReportingEnabled, teamMemberModelUsageReportingEnabled } from '../model-usage/preferences.js'
import { appendRelayModelUsageEvents } from '../model-usage/store.js'
import { hasRelayPermission, relayPermissions } from '../permissions/index.js'
import type { RelayStoreRepository } from '../storage/repository.js'
import type { RelayDiagnosticEvent, RelayServerArgs, RelayStore } from '../types.js'

const MAX_OTLP_BODY_BYTES = 1_048_576
const MAX_OTLP_RECORDS = 512
const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 200

const readJsonWithLimit = async (req: IncomingMessage) => {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_OTLP_BODY_BYTES) {
      req.resume()
      return { error: 'too-large' as const }
    }
    chunks.push(buffer)
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    return { body: parsed }
  } catch {
    return { error: 'invalid-json' as const }
  }
}

const resolveIngestionIdentity = (req: IncomingMessage, args: RelayServerArgs, store: RelayStore) => {
  const requestedTeamId = typeof req.headers['x-oneworks-team-id'] === 'string'
    ? req.headers['x-oneworks-team-id'].trim()
    : ''
  const token = getBearerToken(req)
  if (token !== '') {
    const device = store.devices.find(candidate => deviceTokenMatches(candidate, token))
    if (device?.userId != null) {
      const teamIds = store.teamMembers
        .filter(member => member.userId === device.userId)
        .map(member => member.teamId)
        .filter(teamId => store.teams.some(team => team.id === teamId && team.archivedAt == null))
      if (requestedTeamId !== '' && !teamIds.includes(requestedTeamId)) return { error: 'invalid-team' as const }
      return {
        deviceId: device.id,
        teamId: requestedTeamId || undefined,
        userId: device.userId
      }
    }
  }
  const auth = resolveAuthContext(req, args, store)
  if (
    auth == null || auth.kind === 'admin-token' || !hasRelayPermission(
      auth.principal,
      relayPermissions.relayDiagnosticsWrite
    )
  ) return undefined
  const requestedDeviceId = typeof req.headers['x-oneworks-device-id'] === 'string'
    ? req.headers['x-oneworks-device-id'].trim()
    : ''
  const ownedDevice = requestedDeviceId === ''
    ? undefined
    : store.devices.find(device => device.id === requestedDeviceId && device.userId === auth.user.id)
  const teamIds = store.teamMembers
    .filter(member => member.userId === auth.user.id)
    .map(member => member.teamId)
    .filter(teamId => store.teams.some(team => team.id === teamId && team.archivedAt == null))
  const scopedTeamId = auth.kind === 'access-token' && auth.accessToken.scope === 'team'
    ? auth.accessToken.teamId
    : undefined
  const teamId = requestedTeamId || scopedTeamId
  if (teamId != null && !teamIds.includes(teamId)) return { error: 'invalid-team' as const }
  return { deviceId: ownedDevice?.id, teamId, userId: auth.user.id }
}

const percentile = (values: number[], percentage: number) => {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentage) - 1)]
}

const countBy = (events: RelayDiagnosticEvent[], select: (event: RelayDiagnosticEvent) => string | undefined) => {
  const result: Record<string, number> = {}
  for (const event of events) {
    const value = select(event)
    if (value != null) result[value] = (result[value] ?? 0) + 1
  }
  return result
}

const summarizeEvents = (events: RelayDiagnosticEvent[]) => {
  const startupOperations = new Map<string, {
    ready: boolean
    readyDurationMs?: number
    succeeded: boolean
  }>()
  for (const event of events) {
    if (event.category !== 'startup' || event.source !== 'oneworks') continue
    const isStarted = event.eventName === 'oneworks.diagnostic.operation.started'
    const isReady = event.eventName === 'oneworks.diagnostic.operation.ready'
    const isCompleted = event.eventName === 'oneworks.diagnostic.operation.completed' || event.outcome != null
    if (!isStarted && !isReady && !isCompleted) continue
    const key = event.operationId ?? event.id
    const current = startupOperations.get(key) ?? { ready: false, succeeded: false }
    if (isReady) {
      current.ready = true
      current.readyDurationMs = event.durationMs
    }
    if (isCompleted && event.outcome === 'success') {
      current.succeeded = true
    }
    startupOperations.set(key, current)
  }
  const startup = [...startupOperations.values()]
  const startupSuccesses = startup.filter(operation => operation.ready || operation.succeeded).length
  const startupDurations = startup.flatMap(operation => (
    operation.readyDurationMs == null ? [] : [operation.readyDurationMs]
  ))
  return {
    affectedUsers: new Set(events.map(event => event.userId)).size,
    byFailure: countBy(events, event => event.errorCode),
    byFingerprint: countBy(events, event => event.errorFingerprint),
    byOutcome: countBy(events, event => event.outcome),
    byPlatform: countBy(events, event => event.platform),
    bySource: countBy(events, event => event.source),
    byVersion: countBy(events, event => event.serviceVersion),
    errorEvents: events.filter(event => event.severity === 'ERROR' || event.errorCode != null).length,
    startup: {
      attempts: startupOperations.size,
      p50DurationMs: percentile(startupDurations, 0.5),
      p95DurationMs: percentile(startupDurations, 0.95),
      successRate: startupOperations.size === 0 ? undefined : startupSuccesses / startupOperations.size
    },
    total: events.length
  }
}

const diagnosticSeries = (events: RelayDiagnosticEvent[]) => {
  const dailyEvents = new Map<string, RelayDiagnosticEvent[]>()
  for (const event of events) {
    const date = event.occurredAt.slice(0, 10)
    const items = dailyEvents.get(date) ?? []
    items.push(event)
    dailyEvents.set(date, items)
  }
  return [...dailyEvents.entries()].map(([date, items]) => {
    const summary = summarizeEvents(items)
    return {
      activeUsers: summary.affectedUsers,
      date,
      errorEvents: summary.errorEvents,
      startupAttempts: summary.startup.attempts,
      startupSuccessRate: summary.startup.successRate,
      totalEvents: summary.total
    }
  }).sort((left, right) => left.date.localeCompare(right.date))
}

const encodeCursor = (event: RelayDiagnosticEvent) =>
  Buffer.from(JSON.stringify({ id: event.id })).toString('base64url')

const cursorId = (value: string | null) => {
  if (value == null || value === '') return undefined
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as { id?: unknown }
    return typeof parsed.id === 'string' ? parsed.id : undefined
  } catch {
    return undefined
  }
}

const queryDiagnosticEvents = (store: RelayStore, url: URL) => {
  const from = Date.parse(url.searchParams.get('from') ?? '')
  const to = Date.parse(url.searchParams.get('to') ?? '')
  const userId = url.searchParams.get('userId')?.trim()
  const source = url.searchParams.get('source')?.trim()
  const outcome = url.searchParams.get('outcome')?.trim()
  const category = url.searchParams.get('category')?.trim()
  const platform = url.searchParams.get('platform')?.trim()
  const serviceVersion = url.searchParams.get('serviceVersion')?.trim()
  const query = url.searchParams.get('q')?.trim().toLowerCase()
  return (store.diagnosticEvents ?? []).filter(event => (
    (userId == null || userId === '' || event.userId === userId) &&
    (source == null || source === '' || event.source === source) &&
    (outcome == null || outcome === '' || event.outcome === outcome) &&
    (category == null || category === '' || event.category === category) &&
    (platform == null || platform === '' || event.platform === platform) &&
    (serviceVersion == null || serviceVersion === '' || event.serviceVersion === serviceVersion) &&
    (!Number.isFinite(from) || Date.parse(event.occurredAt) >= from) &&
    (!Number.isFinite(to) || Date.parse(event.occurredAt) <= to) &&
    (query == null || query === '' || [
      event.eventName,
      event.operationName,
      event.errorCode,
      event.errorFingerprint,
      event.stage,
      event.serviceName,
      event.serviceVersion,
      event.platform,
      event.architecture,
      event.surface
    ].some(value => value?.toLowerCase().includes(query)))
  )).sort((left, right) => (
    right.occurredAt.localeCompare(left.occurredAt) || right.id.localeCompare(left.id)
  ))
}

const handleAdminDiagnostics = (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  url: URL
) => {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed.' }, args.allowOrigin)
    return
  }
  const auth = resolveAuthContext(req, args, store)
  if (auth == null) {
    sendJson(res, 401, { error: 'Authentication required.' }, args.allowOrigin)
    return
  }
  if (!hasRelayPermission(auth.principal, relayPermissions.adminDiagnosticsRead)) {
    sendJson(res, 403, { error: 'Permission denied.' }, args.allowOrigin)
    return
  }
  const filtered = queryDiagnosticEvents(store, url)
  const requestedLimit = Number(url.searchParams.get('limit') ?? DEFAULT_PAGE_SIZE)
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(requestedLimit)))
    : DEFAULT_PAGE_SIZE
  const previousId = cursorId(url.searchParams.get('cursor'))
  const start = previousId == null ? 0 : Math.max(0, filtered.findIndex(event => event.id === previousId) + 1)
  const events = filtered.slice(start, start + limit)
  const nextEvent = start + limit < filtered.length ? events.at(-1) : undefined
  const userIds = new Set(events.map(event => event.userId))
  sendJson(res, 200, {
    events,
    nextCursor: nextEvent == null ? undefined : encodeCursor(nextEvent),
    retention: diagnosticRetention(),
    series: diagnosticSeries(filtered),
    summary: summarizeEvents(filtered),
    users: store.users.filter(user => userIds.has(user.id)).map(user => ({
      email: user.email,
      id: user.id,
      name: user.name
    }))
  }, args.allowOrigin)
}

const handleOtlpIngestion = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  repository: RelayStoreRepository
) => {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed.' }, args.allowOrigin)
    return
  }
  if (!(req.headers['content-type'] ?? '').toString().toLowerCase().startsWith('application/json')) {
    sendJson(res, 415, { error: 'Only OTLP/HTTP JSON is supported.' }, args.allowOrigin)
    return
  }
  const identity = resolveIngestionIdentity(req, args, store)
  if (identity == null) {
    sendJson(res, 401, { error: 'Authenticated user or paired device required.' }, args.allowOrigin)
    return
  }
  if ('error' in identity) {
    sendJson(res, 403, { error: 'Requested team is not available to this user.' }, args.allowOrigin)
    return
  }
  const parsed = await readJsonWithLimit(req)
  if (parsed.error === 'too-large') {
    sendJson(res, 413, { error: 'OTLP payload exceeds 1 MiB.' }, args.allowOrigin)
    return
  }
  if (parsed.error === 'invalid-json') {
    sendJson(res, 400, { error: 'Invalid OTLP JSON.' }, args.allowOrigin)
    return
  }
  const normalized = normalizeOtlpLogs(parsed.body, identity)
  if (normalized.length === 0) {
    sendJson(res, 400, { error: 'No OTLP log records found.' }, args.allowOrigin)
    return
  }
  if (normalized.length > MAX_OTLP_RECORDS) {
    sendJson(res, 413, { error: `OTLP payload exceeds ${MAX_OTLP_RECORDS} log records.` }, args.allowOrigin)
    return
  }
  const diagnosticReportingEnabled = store.users
    .find(user => user.id === identity.userId)?.diagnosticReportingEnabled !== false
  const modelUsageTarget = identity.teamId == null
    ? {
      enabled: personalModelUsageReportingEnabled(
        store.users.find(user => user.id === identity.userId)!
      ),
      scope: 'personal' as const
    }
    : (() => {
      const team = store.teams.find(item => item.id === identity.teamId)
      const member = store.teamMembers.find(item => item.teamId === identity.teamId && item.userId === identity.userId)
      return {
        enabled: team != null && member != null && teamMemberModelUsageReportingEnabled(team, member),
        scope: 'team' as const
      }
    })()
  const modelUsageEvents = modelUsageTarget.enabled
    ? normalizeOtlpModelUsage(parsed.body, {
      deviceId: identity.deviceId,
      scope: modelUsageTarget.scope,
      ...(identity.teamId == null ? {} : { teamId: identity.teamId }),
      userId: identity.userId
    })
    : []
  if (diagnosticReportingEnabled) {
    appendRelayDiagnosticEvents(store, normalized)
  }
  if (modelUsageEvents.length > 0) {
    appendRelayModelUsageEvents(store, modelUsageEvents)
  }
  await repository.write(store)
  sendJson(res, 200, {}, args.allowOrigin)
}

export const handleRelayDiagnosticsRoute = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  repository: RelayStoreRepository,
  url: URL
) => {
  if (url.pathname === '/api/relay/diagnostics/v1/logs') {
    await handleOtlpIngestion(req, res, args, store, repository)
    return true
  }
  if (url.pathname === '/api/admin/diagnostics') {
    handleAdminDiagnostics(req, res, args, store, url)
    return true
  }
  return false
}
