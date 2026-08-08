import { readFile } from 'node:fs/promises'
import process from 'node:process'

import { buildConfigJsonVariables, buildConfigSections, loadConfigState, updateConfigFile } from '@oneworks/config'
import type { Config, PermissionInteractionDecision } from '@oneworks/types'
import {
  createEmptySessionPermissionState,
  migrateProjectHomeSegment,
  normalizePermissionToolName,
  normalizeSessionPermissionState,
  parseStrictPermissionMirror,
  resolvePermissionMirrorPath,
  withPrivatePermissionMirrorLock,
  writePrivatePermissionMirror
} from '@oneworks/utils'
import type { SessionPermissionState } from '@oneworks/utils'

const uniqueStrings = (values: string[]) => [...new Set(values)]

const normalizeKeys = (values: string[]) =>
  uniqueStrings(
    values
      .map((value) => normalizePermissionToolName(value)?.key ?? value.trim())
      .filter((value): value is string => value.trim() !== '')
  )

const removeKeys = (values: string[], keys: Set<string>) => (
  values.filter((value) => {
    const normalized = normalizePermissionToolName(value)?.key ?? value.trim()
    return !keys.has(normalized)
  })
)

const buildGeneralSectionValue = (config: Config | undefined, permissions: Config['permissions']) => (
  buildConfigSections({
    ...(config ?? {}),
    permissions
  }).general
)

const mutateSessionPermissionState = (
  state: SessionPermissionState,
  keys: string[],
  action: PermissionInteractionDecision
) => {
  const targetKeys = normalizeKeys(keys)
  const keySet = new Set(targetKeys)
  const next = normalizeSessionPermissionState(state)

  if (action === 'allow_once') {
    next.onceAllow = uniqueStrings([...removeKeys(next.onceAllow, keySet), ...targetKeys])
    next.onceDeny = removeKeys(next.onceDeny, keySet)
    return next
  }
  if (action === 'allow_session' || action === 'allow_project') {
    next.allow = uniqueStrings([...removeKeys(next.allow, keySet), ...targetKeys])
    next.deny = removeKeys(next.deny, keySet)
    next.onceAllow = removeKeys(next.onceAllow, keySet)
    next.onceDeny = removeKeys(next.onceDeny, keySet)
    return next
  }
  if (action === 'deny_session' || action === 'deny_project') {
    next.deny = uniqueStrings([...removeKeys(next.deny, keySet), ...targetKeys])
    next.allow = removeKeys(next.allow, keySet)
    next.onceAllow = removeKeys(next.onceAllow, keySet)
    next.onceDeny = removeKeys(next.onceDeny, keySet)
    return next
  }
  return next
}

const loadTaskConfigState = async (cwd: string) =>
  await loadConfigState({
    cwd,
    jsonVariables: buildConfigJsonVariables(cwd, process.env)
  })

