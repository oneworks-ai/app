/* eslint-disable max-lines -- acceptance coordinates redacted matrix, config, binding, and runtime evidence. */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import process from 'node:process'

import { buildConfigJsonVariables, loadConfigState } from '@oneworks/config'
import { DefinitionLoader } from '@oneworks/definition-loader'

interface ChannelAcceptanceInput {
  channelType?: string
  dbPath?: string
  expectChannels?: number
  expectEntities?: number
  expectGroups?: number
  expectLinks?: number
  json?: boolean
  requireAdmins?: boolean
  requireCredentials?: boolean
  requireGroupAllowlist?: boolean
  workspace?: string
}

interface ChannelAcceptanceViolation {
  code: string
  ref?: string
}

interface ChannelAcceptanceDatabaseSummary {
  digest: string
  metrics: Record<string, Record<string, number>>
}

export interface ChannelAcceptanceResult {
  ok: boolean
  counts: {
    channels: number
    credentialReadyChannels: number
    entities: number
    groupAllowlistReadyChannels: number
    groups: number
    links: number
    linkedChannels: number
    linkedEntities: number
    adminReadyChannels: number
  }
  database?: ChannelAcceptanceDatabaseSummary
  digest: string
  violations: ChannelAcceptanceViolation[]
}

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value == null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)])
  )
}

const digest = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex')
    .slice(0, 16)

const nonEmptyString = (value: unknown): value is string => (
  typeof value === 'string' && value.trim() !== ''
)

const definitionNames = (definition: {
  attributes: { name?: string }
  path: string
  resolvedName?: string
}) =>
  [
    definition.resolvedName,
    definition.attributes.name,
    basename(dirname(definition.path))
  ].filter(nonEmptyString)

const readAccess = (config: Record<string, unknown>) => {
  const access = config.access
  return access != null && typeof access === 'object' && !Array.isArray(access)
    ? access as Record<string, unknown>
    : {}
}

const groupRows = (
  links: Array<{
    attributes: {
      channel: string
      external: Record<string, unknown>
    }
  }>
) =>
  links.flatMap((link) => {
    const external = link.attributes.external
    if (external.type !== 'chat' || !nonEmptyString(external.chatId)) return []
    return [{
      channelKey: link.attributes.channel.trim(),
      chatId: external.chatId.trim()
    }]
  })

const addViolation = (
  violations: ChannelAcceptanceViolation[],
  code: string,
  value?: unknown
) => {
  violations.push({
    code,
    ...(value == null ? {} : { ref: digest(value) })
  })
}

const readDatabaseSummary = async (dbPath: string): Promise<ChannelAcceptanceDatabaseSummary> => {
  if (!existsSync(dbPath)) {
    throw new Error('Channel acceptance database does not exist.')
  }
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(dbPath, { readOnly: true })
  const specs = [
    ['childRuns', 'channel_child_session_runs', 'status'],
    ['routerRuns', 'channel_ingress_router_runs', 'decision'],
    ['commandRuns', 'channel_command_runs', 'status'],
    ['pendingIntents', 'channel_pending_intents', 'status'],
    ['authorizationRequests', 'channel_authorization_requests', 'status'],
    ['memoryWritebacks', 'channel_memory_writebacks', 'status']
  ] as const
  try {
    const tableRows = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table'"
    ).all() as Array<{ name: string }>
    const tables = new Set(tableRows.map(row => row.name))
    const metrics: Record<string, Record<string, number>> = {}
    for (const [name, table, column] of specs) {
      if (!tables.has(table)) continue
      const rows = db.prepare(
        `SELECT ${column} AS value, COUNT(*) AS count FROM ${table} GROUP BY ${column}`
      ).all() as Array<{ count: number; value: string }>
      metrics[name] = Object.fromEntries(
        rows
          .map(row => [row.value, Number(row.count)] as const)
          .sort(([left], [right]) => left.localeCompare(right))
      )
    }
    return {
      digest: digest(metrics),
      metrics
    }
  } finally {
    db.close()
  }
}

