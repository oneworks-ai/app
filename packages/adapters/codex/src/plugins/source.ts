import { constants } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { ClaudePluginManifest } from '@oneworks/adapter-claude-code/plugins'

export interface CodexPluginManifest extends ClaudePluginManifest {
  apps?: string
  interface?: {
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

export const parseCodexPluginManifest = async (pluginRoot: string): Promise<CodexPluginManifest | undefined> => {
  const manifestPath = path.join(pluginRoot, '.codex-plugin', 'plugin.json')
  if (!await pathExists(manifestPath)) return undefined

  const raw = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as unknown
  return isRecord(raw) ? raw as CodexPluginManifest : undefined
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
