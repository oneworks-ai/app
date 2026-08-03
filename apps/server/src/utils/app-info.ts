import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { cwd, env as processEnv } from 'node:process'
import { types } from 'node:util'

import {
  parseAppBuildInfoJson
} from '@oneworks/types'
import type { AppBuildInfo } from '@oneworks/types'

export interface ServerAppInfo {
  build: AppBuildInfo
  lastReleaseAt?: string
  version: string
}

interface ServerPackageInfo {
  gitHead?: unknown
  lastReleaseAt?: unknown
  oneworksBuild?: unknown
  releaseDate?: unknown
  version?: unknown
}

interface ServerPackageCandidate {
  directory: string
  packageInfo: ServerPackageInfo
}

const readPackageCandidate = async (
  packageJsonPath: string
): Promise<ServerPackageCandidate | undefined> => {
  try {
    const content = await readFile(packageJsonPath, 'utf-8')
    const parsed = JSON.parse(content) as ServerPackageInfo
    return {
      directory: dirname(packageJsonPath),
      packageInfo: parsed as ServerPackageInfo
    }
  } catch {
    return undefined
  }
}

const readGit = (args: string[], workingDirectory: string) => (
  new Promise<string | undefined>((resolveResult) => {
    execFile(
      'git',
      args,
      {
        cwd: workingDirectory,
        encoding: 'utf8',
        timeout: 2_000
      },
      (error, stdout) => {
        const output = error == null && typeof stdout === 'string' ? stdout.trim() : ''
        resolveResult(output === '' ? undefined : output)
      }
    )
  })
)

const firstNonEmpty = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return undefined
}

const firstNormalized = <T>(
  values: unknown[],
  normalize: (value: unknown) => T | null | undefined
) => {
  for (const value of values) {
    if (types.isProxy(value)) continue
    const normalized = normalize(value)
    if (normalized != null) return normalized
  }
  return undefined
}

const normalizeVersion = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const normalized = parseAppBuildInfoJson(JSON.stringify({ version: value })).version
  return normalized === value.trim() ? normalized : undefined
}

const normalizeCommit = (value: unknown) => (
  parseAppBuildInfoJson(JSON.stringify({ commit: value })).commit
)

const normalizeBuildTime = (value: unknown) => (
  parseAppBuildInfoJson(JSON.stringify({ buildTime: value })).buildTime
)

const isNodePlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (value == null || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const isRecord = isNodePlainRecord

const sourceDateEpochToIso = (value: unknown) => {
  if (typeof value !== 'string' || !/^\d{1,15}$/u.test(value.trim())) return undefined
  const milliseconds = Number(value.trim()) * 1_000
  if (!Number.isSafeInteger(milliseconds)) return undefined

  const date = new Date(milliseconds)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

const getPackageBuild = (packageInfo: ServerPackageInfo) => (
  isRecord(packageInfo.oneworksBuild) ? packageInfo.oneworksBuild : {}
)

const resolveServerBuild = async (
  candidate: ServerPackageCandidate | undefined
): Promise<AppBuildInfo> => {
  const packageInfo = candidate?.packageInfo ?? {}
  const packageBuild = getPackageBuild(packageInfo)
  const explicitCommit = firstNormalized([
    processEnv.__ONEWORKS_PROJECT_SERVER_COMMIT_HASH__,
    processEnv.ONEWORKS_SERVER_COMMIT_HASH,
    processEnv.GITHUB_SHA
  ], normalizeCommit)
  const packageCommit = firstNormalized([packageBuild.commit, packageInfo.gitHead], normalizeCommit)
  const gitDirectory = candidate?.directory ?? cwd()
  const gitCommit = explicitCommit == null && packageCommit == null
    ? await readGit(['rev-parse', 'HEAD'], gitDirectory)
    : undefined
  const commit = explicitCommit ?? packageCommit ?? normalizeCommit(gitCommit)

  const explicitBuildTime = firstNormalized([
    processEnv.__ONEWORKS_PROJECT_SERVER_BUILD_TIME__,
    processEnv.ONEWORKS_SERVER_BUILD_TIME,
    sourceDateEpochToIso(processEnv.SOURCE_DATE_EPOCH)
  ], normalizeBuildTime)
  const packageBuildTime = firstNormalized([packageBuild.buildTime], normalizeBuildTime)
  let buildTime = explicitBuildTime ?? packageBuildTime
  let buildTimeSource: AppBuildInfo['buildTimeSource'] = buildTime == null
    ? 'unavailable'
    : 'build'

  if (buildTime == null) {
    const gitBuildTime = await readGit(
      ['show', '-s', '--format=%cI', commit ?? 'HEAD'],
      gitDirectory
    )
    buildTime = normalizeBuildTime(gitBuildTime)
    if (buildTime != null) buildTimeSource = 'commit'
  }

  return parseAppBuildInfoJson(JSON.stringify({
    version: firstNormalized([
      processEnv.__ONEWORKS_PROJECT_SERVER_VERSION__,
      packageInfo.version
    ], normalizeVersion),
    commit,
    buildTime,
    buildTimeSource
  }))
}

export const getServerAppInfo = async (): Promise<ServerAppInfo> => {
  const packageDir = processEnv.__ONEWORKS_PROJECT_PACKAGE_DIR__?.trim()
  const candidates = [
    packageDir != null && packageDir !== '' ? resolve(packageDir, 'package.json') : undefined,
    resolve(cwd(), 'apps/server/package.json'),
    resolve(cwd(), 'package.json')
  ].filter((item): item is string => item != null)

  let candidate: ServerPackageCandidate | undefined
  for (const packageJsonPath of candidates) {
    candidate = await readPackageCandidate(packageJsonPath)
    if (candidate != null) break
  }

  const build = await resolveServerBuild(candidate)
  const lastReleaseAt = normalizeBuildTime(firstNonEmpty(
    candidate?.packageInfo.lastReleaseAt,
    candidate?.packageInfo.releaseDate
  ))

  return {
    build,
    version: build.version,
    ...(lastReleaseAt == null ? {} : { lastReleaseAt })
  }
}
