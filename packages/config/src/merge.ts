import type { Config, NotificationConfig, NotificationEventConfig } from '@oneworks/types'
import {
  mergeAdapterConfigs,
  mergeConfiguredSkillRegistries,
  mergeMarketplaceConfigs,
  mergePluginConfigs,
  mergeSkillsMeta
} from '@oneworks/utils'

import { mergeSkills } from './merge-skills'
import { mergeWorkspaceConfigs } from './workspace-config'

const hasOwnKeys = (value: Record<string, unknown>) => Object.keys(value).length > 0
export const mergeRecord = <T>(
  left?: Record<string, T>,
  right?: Record<string, T>
) => {
  if (left == null && right == null) return undefined

  return {
    ...(left ?? {}),
    ...(right ?? {})
  }
}

export const mergeList = <T>(
  left?: T[],
  right?: T[]
) => {
  if (left == null && right == null) return undefined
  return [
    ...(left ?? []),
    ...(right ?? [])
  ]
}

export const mergeUniqueList = <T>(
  left?: T[],
  right?: T[]
) => {
  const merged = mergeList(left, right)
  return merged == null ? undefined : Array.from(new Set(merged))
}

const mergeNotificationEventConfigs = (
  left?: Partial<Record<string, NotificationEventConfig>>,
  right?: Partial<Record<string, NotificationEventConfig>>
) => {
  const keys = new Set([
    ...Object.keys(left ?? {}),
    ...Object.keys(right ?? {})
  ])

  if (keys.size === 0) return undefined

  const merged = Object.fromEntries(
    Array.from(keys).map((key) => [
      key,
      {
        ...(left?.[key] ?? {}),
        ...(right?.[key] ?? {})
      }
    ])
  ) as Partial<Record<string, NotificationEventConfig>>

  return hasOwnKeys(merged as Record<string, unknown>) ? merged : undefined
}

const mergeNotifications = (
  left?: NotificationConfig,
  right?: NotificationConfig
) => {
  if (left == null && right == null) return undefined

  const merged: NotificationConfig = {
    ...(left ?? {}),
    ...(right ?? {}),
    events: mergeNotificationEventConfigs(left?.events, right?.events)
  }

  return hasOwnKeys(merged as Record<string, unknown>) ? merged : undefined
}

const mergeMessageLinks = (
  left?: Config['messageLinks'],
  right?: Config['messageLinks']
) => {
  if (left == null && right == null) return undefined

  const merged: NonNullable<Config['messageLinks']> = {
    ...(left ?? {}),
    ...(right ?? {})
  }

  return hasOwnKeys(merged as Record<string, unknown>) ? merged : undefined
}

const mergePermissions = (
  left?: Config['permissions'],
  right?: Config['permissions']
) => {
  if (left == null && right == null) return undefined

  const merged: NonNullable<Config['permissions']> = {
    ...(left ?? {}),
    ...(right ?? {}),
    allow: mergeList(left?.allow, right?.allow),
    deny: mergeList(left?.deny, right?.deny),
    ask: mergeList(left?.ask, right?.ask)
  }

  return hasOwnKeys(merged as Record<string, unknown>) ? merged : undefined
}

const mergeConversation = (
  left?: Config['conversation'],
  right?: Config['conversation']
) => {
  if (left == null && right == null) return undefined

  const merged: NonNullable<Config['conversation']> = {
    ...(left ?? {}),
    ...(right ?? {}),
    startupPresets: mergeList(left?.startupPresets, right?.startupPresets),
    builtinActions: mergeList(left?.builtinActions, right?.builtinActions),
    runCommands: mergeList(left?.runCommands, right?.runCommands)
  }

  return hasOwnKeys(merged as Record<string, unknown>) ? merged : undefined
}

const mergeVoiceServiceConfig = (
  left?: Record<string, unknown>,
  right?: Record<string, unknown>
) => {
  if (left == null && right == null) return undefined

  const leftRequest = left?.request as Record<string, unknown> | undefined
  const rightRequest = right?.request as Record<string, unknown> | undefined
  const leftBody = leftRequest?.body as Record<string, unknown> | undefined
  const rightBody = rightRequest?.body as Record<string, unknown> | undefined

  return {
    ...(left ?? {}),
    ...(right ?? {}),
    capabilities: mergeRecord(
      left?.capabilities as Record<string, unknown> | undefined,
      right?.capabilities as Record<string, unknown> | undefined
    ),
    request: leftRequest == null && rightRequest == null
      ? undefined
      : {
        ...(leftRequest ?? {}),
        ...(rightRequest ?? {}),
        headers: mergeRecord(
          leftRequest?.headers as Record<string, string> | undefined,
          rightRequest?.headers as Record<string, string> | undefined
        ),
        body: leftBody == null && rightBody == null
          ? undefined
          : {
            ...(leftBody ?? {}),
            ...(rightBody ?? {}),
            fields: mergeRecord(
              leftBody?.fields as Record<string, unknown> | undefined,
              rightBody?.fields as Record<string, unknown> | undefined
            )
          }
      },
    response: mergeRecord(
      left?.response as Record<string, unknown> | undefined,
      right?.response as Record<string, unknown> | undefined
    )
  }
}

