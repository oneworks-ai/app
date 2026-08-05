import { Buffer } from 'node:buffer'
import { constants } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { ClaudePluginManifest } from '@oneworks/adapter-claude-code/plugins'

export interface CodexPluginManifest extends ClaudePluginManifest {
  apps?: string | string[]
  displayName?: string
  interface?: {
    capabilities?: string[]
    composerIcon?: string
    displayName?: string
    shortDescription?: string
    longDescription?: string
    developerName?: string
    category?: string
    logo?: string
    logoDark?: string
  }
}

const MAX_CODEX_PLUGIN_MANIFEST_BYTES = 1024 * 1024

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

export const pathExists = async (target: string) => {
  try {
    await fs.access(target, constants.F_OK)
    return true
  } catch {
    return false
  }
}

export const resolveCodexPathWithinPluginRoot = async (
  pluginRoot: string,
  entry: string,
  description: string
) => {
  const resolved = path.resolve(pluginRoot, entry)
  const relative = path.relative(pluginRoot, resolved)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${description} must stay within the plugin root.`)
  }
  if (!await pathExists(resolved)) return resolved

  const [realRoot, realResolved] = await Promise.all([
    fs.realpath(pluginRoot),
    fs.realpath(resolved)
  ])
  const realRelative = path.relative(realRoot, realResolved)
  if (realRelative === '..' || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
    throw new Error(`${description} resolves outside the plugin root.`)
  }
  return resolved
}

export const parseCodexPluginManifest = async (pluginRoot: string): Promise<CodexPluginManifest | undefined> => {
  const manifestPath = await resolveCodexPathWithinPluginRoot(
    pluginRoot,
    path.join('.codex-plugin', 'plugin.json'),
    'Codex plugin manifest'
  )
  if (!await pathExists(manifestPath)) return undefined

  const handle = await fs.open(manifestPath, constants.O_RDONLY | constants.O_NOFOLLOW)
  let source: string
  try {
    const manifestStat = await handle.stat()
    if (!manifestStat.isFile() || manifestStat.size > MAX_CODEX_PLUGIN_MANIFEST_BYTES) {
      throw new Error(`Codex plugin manifest exceeds ${MAX_CODEX_PLUGIN_MANIFEST_BYTES} bytes.`)
    }
    const buffer = Buffer.alloc(MAX_CODEX_PLUGIN_MANIFEST_BYTES + 1)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    if (bytesRead > MAX_CODEX_PLUGIN_MANIFEST_BYTES) {
      throw new Error(`Codex plugin manifest exceeds ${MAX_CODEX_PLUGIN_MANIFEST_BYTES} bytes.`)
    }
    source = buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
  let raw: unknown
  try {
    raw = JSON.parse(source) as unknown
  } catch {
    throw new Error('Codex plugin manifest is not valid JSON.')
  }
  if (!isRecord(raw)) throw new Error('Codex plugin manifest must contain a JSON object.')
  return raw as CodexPluginManifest
}

export const mergeCodexPluginManifest = (
  manifest: CodexPluginManifest | undefined,
  overrides: Partial<CodexPluginManifest> | undefined
): CodexPluginManifest | undefined => {
  if (manifest == null && overrides == null) return undefined
  return {
    ...(manifest ?? {}),
    ...(overrides ?? {})
  }
}

export const detectCodexPluginRoot = async (baseDir: string): Promise<string> => {
  const candidates = [baseDir, path.join(baseDir, 'package')]

  for (const candidate of candidates) {
    if (
      await pathExists(path.join(candidate, '.codex-plugin', 'plugin.json')) ||
      await pathExists(path.join(candidate, 'skills')) ||
      await pathExists(path.join(candidate, 'commands')) ||
      await pathExists(path.join(candidate, 'agents')) ||
      await pathExists(path.join(candidate, 'hooks.json')) ||
      await pathExists(path.join(candidate, '.mcp.json'))
    ) {
      return candidate
    }
  }

  const entries = await fs.readdir(baseDir, { withFileTypes: true })
  const onlyDir = entries.find(entry => entry.isDirectory())
  if (entries.length === 1 && onlyDir != null) {
    return detectCodexPluginRoot(path.join(baseDir, onlyDir.name))
  }

  throw new Error('The installed source does not look like a Codex plugin.')
}
