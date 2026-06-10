import { resolveConfigState } from '@oneworks/config'
import type { AdapterCtx, Config, PermissionInteractionDecision } from '@oneworks/types'
import { normalizePermissionToolName, splitManagedPermissionKeys } from '@oneworks/utils'

export type ManagedPermissionDecision = 'allow' | 'deny' | 'ask' | 'inherit'

export interface KimiPermissionSubject {
  subjectKey: string
  subjectLabel: string
  subjectLookupKeys?: string[]
  decisionKeys: string[]
}

const normalizeKimiPermissionSubjectKey = (sender: string | undefined) => {
  switch (sender) {
    case 'Shell':
      return 'Bash'
    case 'ReadFile':
    case 'ReadMediaFile':
      return 'Read'
    case 'WriteFile':
      return 'Write'
    case 'StrReplaceFile':
      return 'Edit'
    case 'Agent':
      return 'Task'
    case 'AskUserQuestion':
      return 'Question'
    case 'SearchWeb':
      return 'WebSearch'
    case 'FetchURL':
      return 'WebFetch'
    default:
      return sender?.trim() || 'tool'
  }
}

export const buildKimiPermissionSubject = (sender: string | undefined): KimiPermissionSubject => {
  const subjectKey = normalizeKimiPermissionSubjectKey(sender)
  const normalizedSender = sender == null ? undefined : normalizePermissionToolName(sender)?.key
  const rawLookupKey = sender?.trim()
  const subjectLookupKeys = rawLookupKey == null || rawLookupKey === '' ? undefined : [rawLookupKey]
  const decisionKeys = [
    subjectKey,
    normalizedSender,
    rawLookupKey
  ].filter((value): value is string => typeof value === 'string' && value.trim() !== '')

  return {
    subjectKey,
    subjectLabel: rawLookupKey ?? subjectKey,
    ...(subjectLookupKeys != null ? { subjectLookupKeys } : {}),
    decisionKeys: [...new Set(decisionKeys)]
  }
}

export const resolveManagedPermissionDecision = (params: {
  permissions?: Config['permissions']
  subjectKeys: string[]
}): ManagedPermissionDecision => {
  const subjectKeySet = new Set(splitManagedPermissionKeys(params.subjectKeys).bare)
  const hasMatchingKey = (values: string[] | undefined) =>
    splitManagedPermissionKeys(values).bare.some(value => subjectKeySet.has(value))

  if (hasMatchingKey(params.permissions?.deny)) return 'deny'
  if (hasMatchingKey(params.permissions?.ask)) return 'ask'
  if (hasMatchingKey(params.permissions?.allow)) return 'allow'
  return 'inherit'
}

export const resolveManagedPermissionDecisionForCtx = (params: {
  ctx: AdapterCtx
  subjectKeys: string[]
}) => {
  const permissions = resolveConfigState({
    configState: params.ctx.configState,
    configs: params.ctx.configs
  }).mergedConfig.permissions

  return resolveManagedPermissionDecision({
    permissions,
    subjectKeys: params.subjectKeys
  })
}

export interface KimiSessionPermissionState {
  allow: Set<string>
  deny: Set<string>
}

export const createKimiSessionPermissionState = (): KimiSessionPermissionState => ({
  allow: new Set<string>(),
  deny: new Set<string>()
})

export const resolveSessionPermissionDecision = (params: {
  state: KimiSessionPermissionState
  subjectKeys: string[]
}): ManagedPermissionDecision => {
  const subjectKeySet = new Set(splitManagedPermissionKeys(params.subjectKeys).bare)
  const hasMatch = (values: Set<string>) => [...values].some(value => subjectKeySet.has(value))

  if (hasMatch(params.state.deny)) return 'deny'
  if (hasMatch(params.state.allow)) return 'allow'
  return 'inherit'
}

export const rememberSessionPermissionDecision = (params: {
  state: KimiSessionPermissionState
  subjectKeys: string[]
  action: PermissionInteractionDecision
}) => {
  const normalizedKeys = splitManagedPermissionKeys(params.subjectKeys).bare
  if (normalizedKeys.length === 0) return

  if (params.action === 'allow_session' || params.action === 'allow_project') {
    for (const key of normalizedKeys) {
      params.state.deny.delete(key)
      params.state.allow.add(key)
    }
    return
  }

  if (params.action === 'deny_session' || params.action === 'deny_project') {
    for (const key of normalizedKeys) {
      params.state.allow.delete(key)
      params.state.deny.add(key)
    }
  }
}
