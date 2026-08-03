import { parseAppBuildInfoJson } from '@oneworks/types'

import { getRuntimeClientBuildInfoJson } from '#~/runtime-config'
import type { RuntimeEnv } from '#~/runtime-config'

type ClientBuildEnv = Pick<
  RuntimeEnv,
  | '__ONEWORKS_PROJECT_CLIENT_BUILD_TIME__'
  | '__ONEWORKS_PROJECT_CLIENT_BUILD_TIME_SOURCE__'
  | '__ONEWORKS_PROJECT_CLIENT_COMMIT_HASH__'
  | '__ONEWORKS_PROJECT_CLIENT_VERSION__'
>

type BuildFields = {
  buildTime?: unknown
  buildTimeSource?: unknown
  commit?: unknown
  version?: unknown
}

const parseRuntimeBuildFields = (value: unknown): BuildFields => {
  if (typeof value !== 'string') return {}
  try {
    const parsed = JSON.parse(value)
    return parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as BuildFields
      : {}
  } catch {
    return {}
  }
}

const validVersion = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const normalized = parseAppBuildInfoJson(JSON.stringify({ version: value })).version
  return normalized === value.trim() ? normalized : undefined
}

const validCommit = (value: unknown) => (
  parseAppBuildInfoJson(JSON.stringify({ commit: value })).commit ?? undefined
)

const validBuildTime = (value: unknown) => (
  parseAppBuildInfoJson(JSON.stringify({ buildTime: value })).buildTime ?? undefined
)

export const resolveClientBuildInfo = (
  runtimeBuildInfoJson: unknown,
  compiledEnv: ClientBuildEnv
) => {
  const runtime = parseRuntimeBuildFields(runtimeBuildInfoJson)
  const runtimeBuildTime = validBuildTime(runtime.buildTime)
  const compiledBuildTime = validBuildTime(compiledEnv.__ONEWORKS_PROJECT_CLIENT_BUILD_TIME__)
  const buildTime = runtimeBuildTime ?? compiledBuildTime
  return parseAppBuildInfoJson(JSON.stringify({
    version: validVersion(runtime.version) ?? validVersion(compiledEnv.__ONEWORKS_PROJECT_CLIENT_VERSION__),
    commit: validCommit(runtime.commit) ?? validCommit(compiledEnv.__ONEWORKS_PROJECT_CLIENT_COMMIT_HASH__),
    buildTime,
    buildTimeSource: runtimeBuildTime == null
      ? compiledEnv.__ONEWORKS_PROJECT_CLIENT_BUILD_TIME_SOURCE__
      : runtime.buildTimeSource
  }))
}

export const getClientBuildInfo = () => resolveClientBuildInfo(
  getRuntimeClientBuildInfoJson(),
  import.meta.env
)

export const getClientVersion = () => getClientBuildInfo().version

export const getClientCommitHash = () => getClientBuildInfo().commit ?? undefined

export const getClientBuildTime = () => getClientBuildInfo().buildTime ?? undefined
