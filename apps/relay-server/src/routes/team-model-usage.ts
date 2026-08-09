/* eslint-disable max-lines -- query filters, aggregation, and cursor page share one team usage contract. */
import { Buffer } from 'node:buffer'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { resolveAuthContext } from '../auth/permissions.js'
import type { RelayAuthContext } from '../auth/permissions.js'
import { sendJson } from '../http.js'
import { modelUsageRetention } from '../model-usage/store.js'
import { hasRelayPermission, relayPermissions } from '../permissions/index.js'
import type { RelayModelUsageEvent, RelayServerArgs, RelayStore, RelayTeam } from '../types.js'
import { isAdminAuth, teamMemberHasCapability, teamMembershipForAuth } from './team-route-utils.js'

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 200

interface UsageAggregate {
  activeUsers: Set<string>
  cacheCreationInputTokens: number
  cachedInputTokens: number
  durationMs: number[]
  inputTokens: number
  outputTokens: number
  requests: number
}

const emptyAggregate = (): UsageAggregate => ({
  activeUsers: new Set(),
  cacheCreationInputTokens: 0,
  cachedInputTokens: 0,
  durationMs: [],
  inputTokens: 0,
  outputTokens: 0,
  requests: 0
})

const appendAggregate = (aggregate: UsageAggregate, event: RelayModelUsageEvent) => {
  aggregate.activeUsers.add(event.userId)
  aggregate.cacheCreationInputTokens += event.cacheCreationInputTokens
  aggregate.cachedInputTokens += event.cachedInputTokens
  aggregate.inputTokens += event.inputTokens
  aggregate.outputTokens += event.outputTokens
  aggregate.requests += event.requestCount
  if (event.durationMs != null) aggregate.durationMs.push(event.durationMs)
}

const percentile = (values: number[], percentage: number) => {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentage) - 1)]
}

const serializeAggregate = (aggregate: UsageAggregate) => ({
  activeUsers: aggregate.activeUsers.size,
  cacheCreationInputTokens: aggregate.cacheCreationInputTokens,
  cacheRate: aggregate.inputTokens === 0 ? undefined : aggregate.cachedInputTokens / aggregate.inputTokens,
  cachedInputTokens: aggregate.cachedInputTokens,
  inputTokens: aggregate.inputTokens,
  outputTokens: aggregate.outputTokens,
  p95DurationMs: percentile(aggregate.durationMs, 0.95),
  requests: aggregate.requests,
  totalTokens: aggregate.inputTokens + aggregate.outputTokens
})

const aggregateBy = (events: RelayModelUsageEvent[], select: (event: RelayModelUsageEvent) => string) => {
  const result = new Map<string, UsageAggregate>()
  for (const event of events) {
    const key = select(event)
    const aggregate = result.get(key) ?? emptyAggregate()
    appendAggregate(aggregate, event)
    result.set(key, aggregate)
  }
  return Object.fromEntries(
    [...result.entries()]
      .sort((left, right) => right[1].requests - left[1].requests || left[0].localeCompare(right[0]))
      .map(([key, aggregate]) => [key, serializeAggregate(aggregate)])
  )
}

const summarize = (events: RelayModelUsageEvent[]) => {
  const aggregate = emptyAggregate()
  for (const event of events) appendAggregate(aggregate, event)
  return {
    ...serializeAggregate(aggregate),
    byAdapter: aggregateBy(events, event => event.adapter ?? 'unknown'),
    byModel: aggregateBy(events, event => event.model),
    byModelService: aggregateBy(events, event => event.modelService),
    bySource: aggregateBy(events, event => event.source),
    byTeam: aggregateBy(
      events.filter((event): event is RelayModelUsageEvent & { teamId: string } => event.teamId != null),
      event => event.teamId ?? 'unknown'
    ),
    byUser: aggregateBy(events, event => event.userId)
  }
}

const series = (events: RelayModelUsageEvent[]) =>
  Object.entries(aggregateBy(
    events,
    event => event.occurredAt.slice(0, 10)
  )).map(([date, aggregate]) => ({ date, ...aggregate })).sort((left, right) => left.date.localeCompare(right.date))

const encodeCursor = (event: RelayModelUsageEvent) => (
  Buffer.from(JSON.stringify({ id: event.id })).toString('base64url')
)

const cursorId = (value: string | null) => {
  if (value == null || value === '') return undefined
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as { id?: unknown }
    return typeof parsed.id === 'string' ? parsed.id : undefined
  } catch {
    return undefined
  }
}

type UsageScope =
  | { kind: 'personal'; userId: string }
  | { kind: 'team'; teamId?: string }

