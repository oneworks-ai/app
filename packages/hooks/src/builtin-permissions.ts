/* eslint-disable max-lines */

import { readFile, writeFile } from 'node:fs/promises'

import {
  TRUSTED_ONEWORKS_CLI_PERMISSION_BASH_LOOKUP_KEYS,
  migrateProjectHomeSegment,
  normalizePermissionToolName,
  normalizeSessionPermissionState,
  resolvePermissionMirrorPath,
  resolveTrustedOneworksCliPermissionSubjectFromToolCall,
  splitManagedPermissionKeys
} from '@oneworks/utils'
import type { PermissionToolSubject } from '@oneworks/utils'

import type { Plugin } from './context'
import { definePlugin } from './context'
import type { HookOutputs } from './type'

interface PermissionCheckResponse {
  result?: 'allow' | 'deny' | 'ask' | 'inherit'
  source?: string
  subject?: PermissionToolSubject
}

const readMirrorDecision = async (params: {
  cwd: string
  adapter: string
  env: Record<string, string | null | undefined>
  sessionId: string
  subject: PermissionToolSubject
  lookupKeys?: string[]
}) => {
  await migrateProjectHomeSegment(params.cwd, params.env as NodeJS.ProcessEnv, '.mock').catch(() => undefined)
  const mirrorPath = resolvePermissionMirrorPath(
    params.cwd,
    params.adapter,
    params.sessionId,
    params.env as NodeJS.ProcessEnv
  )

  try {
    const raw = await readFile(mirrorPath, 'utf8')
    const parsed = JSON.parse(raw) as {
      permissionState?: { allow?: string[]; deny?: string[]; onceAllow?: string[]; onceDeny?: string[] }
      projectPermissions?: { allow?: string[]; deny?: string[]; ask?: string[] }
    }
    const permissionState = normalizeSessionPermissionState(parsed.permissionState)
    const projectPermissions = {
      allow: splitManagedPermissionKeys(parsed.projectPermissions?.allow).bare,
      deny: splitManagedPermissionKeys(parsed.projectPermissions?.deny).bare,
      ask: splitManagedPermissionKeys(parsed.projectPermissions?.ask).bare
    }
    const keys = [
      params.subject.key,
      ...(params.lookupKeys ?? [])
    ]
      .map(key => normalizePermissionToolName(key)?.key ?? key.trim())
      .filter((key): key is string => key !== '')
    const onceDeny = permissionState.onceDeny
    const matchedOnceDenyKeys = keys.filter(key => onceDeny.includes(key))
    if (matchedOnceDenyKeys.length > 0) {
      parsed.permissionState = {
        ...permissionState,
        onceDeny: onceDeny.filter(item => !matchedOnceDenyKeys.includes(item))
      }
      await writeFile(
        mirrorPath,
        `${JSON.stringify(parsed, null, 2)}\n`,
        'utf8'
      )
      return 'deny' as const
    }
    const onceAllow = permissionState.onceAllow
    const matchedOnceAllowKeys = keys.filter(key => onceAllow.includes(key))
    if (matchedOnceAllowKeys.length > 0) {
      parsed.permissionState = {
        ...permissionState,
        onceAllow: onceAllow.filter(item => !matchedOnceAllowKeys.includes(item))
      }
      await writeFile(
        mirrorPath,
        `${JSON.stringify(parsed, null, 2)}\n`,
        'utf8'
      )
      return 'allow' as const
    }
    if (keys.some(key => permissionState.deny.includes(key) || projectPermissions.deny.includes(key))) {
      return 'deny' as const
    }
    if (keys.some(key => permissionState.allow.includes(key) || projectPermissions.allow.includes(key))) {
      return 'allow' as const
    }
  } catch {
  }

  return 'inherit' as const
}