export const readCliSessionPermissionState = async (
  cwd: string,
  adapter: string | undefined,
  sessionId: string,
  readMirror: typeof readFile = readFile
) => {
  if (adapter !== 'claude-code' && adapter !== 'opencode' && adapter !== 'pi') {
    return createEmptySessionPermissionState()
  }
  await migrateProjectHomeSegment(cwd, process.env, '.mock').catch(() => undefined)

  try {
    const raw = await readMirror(resolvePermissionMirrorPath(cwd, adapter, sessionId), 'utf8')
    if (adapter === 'pi') return parseStrictPermissionMirror(raw, { adapter, sessionId })
    const parsed = JSON.parse(raw) as { permissionState?: SessionPermissionState }
    return normalizeSessionPermissionState(parsed.permissionState)
  } catch (error) {
    if (adapter === 'pi' && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return createEmptySessionPermissionState()
  }
}

const buildMergedProjectPermissions = async (cwd: string) => {
  const { effectiveProjectConfig, projectConfig, userConfig } = await loadTaskConfigState(cwd)
  const config = effectiveProjectConfig ?? projectConfig
  return {
    allow: [...(config?.permissions?.allow ?? []), ...(userConfig?.permissions?.allow ?? [])],
    deny: [...(config?.permissions?.deny ?? []), ...(userConfig?.permissions?.deny ?? [])],
    ask: [...(config?.permissions?.ask ?? []), ...(userConfig?.permissions?.ask ?? [])]
  }
}

const updateProjectPermissionLists = async (cwd: string, keys: string[], target: 'allow' | 'deny') => {
  const targetKeys = normalizeKeys(keys)
  const keySet = new Set(targetKeys)
  const configState = await loadTaskConfigState(cwd)
  const projectConfig = configState.projectSource?.rawConfig
  const existingPermissions = projectConfig?.permissions ?? {}
  const nextPermissions: Config['permissions'] = {
    ...existingPermissions,
    allow: removeKeys(existingPermissions.allow ?? [], keySet),
    deny: removeKeys(existingPermissions.deny ?? [], keySet),
    ask: removeKeys(existingPermissions.ask ?? [], keySet)
  }
  nextPermissions[target] = uniqueStrings([...(nextPermissions[target] ?? []), ...targetKeys])

  await updateConfigFile({
    workspaceFolder: cwd,
    source: 'project',
    section: 'general',
    value: buildGeneralSectionValue(projectConfig, nextPermissions)
  })
}

const syncPermissionStateMirror = async (params: {
  cwd: string
  adapter?: string
  sessionId: string
  permissionState: SessionPermissionState
}, withinMirrorLock = false): Promise<void> => {
  if (params.adapter !== 'claude-code' && params.adapter !== 'opencode' && params.adapter !== 'pi') return
  await migrateProjectHomeSegment(params.cwd, process.env, '.mock').catch(() => undefined)

  const mirrorPath = resolvePermissionMirrorPath(params.cwd, params.adapter, params.sessionId)
  if (params.adapter === 'pi' && !withinMirrorLock) {
    await withPrivatePermissionMirrorLock(mirrorPath, async (): Promise<void> => {
      await syncPermissionStateMirror(params, true)
    })
    return
  }
  const projectPermissions = await buildMergedProjectPermissions(params.cwd)
  await writePrivatePermissionMirror(
    mirrorPath,
    `${
      JSON.stringify(
        {
          sessionId: params.sessionId,
          adapter: params.adapter,
          permissionState: normalizeSessionPermissionState(params.permissionState),
          projectPermissions,
          updatedAt: Date.now()
        },
        null,
        2
      )
    }\n`
  )
}

export const applyCliPermissionDecision = async (params: {
  cwd: string
  sessionId: string
  adapter?: string
  subjectKeys: string[]
  action: PermissionInteractionDecision
  readMirror?: typeof readFile
}) => {
  const subjectKeys = normalizeKeys(params.subjectKeys)
  if (subjectKeys.length === 0) return createEmptySessionPermissionState()
  const apply = async (withinMirrorLock: boolean) => {
    const currentState = await readCliSessionPermissionState(
      params.cwd,
      params.adapter,
      params.sessionId,
      params.readMirror
    )
    if (params.action === 'allow_project') await updateProjectPermissionLists(params.cwd, subjectKeys, 'allow')
    if (params.action === 'deny_project') await updateProjectPermissionLists(params.cwd, subjectKeys, 'deny')

    const nextState = mutateSessionPermissionState(currentState, subjectKeys, params.action)
    await syncPermissionStateMirror({
      cwd: params.cwd,
      adapter: params.adapter,
      sessionId: params.sessionId,
      permissionState: nextState
    }, withinMirrorLock)
    return nextState
  }
  if (params.adapter !== 'pi') return await apply(false)
  const mirrorPath = resolvePermissionMirrorPath(params.cwd, 'pi', params.sessionId)
  return await withPrivatePermissionMirrorLock(mirrorPath, async () => await apply(true))
}
