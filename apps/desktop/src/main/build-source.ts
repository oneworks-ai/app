import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { app } from 'electron'

import type { DesktopBuildSource } from './types'

const buildSourceFileName = 'desktop-build-source.json'

let buildSourceCache: DesktopBuildSource | null | undefined

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const normalizeText = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const runtimePackageCacheVersionPattern = /^[\w.+-]+$/u

const normalizeRuntimePackageCacheVersion = (value: unknown) => {
  const normalized = normalizeText(value)
  return normalized != null &&
      runtimePackageCacheVersionPattern.test(normalized) &&
      normalized !== '.' &&
      normalized !== '..'
    ? normalized
    : undefined
}

const normalizeDesktopBuildSource = (value: unknown): DesktopBuildSource | undefined => {
  if (!isRecord(value)) return undefined

  const branch = normalizeText(value.branch)
  const buildTime = normalizeText(value.buildTime)
  const gitHash = normalizeText(value.gitHash)
  const runtimePackageCacheVersion = normalizeRuntimePackageCacheVersion(value.runtimePackageCacheVersion)
  if (branch == null || buildTime == null || gitHash == null) {
    return undefined
  }

  return {
    branch,
    buildTime,
    gitHash,
    ...(runtimePackageCacheVersion == null ? {} : { runtimePackageCacheVersion })
  }
}

export const readDesktopBuildSource = (): DesktopBuildSource | undefined => {
  if (buildSourceCache !== undefined) {
    return buildSourceCache ?? undefined
  }

  if (!app.isPackaged) {
    buildSourceCache = null
    return undefined
  }

  const buildSourcePath = path.join(process.resourcesPath, buildSourceFileName)
  if (!fs.existsSync(buildSourcePath)) {
    buildSourceCache = null
    return undefined
  }

  try {
    buildSourceCache = normalizeDesktopBuildSource(JSON.parse(fs.readFileSync(buildSourcePath, 'utf8'))) ?? null
  } catch (error) {
    console.warn('[oneworks-desktop] failed to read build source metadata', error)
    buildSourceCache = null
  }

  return buildSourceCache ?? undefined
}

export const readDesktopBuildRuntimePackageCacheVersion = () => readDesktopBuildSource()?.runtimePackageCacheVersion