const queryEvents = (store: RelayStore, scope: UsageScope, url: URL) => {
  const from = Date.parse(url.searchParams.get('from') ?? '')
  const to = Date.parse(url.searchParams.get('to') ?? '')
  const teamId = url.searchParams.get('teamId')?.trim()
  const userId = url.searchParams.get('userId')?.trim()
  const modelService = url.searchParams.get('modelService')?.trim()
  const model = url.searchParams.get('model')?.trim()
  const adapter = url.searchParams.get('adapter')?.trim()
  const source = url.searchParams.get('source')?.trim()
  const query = url.searchParams.get('q')?.trim().toLowerCase()
  const users = new Map(store.users.map(user => [user.id, user]))
  const teams = new Map(store.teams.map(team => [team.id, team]))
  return (store.modelUsageEvents ?? []).filter(event => {
    const user = users.get(event.userId)
    const team = event.teamId == null ? undefined : teams.get(event.teamId)
    return (scope.kind === 'personal'
      ? event.scope === 'personal' && event.userId === scope.userId
      : event.scope === 'team' && (scope.teamId == null || event.teamId === scope.teamId)) &&
      (scope.kind === 'personal' || scope.teamId != null || teamId == null || teamId === '' ||
        event.teamId === teamId) &&
      (userId == null || userId === '' || event.userId === userId) &&
      (modelService == null || modelService === '' || event.modelService === modelService) &&
      (model == null || model === '' || event.model === model) &&
      (adapter == null || adapter === '' || event.adapter === adapter) &&
      (source == null || source === '' || event.source === source) &&
      (!Number.isFinite(from) || Date.parse(event.occurredAt) >= from) &&
      (!Number.isFinite(to) || Date.parse(event.occurredAt) <= to) &&
      (query == null || query === '' || [
        event.modelService,
        event.model,
        event.adapter,
        event.source,
        user?.name,
        user?.email,
        team?.name,
        team?.slug
      ].some(value => value?.toLowerCase().includes(query)))
  }).sort((left, right) => (
    right.occurredAt.localeCompare(left.occurredAt) || right.id.localeCompare(left.id)
  ))
}

const sendUsageResponse = (
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  filtered: RelayModelUsageEvent[],
  url: URL
) => {
  const requestedLimit = Number(url.searchParams.get('limit') ?? DEFAULT_PAGE_SIZE)
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(requestedLimit)))
    : DEFAULT_PAGE_SIZE
  const previousId = cursorId(url.searchParams.get('cursor'))
  const start = previousId == null ? 0 : Math.max(0, filtered.findIndex(event => event.id === previousId) + 1)
  const events = filtered.slice(start, start + limit)
  const nextEvent = start + limit < filtered.length ? events.at(-1) : undefined
  const userIds = new Set(filtered.map(event => event.userId))
  const teamIds = new Set(filtered.flatMap(event => event.teamId == null ? [] : [event.teamId]))

  sendJson(res, 200, {
    events,
    nextCursor: nextEvent == null ? undefined : encodeCursor(nextEvent),
    retention: modelUsageRetention(),
    series: series(filtered),
    summary: summarize(filtered),
    teams: store.teams.filter(team => teamIds.has(team.id)).map(team => ({
      id: team.id,
      name: team.name,
      slug: team.slug
    })),
    users: store.users.filter(user => userIds.has(user.id)).map(user => ({
      email: user.email,
      id: user.id,
      name: user.name
    }))
  }, args.allowOrigin)
}

export const handleAdminModelUsageRoute = (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  url: URL
) => {
  if (url.pathname !== '/api/admin/model-usage') return false
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed.' }, args.allowOrigin)
    return true
  }
  const auth = resolveAuthContext(req, args, store)
  if (auth == null) {
    sendJson(res, 401, { error: 'Authentication required.' }, args.allowOrigin)
    return true
  }
  if (!hasRelayPermission(auth.principal, relayPermissions.adminModelUsageRead)) {
    sendJson(res, 403, { error: 'Permission denied.' }, args.allowOrigin)
    return true
  }
  sendUsageResponse(res, args, store, queryEvents(store, { kind: 'team' }, url), url)
  return true
}

export const handleProfileModelUsage = (
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  userId: string,
  url: URL
) => {
  sendUsageResponse(res, args, store, queryEvents(store, { kind: 'personal', userId }, url), url)
}

export const handleTeamModelUsage = (
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  auth: RelayAuthContext,
  team: RelayTeam,
  url: URL
) => {
  const member = teamMembershipForAuth(store, auth, team.id)
  if (
    !isAdminAuth(auth) && !teamMemberHasCapability(
      store,
      member,
      relayPermissions.relayTeamModelUsageRead
    )
  ) {
    sendJson(res, 403, { error: 'Permission denied.' }, args.allowOrigin)
    return
  }

  sendUsageResponse(res, args, store, queryEvents(store, { kind: 'team', teamId: team.id }, url), url)
}