const postPermissionCheck = async (params: {
  host: string
  port: string
  sessionId: string
  adapter: string
  toolName?: string
  toolInput?: unknown
}) => {
  const response = await fetch(`http://${params.host}:${params.port}/api/interact/permission-check`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      sessionId: params.sessionId,
      adapter: params.adapter,
      toolName: params.toolName,
      toolInput: params.toolInput
    })
  })

  if (!response.ok) {
    throw new Error(`permission-check failed with ${response.status}`)
  }

  return await response.json() as PermissionCheckResponse
}

const describeDecision = (
  subject: PermissionToolSubject | undefined,
  prefix: string,
  fallback: string
) => (
  subject?.label != null && subject.label !== '' ? `${prefix} ${subject.label}` : fallback
)

const buildPermissionOutput = (
  decision: 'allow' | 'deny' | 'ask',
  subject: PermissionToolSubject | undefined,
  source: 'remembered' | 'server'
): HookOutputs['PreToolUse'] => ({
  continue: decision !== 'deny',
  ...(decision === 'deny'
    ? {
      stopReason: describeDecision(subject, 'Permission denied for', 'Permission denied by remembered rule')
    }
    : {}),
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: decision,
    permissionDecisionReason: describeDecision(
      subject,
      source === 'server'
        ? 'Server requires confirmation for'
        : decision === 'deny'
        ? 'Remembered deny rule for'
        : 'Remembered allow rule for',
      source === 'server'
        ? 'Server requires confirmation'
        : decision === 'deny'
        ? 'Remembered deny rule'
        : 'Remembered allow rule'
    )
  }
})

export const createBuiltinPermissionPlugin = (
  env: Record<string, string | null | undefined>
): Partial<Plugin> =>
  definePlugin({
    name: 'builtin-permissions',
    PreToolUse: async (_ctx, input, next) => {
      if (input.hookSource !== 'native' || input.canBlock === false) {
        return next()
      }
      if (
        input.adapter !== 'claude-code' &&
        input.adapter !== 'gemini' &&
        input.adapter !== 'kimi' &&
        input.adapter !== 'opencode'
      ) {
        return next()
      }

      const host = env.__ONEWORKS_PROJECT_SERVER_HOST__?.trim()
      const port = env.__ONEWORKS_PROJECT_SERVER_PORT__?.trim()
      const sessionId = input.sessionId.trim()
      const adapter = input.adapter
      const trustedOneworksCliSubject = resolveTrustedOneworksCliPermissionSubjectFromToolCall({
        toolName: input.toolName,
        toolInput: input.toolInput
      })
      const subject = trustedOneworksCliSubject ?? normalizePermissionToolName(input.toolName)
      const lookupKeys = trustedOneworksCliSubject == null ? [] : TRUSTED_ONEWORKS_CLI_PERMISSION_BASH_LOOKUP_KEYS
      let serverDecision: PermissionCheckResponse['result']

      try {
        if (host != null && host !== '' && port != null && port !== '') {
          const result = await postPermissionCheck({
            host,
            port,
            sessionId,
            adapter,
            toolName: input.toolName,
            toolInput: input.toolInput
          })
          serverDecision = result.result
          if (result.result === 'deny') {
            return buildPermissionOutput('deny', result.subject, 'remembered')
          }
          if (result.result === 'allow') {
            return buildPermissionOutput('allow', result.subject, 'remembered')
          }
          if (result.result === 'ask') {
            return buildPermissionOutput('ask', result.subject ?? subject, 'server')
          }
        }
      } catch {
      }

      if (subject == null) {
        return next()
      }

      const fallback = await readMirrorDecision({
        cwd: input.cwd,
        adapter,
        env,
        sessionId,
        subject,
        lookupKeys
      })
      if (fallback === 'deny') {
        return buildPermissionOutput('deny', subject, 'remembered')
      }
      if (fallback === 'allow') {
        return buildPermissionOutput('allow', subject, 'remembered')
      }
      if (serverDecision === 'inherit') {
        return buildPermissionOutput('ask', subject, 'server')
      }

      return next()
    }
  })
