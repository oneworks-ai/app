import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

import type { AdapterCtx } from '@oneworks/types'
import { resolveProjectWorkspaceFolder } from '@oneworks/utils'

import { resolveCodexBinaryPath } from '#~/paths.js'
import { isCodexConfigRecord, readCodexConfigFromAppServer, resolveRealCodexHome } from './model-provider-config-read'

interface CachedNativeConfig {
  digest: string
  promise: Promise<Record<string, unknown>>
}

const projectNativeConfigCache = new Map<string, CachedNativeConfig>()

const readString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const readProjectConfigCandidate = async (params: {
  canonicalScanRoot: string
  configPath: string
  scanRoot: string
}) => {
  let fileStat
  try {
    fileStat = await lstat(params.configPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) return undefined

  const canonicalConfigPath = await realpath(params.configPath)
  const relativeConfigPath = relative(params.scanRoot, params.configPath)
  const expectedCanonicalPath = resolve(params.canonicalScanRoot, relativeConfigPath)
  const relativeToCanonicalRoot = relative(params.canonicalScanRoot, canonicalConfigPath)
  if (
    canonicalConfigPath !== expectedCanonicalPath ||
    relativeToCanonicalRoot.startsWith('..') ||
    isAbsolute(relativeToCanonicalRoot)
  ) return undefined

  return {
    configPath: params.configPath,
    sourceContent: await readFile(canonicalConfigPath, 'utf8')
  }
}

const readProjectProviderCandidates = async (ctx: Pick<AdapterCtx, 'cwd' | 'env'>) => {
  const workspaceRoot = resolve(resolveProjectWorkspaceFolder(ctx.cwd, ctx.env))
  const candidates: Array<{ configPath: string; sourceContent: string }> = []
  let currentDir = resolve(ctx.cwd)
  const relativeToWorkspace = relative(workspaceRoot, currentDir)
  const scanRoot = relativeToWorkspace.startsWith('..') || isAbsolute(relativeToWorkspace)
    ? currentDir
    : workspaceRoot
  const canonicalScanRoot = await realpath(scanRoot)

  while (true) {
    const configPath = resolve(currentDir, '.codex', 'config.toml')
    const candidate = await readProjectConfigCandidate({ canonicalScanRoot, configPath, scanRoot })
    if (candidate != null) candidates.unshift(candidate)
    if (currentDir === scanRoot) break
    const parentDir = dirname(currentDir)
    if (parentDir === currentDir) break
    currentDir = parentDir
  }

  return candidates
}

const readRawConfigAsUserLayer = async (params: {
  binaryPath: string
  configPath: string
  env: AdapterCtx['env']
  sourceContent: string
}) => {
  const digest = createHash('sha256').update(params.sourceContent).digest('hex')
  const cacheKey = JSON.stringify([params.configPath, params.binaryPath])
  const cached = projectNativeConfigCache.get(cacheKey)
  if (cached?.digest === digest) return cached.promise

  const promise = (async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'oneworks-codex-project-provider-'))
    const tempCodexHome = resolve(tempRoot, '.codex')
    const tempConfigPath = resolve(tempCodexHome, 'config.toml')
    try {
      await mkdir(tempCodexHome, { recursive: true })
      await writeFile(tempConfigPath, params.sourceContent, { encoding: 'utf8', mode: 0o600 })
      const result = await readCodexConfigFromAppServer({
        binaryPath: params.binaryPath,
        codexHome: tempCodexHome,
        env: params.env,
        includeLayers: true
      })
      const userLayer = result.layers.find(layer => {
        const name = isCodexConfigRecord(layer.name) ? layer.name : undefined
        return name?.type === 'user' && readString(name.file) === tempConfigPath
      })
      if (!isCodexConfigRecord(userLayer?.config)) {
        throw new TypeError('Codex app-server did not return the isolated user config layer.')
      }
      return userLayer.config
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })()
  projectNativeConfigCache.set(cacheKey, { digest, promise })
  void promise.catch(() => {
    if (projectNativeConfigCache.get(cacheKey)?.promise === promise) projectNativeConfigCache.delete(cacheKey)
  })
  return promise
}

const mergeRecords = (
  lower: Record<string, unknown> | undefined,
  higher: Record<string, unknown> | undefined
): Record<string, unknown> | undefined => {
  if (lower == null && higher == null) return undefined
  const merged: Record<string, unknown> = { ...(lower ?? {}) }
  for (const [key, value] of Object.entries(higher ?? {})) {
    merged[key] = isCodexConfigRecord(value) && isCodexConfigRecord(merged[key])
      ? mergeRecords(merged[key], value)
      : value
  }
  return merged
}

const mergeProjectProviderConfigs = (
  lower: Record<string, unknown>,
  higher: Record<string, unknown>
) => {
  const result = { ...lower }
  for (const key of ['model', 'model_provider', 'openai_base_url'] as const) {
    if (Object.hasOwn(higher, key)) result[key] = higher[key]
  }
  const modelProviders = mergeRecords(
    isCodexConfigRecord(lower.model_providers) ? lower.model_providers : undefined,
    isCodexConfigRecord(higher.model_providers) ? higher.model_providers : undefined
  )
  if (modelProviders != null) result.model_providers = modelProviders
  return result
}

export const readCodexProjectModelProviderConfig = async (
  ctx: Pick<AdapterCtx, 'cwd' | 'env'>
): Promise<Record<string, unknown> | undefined> => {
  const candidates = await readProjectProviderCandidates(ctx)
  if (candidates.length === 0) return undefined

  const binaryPath = String(resolveCodexBinaryPath(ctx.env, ctx.cwd))
  const discovery = await readCodexConfigFromAppServer({
    binaryPath,
    codexHome: resolveRealCodexHome(ctx.env),
    cwd: ctx.cwd,
    env: ctx.env,
    includeLayers: true
  })
  const enabledProjectConfigPaths = new Set(discovery.layers.flatMap(layer => {
    const name = isCodexConfigRecord(layer.name) ? layer.name : undefined
    const dotCodexFolder = readString(name?.dotCodexFolder)
    return name?.type === 'project' && dotCodexFolder != null && layer.disabledReason == null
      ? [resolve(dotCodexFolder, 'config.toml')]
      : []
  }))
  const activeCandidates = candidates.filter(candidate => enabledProjectConfigPaths.has(candidate.configPath))
  if (activeCandidates.length === 0) return undefined

  const rawConfigs = await Promise.all(activeCandidates.map(candidate =>
    readRawConfigAsUserLayer({
      binaryPath,
      configPath: candidate.configPath,
      env: ctx.env,
      sourceContent: candidate.sourceContent
    })
  ))
  return rawConfigs.reduce(mergeProjectProviderConfigs, {})
}
