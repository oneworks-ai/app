import { readFile } from 'node:fs/promises'

import { resolveConfigState } from '@oneworks/config'
import type {
  AdapterCtx,
  AdapterInteractionRequest,
  AdapterQueryOptions,
  PermissionInteractionDecision
} from '@oneworks/types'
import {
  normalizePermissionToolName,
  parseStrictPermissionMirror,
  resolvePermissionMirrorPath,
  splitManagedPermissionKeys
} from '@oneworks/utils'

import { PI_PERMISSION_PREFIX } from './permission-extension'
import type { PiConfiguredPermission } from './permission-extension'

export {
  PI_PERMISSION_ALLOW,
  PI_PERMISSION_DENY,
  PI_PERMISSION_PREFIX,
  buildPiPermissionExtension
} from './permission-extension'
export type { PiConfiguredPermission } from './permission-extension'

export interface PiPermissionPayload {
  input: Record<string, unknown>
  toolName: string
}

export interface PiSessionPermissionState {
  allow: Set<string>
  deny: Set<string>
  onceAllow: Set<string>
  onceDeny: Set<string>
}

const buildPermissionOptions = () => [
  { label: '同意本次', value: 'allow_once', description: '仅继续这次被拦截的操作。' },
  { label: '同意并在当前会话忽略类似调用', value: 'allow_session', description: '本会话内同类工具不再重复询问。' },
  { label: '同意并在当前项目忽略类似调用', value: 'allow_project', description: '写入 .oo.config.json。' },
  { label: '拒绝本次', value: 'deny_once', description: '拒绝当前这次操作。' },
  { label: '拒绝并在当前会话阻止类似调用', value: 'deny_session', description: '本会话内同类工具直接拒绝。' },
  { label: '拒绝并在当前项目阻止类似调用', value: 'deny_project', description: '写入 .oo.config.json。' }
]

export const resolvePiPermissionSubjectKey = (toolName: string) => {
  switch (toolName.toLowerCase()) {
    case 'bash':
      return 'Bash'
    case 'edit':
      return 'Edit'
    case 'write':
      return 'Write'
    case 'read':
      return 'Read'
    default:
      return normalizePermissionToolName(toolName)?.key ?? toolName
  }
}

export const parsePiPermissionTitle = (title: string): PiPermissionPayload | undefined => {
  if (!title.startsWith(PI_PERMISSION_PREFIX)) return undefined
  try {
    const value = JSON.parse(title.slice(PI_PERMISSION_PREFIX.length)) as unknown
    if (value == null || typeof value !== 'object' || Array.isArray(value)) return undefined
    const record = value as Record<string, unknown>
    if (typeof record.toolName !== 'string') return undefined
    return {
      toolName: record.toolName,
      input: record.input != null && typeof record.input === 'object' && !Array.isArray(record.input)
        ? record.input as Record<string, unknown>
        : {}
    }
  } catch {
    return undefined
  }
}

export const buildPiPermissionInteraction = (params: {
  interactionId: string
  payload: PiPermissionPayload
  permissionMode: AdapterQueryOptions['permissionMode']
  sessionId: string
}): AdapterInteractionRequest => {
  const subjectKey = resolvePiPermissionSubjectKey(params.payload.toolName)
  const details = params.payload.toolName === 'bash' && typeof params.payload.input.command === 'string'
    ? params.payload.input.command
    : JSON.stringify(params.payload.input)
  return {
    id: params.interactionId,
    payload: {
      sessionId: params.sessionId,
      kind: 'permission',
      question: `允许 Pi 执行 ${subjectKey}？${details ? `\n${details}` : ''}`,
      options: buildPermissionOptions(),
      permissionContext: {
        adapter: 'pi',
        currentMode: params.permissionMode,
        deniedTools: [subjectKey],
        reasons: details ? [details] : [],
        subjectKey,
        subjectLookupKeys: [params.payload.toolName],
        subjectLabel: params.payload.toolName,
        scope: 'tool',
        projectConfigPath: '.oo.config.json'
      }
    }
  }
}

export const resolveConfiguredPiPermission = (ctx: AdapterCtx, toolName: string): PiConfiguredPermission => {
  const permissions =
    resolveConfigState({ configState: ctx.configState, configs: ctx.configs }).mergedConfig.permissions
  const subjectKeys = splitManagedPermissionKeys([resolvePiPermissionSubjectKey(toolName), toolName]).bare
  const matches = (values: string[] | undefined) => (
    splitManagedPermissionKeys(values).bare.some(value => subjectKeys.includes(value))
  )
  if (matches(permissions?.deny)) return 'deny'
  if (matches(permissions?.ask)) return 'ask'
  if (matches(permissions?.allow)) return 'allow'
  return 'inherit'
}

export const createPiSessionPermissionState = (): PiSessionPermissionState => ({
  allow: new Set(),
  deny: new Set(),
  onceAllow: new Set(),
  onceDeny: new Set()
})

export const readPiPersistedSessionPermissionState = async (
  ctx: AdapterCtx,
  sessionId: string,
  readMirror: typeof readFile = readFile
): Promise<PiSessionPermissionState> => {
  try {
    const mirrorPath = resolvePermissionMirrorPath(ctx.cwd, 'pi', sessionId, ctx.env)
    const normalized = parseStrictPermissionMirror(await readMirror(mirrorPath, 'utf8'), {
      adapter: 'pi',
      sessionId
    })
    return {
      allow: new Set(normalized.allow),
      deny: new Set(normalized.deny),
      onceAllow: new Set(normalized.onceAllow),
      onceDeny: new Set(normalized.onceDeny)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return createPiSessionPermissionState()
    throw error
  }
}

export const resolvePiSessionPermission = (state: PiSessionPermissionState, toolName: string) => {
  const key = resolvePiPermissionSubjectKey(toolName)
  if (state.deny.has(key)) return 'deny'
  if (state.allow.has(key)) return 'allow'
  return 'inherit'
}

export const resolvePiOneTimeSessionPermission = (state: PiSessionPermissionState, toolName: string) => {
  const key = resolvePiPermissionSubjectKey(toolName)
  if (state.onceDeny.has(key)) return 'deny'
  if (state.onceAllow.has(key)) return 'allow'
  return 'inherit'
}

export const rememberPiSessionPermission = (
  state: PiSessionPermissionState,
  toolName: string,
  decision: PermissionInteractionDecision
) => {
  const key = resolvePiPermissionSubjectKey(toolName)
  if (decision === 'allow_session' || decision === 'allow_project') {
    state.deny.delete(key)
    state.allow.add(key)
  } else if (decision === 'deny_session' || decision === 'deny_project') {
    state.allow.delete(key)
    state.deny.add(key)
  }
}

export const isPermissionDecision = (value: string): value is PermissionInteractionDecision => (
  value === 'allow_once' || value === 'allow_session' || value === 'allow_project' ||
  value === 'deny_once' || value === 'deny_session' || value === 'deny_project'
)

export const isAllowDecision = (value: string) => (
  value === 'allow_once' || value === 'allow_session' || value === 'allow_project'
)