const mergeVoiceServices = (
  left?: NonNullable<NonNullable<Config['voice']>['speechToText']>['services'],
  right?: NonNullable<NonNullable<Config['voice']>['speechToText']>['services']
) => {
  const keys = new Set([
    ...Object.keys(left ?? {}),
    ...Object.keys(right ?? {})
  ])

  if (keys.size === 0) return undefined

  return Object.fromEntries(
    Array.from(keys).map((key) => [
      key,
      mergeVoiceServiceConfig(
        (left as Record<string, Record<string, unknown>> | undefined)?.[key],
        (right as Record<string, Record<string, unknown>> | undefined)?.[key]
      )
    ])
  ) as NonNullable<NonNullable<Config['voice']>['speechToText']>['services']
}

const mergeVoice = (
  left?: Config['voice'],
  right?: Config['voice']
) => {
  if (left == null && right == null) return undefined

  const merged: NonNullable<Config['voice']> = {
    ...(left ?? {}),
    ...(right ?? {}),
    speechToText: left?.speechToText == null && right?.speechToText == null
      ? undefined
      : {
        ...(left?.speechToText ?? {}),
        ...(right?.speechToText ?? {}),
        services: mergeVoiceServices(left?.speechToText?.services, right?.speechToText?.services)
      }
  }

  return hasOwnKeys(merged as Record<string, unknown>) ? merged : undefined
}

export function mergeConfigs(left: undefined, right: undefined): undefined
export function mergeConfigs<T extends Partial<Config>>(left: T, right: T): T
export function mergeConfigs<T extends Partial<Config>>(left: T | undefined, right: T): T
export function mergeConfigs<T extends Partial<Config>>(left: T, right: T | undefined): T
export function mergeConfigs<T extends Partial<Config>>(left?: T, right?: T): T | undefined
export function mergeConfigs<T extends Partial<Config>>(left?: T, right?: T) {
  const merged = {
    ...(left ?? {}),
    ...(right ?? {}),
    adapters: mergeAdapterConfigs(
      left?.adapters as Record<string, unknown> | undefined,
      right?.adapters as Record<string, unknown> | undefined
    ) as Config['adapters'],
    models: mergeRecord(left?.models, right?.models),
    modelServices: mergeRecord(left?.modelServices, right?.modelServices),
    workspaces: mergeWorkspaceConfigs(left?.workspaces, right?.workspaces),
    channels: mergeRecord(left?.channels, right?.channels),
    server: mergeRecord(
      left?.server as Record<string, unknown> | undefined,
      right?.server as Record<string, unknown> | undefined
    ) as Config['server'],
    mcpServers: mergeRecord(left?.mcpServers, right?.mcpServers),
    defaultIncludeMcpServers: mergeUniqueList(
      left?.defaultIncludeMcpServers,
      right?.defaultIncludeMcpServers
    ),
    defaultExcludeMcpServers: mergeUniqueList(
      left?.defaultExcludeMcpServers,
      right?.defaultExcludeMcpServers
    ),
    permissions: mergePermissions(left?.permissions, right?.permissions),
    env: mergeRecord(left?.env, right?.env),
    announcements: mergeList(left?.announcements, right?.announcements),
    shortcuts: mergeRecord(left?.shortcuts, right?.shortcuts),
    conversation: mergeConversation(left?.conversation, right?.conversation),
    webAuth: mergeRecord(
      left?.webAuth as Record<string, unknown> | undefined,
      right?.webAuth as Record<string, unknown> | undefined
    ) as Config['webAuth'],
    notifications: mergeNotifications(left?.notifications, right?.notifications),
    messageLinks: mergeMessageLinks(left?.messageLinks, right?.messageLinks),
    desktop: mergeRecord(
      left?.desktop as Record<string, unknown> | undefined,
      right?.desktop as Record<string, unknown> | undefined
    ) as Config['desktop'],
    skills: mergeSkills(left?.skills, right?.skills),
    skillsMeta: mergeSkillsMeta(left, right),
    skillRegistries: mergeConfiguredSkillRegistries(left, right),
    plugins: mergePluginConfigs(left?.plugins, right?.plugins) as Config['plugins'],
    marketplaces: mergeMarketplaceConfigs(left?.marketplaces, right?.marketplaces),
    voice: mergeVoice(left?.voice, right?.voice),
    diagnostics: mergeRecord(
      left?.diagnostics as Record<string, unknown> | undefined,
      right?.diagnostics as Record<string, unknown> | undefined
    ) as Config['diagnostics']
  }

  return merged as T
}