export const inspectChannelAcceptance = async (
  input: ChannelAcceptanceInput = {}
): Promise<ChannelAcceptanceResult> => {
  const workspace = resolve(input.workspace ?? process.cwd())
  const loader = new DefinitionLoader(workspace)
  const [{ mergedConfig }, links, entities] = await Promise.all([
    loadConfigState({
      cwd: workspace,
      jsonVariables: buildConfigJsonVariables(workspace)
    }),
    loader.loadDefaultChannelLinks(),
    loader.loadDefaultEntities()
  ])
  const channels = Object.entries(mergedConfig.channels ?? {})
    .filter((entry): entry is [string, Record<string, unknown>] => (
      entry[1] != null && typeof entry[1] === 'object' && !Array.isArray(entry[1])
    ))
    .filter(([, config]) => input.channelType == null || config.type === input.channelType)
  const channelMap = new Map(channels)
  const entityNames = new Set(entities.flatMap(definitionNames))
  const selectedLinks = links.filter(link => channelMap.has(link.attributes.channel.trim()))
  const violations: ChannelAcceptanceViolation[] = []
  const bindings = new Set<string>()
  const entityByChannel = new Map<string, string>()

  for (const link of selectedLinks) {
    const channelKey = link.attributes.channel.trim()
    const entity = link.attributes.entity.trim()
    if (!entityNames.has(entity)) addViolation(violations, 'missing_entity', entity)
    if (!channelMap.has(channelKey)) addViolation(violations, 'unconfigured_channel', channelKey)

    const previousEntity = entityByChannel.get(channelKey)
    if (previousEntity != null && previousEntity !== entity) {
      addViolation(violations, 'channel_reused_across_entities', [channelKey, previousEntity, entity])
    }
    entityByChannel.set(channelKey, entity)

    const binding = digest([channelKey, link.attributes.external])
    if (bindings.has(binding)) addViolation(violations, 'duplicate_binding', binding)
    bindings.add(binding)
  }

  const groups = groupRows(selectedLinks)
  const uniqueGroups = new Set(groups.map(group => group.chatId))
  const linkedChannels = new Set(selectedLinks.map(link => link.attributes.channel.trim()))
  const linkedEntities = new Set(selectedLinks.map(link => link.attributes.entity.trim()))
  let credentialReadyChannels = 0
  let adminReadyChannels = 0
  let groupAllowlistReadyChannels = 0

  for (const channelKey of linkedChannels) {
    const config = channelMap.get(channelKey)
    if (config == null) continue
    const access = readAccess(config)
    const admins = Array.isArray(access.admins) ? access.admins.filter(nonEmptyString) : []
    if (admins.length > 0) {
      adminReadyChannels += 1
    } else if (input.requireAdmins === true) {
      addViolation(violations, 'channel_missing_admin', channelKey)
    }

    const channelGroups = groups.filter(group => group.channelKey === channelKey).map(group => group.chatId)
    const allowedGroups = Array.isArray(access.allowedGroups)
      ? new Set(access.allowedGroups.filter(nonEmptyString).map(value => value.trim()))
      : new Set<string>()
    if (channelGroups.every(groupId => allowedGroups.has(groupId))) {
      groupAllowlistReadyChannels += 1
    } else if (input.requireGroupAllowlist === true) {
      addViolation(violations, 'channel_group_allowlist_mismatch', channelKey)
    }

    if (config.type !== 'lark' || (nonEmptyString(config.appId) && nonEmptyString(config.appSecret))) {
      credentialReadyChannels += 1
    } else if (input.requireCredentials === true) {
      addViolation(violations, 'channel_missing_credentials', channelKey)
    }
  }

  const counts = {
    channels: channels.length,
    credentialReadyChannels,
    entities: entities.length,
    groupAllowlistReadyChannels,
    groups: uniqueGroups.size,
    links: selectedLinks.length,
    linkedChannels: linkedChannels.size,
    linkedEntities: linkedEntities.size,
    adminReadyChannels
  }
  const expected = [
    ['channels', input.expectChannels],
    ['linkedEntities', input.expectEntities],
    ['groups', input.expectGroups],
    ['links', input.expectLinks]
  ] as const
  for (const [key, value] of expected) {
    if (value != null && counts[key] !== value) {
      addViolation(violations, `unexpected_${key}_count`, [counts[key], value])
    }
  }

  const database = input.dbPath == null ? undefined : await readDatabaseSummary(resolve(input.dbPath))
  return {
    ok: violations.length === 0,
    counts,
    ...(database == null ? {} : { database }),
    digest: digest({
      channels: [...linkedChannels].sort(),
      entities: [...linkedEntities].sort(),
      groups: [...uniqueGroups].sort(),
      links: selectedLinks.map(link => [link.attributes.channel, link.attributes.entity, link.attributes.external])
    }),
    violations
  }
}

export const runChannelAcceptance = async (input: ChannelAcceptanceInput = {}) => {
  const result = await inspectChannelAcceptance(input)
  if (input.json === true) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } else {
    process.stdout.write(
      `[channel-acceptance] ${result.ok ? 'PASS' : 'FAIL'} ` +
        `channels=${result.counts.channels} entities=${result.counts.entities} ` +
        `groups=${result.counts.groups} links=${result.counts.links} digest=${result.digest}\n`
    )
    for (const violation of result.violations) {
      process.stdout.write(
        `[channel-acceptance] ${violation.code}${violation.ref == null ? '' : ` ref=${violation.ref}`}\n`
      )
    }
  }
  if (!result.ok) process.exitCode = 1
  return result
}
