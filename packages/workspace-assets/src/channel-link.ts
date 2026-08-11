/* eslint-disable max-lines -- channel-link normalization validates the full nested public contract in one boundary. */
import type {
  ChannelLink,
  ChannelLinkAvailability,
  ChannelLinkIngress,
  ChannelLinkIssuerAccountRef,
  ChannelLinkModeration,
  ChannelLinkModerationLevel,
  ChannelLinkRouting,
  ChannelRoute,
  ChannelRouteMode,
  ChannelRouteVisibility
} from '@oneworks/types'

const ROUTE_MODES = new Set<ChannelRouteMode>(['reply', 'clarify', 'digest', 'admin', 'background'])
const VISIBILITIES = new Set<ChannelRouteVisibility>(['public', 'dm', 'ephemeral', 'none'])

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const asBoolean = (value: unknown, field: string, fallback: boolean) => {
  if (value == null) return fallback
  if (typeof value !== 'boolean') throw new Error(`Channel link ${field} must be a boolean`)
  return value
}

const asString = (value: unknown, field: string) => {
  if (value == null) return undefined
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Channel link ${field} must be a non-empty string`)
  }
  return value.trim()
}

const asStringList = (value: unknown, field: string) => {
  if (value == null) return undefined
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.trim() === '')) {
    throw new Error(`Channel link ${field} must be an array of non-empty strings`)
  }
  return value.map(item => item.trim())
}

const asIssuerAccountList = (value: unknown, field: string): ChannelLinkIssuerAccountRef[] | undefined => {
  if (value == null) return undefined
  if (!Array.isArray(value)) throw new Error(`Channel link ${field} must be an array of issuer-qualified accounts`)
  return value.map((item, index) => {
    if (
      !isRecord(item) || asString(item.issuerKey, `${field}[${index}].issuerKey`) == null ||
      asString(item.accountId, `${field}[${index}].accountId`) == null
    ) {
      throw new Error(`Channel link ${field}[${index}] must include issuerKey and accountId`)
    }
    return {
      accountId: asString(item.accountId, `${field}[${index}].accountId`)!,
      issuerKey: asString(item.issuerKey, `${field}[${index}].issuerKey`)!
    }
  })
}

const asNonNegativeNumber = (value: unknown, field: string) => {
  if (value == null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`Channel link ${field} must be a non-negative number`)
  }
  return value
}

const normalizeAvailability = (value: unknown): ChannelLinkAvailability | undefined => {
  if (value == null) return undefined
  if (!isRecord(value)) throw new Error('Channel link availability must be an object')
  const unknown = Object.keys(value).filter(key =>
    !['enabled', 'timezone', 'workHours', 'offHours', 'bypassUsers', 'bypassAccounts', 'bypassSenders'].includes(key)
  )
  if (unknown.length > 0) throw new Error(`Channel link availability contains unknown field ${unknown[0]}`)
  const workHours = value.workHours == null ? undefined : value.workHours
  if (
    workHours != null &&
    (!Array.isArray(workHours) ||
      workHours.some((item, index) =>
        !isRecord(item) || asString(item.start, `availability.workHours[${index}].start`) == null ||
        asString(item.end, `availability.workHours[${index}].end`) == null ||
        (item.days != null &&
          (!Array.isArray(item.days) || item.days.some(day => !Number.isInteger(day) || day < 1 || day > 7)))
      ))
  ) {
    throw new Error('Channel link availability.workHours must contain valid ISO weekday windows')
  }
  const offHours = value.offHours
  if (
    offHours != null &&
    (!isRecord(offHours) || (offHours.mode != null && offHours.mode !== 'buffer' && offHours.mode !== 'drop'))
  ) {
    throw new Error('Channel link availability.offHours.mode must be buffer or drop')
  }
  const throttle = offHours == null
    ? undefined
    : asNonNegativeNumber(
      (offHours as Record<string, unknown>).replyThrottleMs,
      'availability.offHours.replyThrottleMs'
    )
  return {
    enabled: asBoolean(value.enabled, 'availability.enabled', true),
    ...(asString(value.timezone, 'availability.timezone') == null
      ? {}
      : { timezone: asString(value.timezone, 'availability.timezone') }),
    ...(workHours == null ? {} : { workHours: workHours as ChannelLinkAvailability['workHours'] }),
    ...(offHours == null ? {} : {
      offHours: {
        ...(offHours.mode == null ? {} : { mode: offHours.mode as 'buffer' | 'drop' }),
        ...(asString(offHours.replyText, 'availability.offHours.replyText') == null
          ? {}
          : { replyText: asString(offHours.replyText, 'availability.offHours.replyText') }),
        ...(throttle == null ? {} : { replyThrottleMs: throttle })
      }
    }),
    ...(asStringList(value.bypassUsers, 'availability.bypassUsers') == null
      ? {}
      : { bypassUsers: asStringList(value.bypassUsers, 'availability.bypassUsers') }),
    ...(asIssuerAccountList(value.bypassAccounts, 'availability.bypassAccounts') == null
      ? {}
      : { bypassAccounts: asIssuerAccountList(value.bypassAccounts, 'availability.bypassAccounts') }),
    ...(asIssuerAccountList(value.bypassSenders, 'availability.bypassSenders') == null
      ? {}
      : { bypassSenders: asIssuerAccountList(value.bypassSenders, 'availability.bypassSenders') })
  }
}

const normalizeModerationLevels = (value: unknown): ChannelLinkModerationLevel[] | undefined => {
  if (value == null) return undefined
  if (!Array.isArray(value)) throw new Error('Channel link moderation.levels must be an array')
  return value.map((item, index) => {
    if (
      !isRecord(item) || !Number.isInteger(item.hit) || (item.hit as number) < 1 ||
      !['warn', 'mute', 'mute_permanent'].includes(item.action as string)
    ) {
      throw new Error(`Channel link moderation.levels[${index}] is invalid`)
    }
    const durationMs = asNonNegativeNumber(item.durationMs, `moderation.levels[${index}].durationMs`)
    if (item.action === 'mute' && (durationMs == null || durationMs === 0)) {
      throw new Error(`Channel link moderation.levels[${index}].durationMs is required for mute`)
    }
    return {
      action: item.action as ChannelLinkModerationLevel['action'],
      hit: item.hit as number,
      ...(durationMs == null ? {} : { durationMs })
    }
  })
}

const normalizeModeration = (value: unknown): ChannelLinkModeration | undefined => {
  if (value == null) return undefined
  if (!isRecord(value)) throw new Error('Channel link moderation must be an object')
  const unknown = Object.keys(value).filter(key =>
    ![
      'enabled',
      'reviewAdapter',
      'reviewModel',
      'reviewPrompt',
      'replyText',
      'replyThrottleMs',
      'subjectScope',
      'levels',
      'autoPermanentMute',
      'bypassUsers',
      'bypassAccounts',
      'bypassSenders'
    ].includes(key)
  )
  if (unknown.length > 0) throw new Error(`Channel link moderation contains unknown field ${unknown[0]}`)
  if (value.subjectScope != null && value.subjectScope !== 'account' && value.subjectScope !== 'user') {
    throw new Error('Channel link moderation.subjectScope is invalid')
  }
  return {
    enabled: asBoolean(value.enabled, 'moderation.enabled', true),
    ...(asString(value.reviewAdapter, 'moderation.reviewAdapter') == null
      ? {}
      : { reviewAdapter: asString(value.reviewAdapter, 'moderation.reviewAdapter') }),
    ...(asString(value.reviewModel, 'moderation.reviewModel') == null
      ? {}
      : { reviewModel: asString(value.reviewModel, 'moderation.reviewModel') }),
    ...(asString(value.reviewPrompt, 'moderation.reviewPrompt') == null
      ? {}
      : { reviewPrompt: asString(value.reviewPrompt, 'moderation.reviewPrompt') }),
    ...(asString(value.replyText, 'moderation.replyText') == null
      ? {}
      : { replyText: asString(value.replyText, 'moderation.replyText') }),
    ...(asNonNegativeNumber(value.replyThrottleMs, 'moderation.replyThrottleMs') == null
      ? {}
      : { replyThrottleMs: asNonNegativeNumber(value.replyThrottleMs, 'moderation.replyThrottleMs') }),
    ...(value.subjectScope == null ? { subjectScope: 'account' } : { subjectScope: value.subjectScope }),
    ...(normalizeModerationLevels(value.levels) == null
      ? { levels: [] }
      : { levels: normalizeModerationLevels(value.levels) }),
    autoPermanentMute: asBoolean(value.autoPermanentMute, 'moderation.autoPermanentMute', false),
    ...(asStringList(value.bypassUsers, 'moderation.bypassUsers') == null
      ? {}
      : { bypassUsers: asStringList(value.bypassUsers, 'moderation.bypassUsers') }),
    ...(asIssuerAccountList(value.bypassAccounts, 'moderation.bypassAccounts') == null
      ? {}
      : { bypassAccounts: asIssuerAccountList(value.bypassAccounts, 'moderation.bypassAccounts') }),
    ...(asIssuerAccountList(value.bypassSenders, 'moderation.bypassSenders') == null
      ? {}
      : { bypassSenders: asIssuerAccountList(value.bypassSenders, 'moderation.bypassSenders') })
  }
}

const normalizeRoute = (value: unknown, field: string): ChannelRoute => {
  if (!isRecord(value)) throw new Error(`Channel link ${field} must be an object`)
  const unknown = Object.keys(value).filter(key => !['adapter', 'effort', 'model', 'visibility'].includes(key))
  if (unknown.length > 0) throw new Error(`Channel link ${field} contains unknown route field ${unknown[0]}`)
  const visibility = value.visibility == null
    ? undefined
    : asString(value.visibility, `${field}.visibility`) as ChannelRouteVisibility
  if (visibility != null && !VISIBILITIES.has(visibility)) {
    throw new Error(`Channel link ${field}.visibility is invalid`)
  }
  const effort = value.effort == null ? undefined : asString(value.effort, `${field}.effort`)
  if (effort != null && !['low', 'medium', 'high', 'xhigh'].includes(effort)) {
    throw new Error(`Channel link ${field}.effort is invalid`)
  }
  return {
    ...(asString(value.adapter, `${field}.adapter`) == null
      ? {}
      : { adapter: asString(value.adapter, `${field}.adapter`) }),
    ...(effort == null ? {} : { effort: effort as ChannelRoute['effort'] }),
    ...(asString(value.model, `${field}.model`) == null ? {} : { model: asString(value.model, `${field}.model`) }),
    ...(visibility == null ? {} : { visibility })
  }
}

const normalizeRouting = (value: unknown): ChannelLinkRouting => {
  if (value == null) return { default: {} }
  if (!isRecord(value)) throw new Error('Channel link routing must be an object')
  const unknown = Object.keys(value).filter(key => !['default', 'modes', 'users', 'accounts'].includes(key))
  if (unknown.length > 0) throw new Error(`Channel link routing contains unknown field ${unknown[0]}`)
  const modes = value.modes == null ? {} : (() => {
    if (!isRecord(value.modes)) throw new Error('Channel link routing.modes must be an object')
    return Object.fromEntries(
      Object.entries(value.modes).map(([mode, route]) => {
        if (!ROUTE_MODES.has(mode as ChannelRouteMode)) throw new Error(`Channel link routing.modes.${mode} is invalid`)
        return [mode, normalizeRoute(route, `routing.modes.${mode}`)]
      })
    ) as ChannelLinkRouting['modes']
  })()
  const users = value.users == null ? {} : normalizeOverrides(value.users, 'routing.users')
  const accounts = value.accounts == null ? {} : normalizeAccountOverrides(value.accounts)
  return {
    default: value.default == null ? {} : normalizeRoute(value.default, 'routing.default'),
    modes,
    users,
    accounts
  }
}

const normalizeOverrides = (value: unknown, field: string): Record<string, ChannelRoute> => {
  if (!isRecord(value)) throw new Error(`Channel link ${field} must be an object`)
  return Object.fromEntries(
    Object.entries(value).map(([key, route]) => {
      if (key.trim() === '') throw new Error(`Channel link ${field} has an empty key`)
      return [key, normalizeRoute(route, `${field}.${key}`)]
    })
  )
}

const normalizeAccountOverrides = (value: unknown): Record<string, Record<string, ChannelRoute>> => {
  if (!isRecord(value)) throw new Error('Channel link routing.accounts must be an object')
  return Object.fromEntries(
    Object.entries(value).map(([issuer, accountOverrides]) => {
      if (issuer.trim() === '') throw new Error('Channel link routing.accounts has an empty issuer')
      return [issuer, normalizeOverrides(accountOverrides, `routing.accounts.${issuer}`)]
    })
  )
}

const normalizeIngress = (
  value: unknown,
  warn: (message: string) => void
):
  & Required<
    Pick<
      ChannelLinkIngress,
      'ambientRouting' | 'createOnMention' | 'createOnCommand' | 'createOnReplyToBot' | 'createOnPendingIntent'
    >
  >
  & ChannelLinkIngress =>
{
  if (value != null && !isRecord(value)) throw new Error('Channel link ingress must be an object')
  const ingress = value ?? {}
  const unknown = Object.keys(ingress).filter(key =>
    ![
      'ambientRouting',
      'createOnCommand',
      'createOnMention',
      'createOnPendingIntent',
      'createOnReplyToBot',
      'mentionPatterns',
      'observeWindow',
      'routerAdapter',
      'routerModel',
      'routerPrompt'
    ].includes(key)
  )
  if (unknown.length > 0) throw new Error(`Channel link ingress contains unknown field ${unknown[0]}`)
  const observe = ingress.observeWindow
  if (observe != null && !isRecord(observe)) throw new Error('Channel link ingress.observeWindow must be an object')
  const maxTurns = observe?.maxTurns
  const ttlSeconds = observe?.ttlSeconds
  if (maxTurns != null && (typeof maxTurns !== 'number' || !Number.isInteger(maxTurns) || maxTurns < 0)) {
    throw new Error('Channel link ingress.observeWindow.maxTurns must be a non-negative integer')
  }
  if (ttlSeconds != null && (typeof ttlSeconds !== 'number' || !Number.isInteger(ttlSeconds) || ttlSeconds < 0)) {
    throw new Error('Channel link ingress.observeWindow.ttlSeconds must be a non-negative integer')
  }
  if (Object.hasOwn(ingress, 'routerPrompt')) {
    warn('Channel link ingress.routerPrompt is deprecated; migrate to routerPrompt in your ingress router policy.')
  }
  const mentionPatterns = ingress.mentionPatterns
  if (
    mentionPatterns != null &&
    (!Array.isArray(mentionPatterns) || mentionPatterns.some(item => typeof item !== 'string'))
  ) {
    throw new Error('Channel link ingress.mentionPatterns must be a string array')
  }
  const routerAdapter = asString(ingress.routerAdapter, 'ingress.routerAdapter')
  const routerModel = asString(ingress.routerModel, 'ingress.routerModel')
  const routerPrompt = asString(ingress.routerPrompt, 'ingress.routerPrompt')
  return {
    ambientRouting: asBoolean(ingress.ambientRouting, 'ingress.ambientRouting', false),
    createOnMention: asBoolean(ingress.createOnMention, 'ingress.createOnMention', true),
    createOnCommand: asBoolean(ingress.createOnCommand, 'ingress.createOnCommand', true),
    createOnReplyToBot: asBoolean(ingress.createOnReplyToBot, 'ingress.createOnReplyToBot', true),
    createOnPendingIntent: asBoolean(ingress.createOnPendingIntent, 'ingress.createOnPendingIntent', true),
    ...(mentionPatterns == null ? {} : { mentionPatterns: mentionPatterns.map(item => item.trim()).filter(Boolean) }),
    ...(routerAdapter == null ? {} : { routerAdapter }),
    ...(routerModel == null ? {} : { routerModel }),
    ...(routerPrompt == null ? {} : { routerPrompt }),
    ...(observe == null
      ? {}
      : { observeWindow: { ...(maxTurns == null ? {} : { maxTurns }), ...(ttlSeconds == null ? {} : { ttlSeconds }) } })
  }
}

export const normalizeChannelLink = (value: Record<string, unknown>, warn: (message: string) => void): ChannelLink => ({
  ...value,
  channel: value.channel as string,
  entity: value.entity as string,
  external: value.external as ChannelLink['external'],
  ingress: normalizeIngress(value.ingress, warn),
  ...(normalizeAvailability(value.availability) == null
    ? {}
    : { availability: normalizeAvailability(value.availability) }),
  ...(normalizeModeration(value.moderation) == null ? {} : { moderation: normalizeModeration(value.moderation) }),
  routing: normalizeRouting(value.routing)
})
