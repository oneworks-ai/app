import { lstat } from 'node:fs/promises'
import path from 'node:path'

import type { AdapterNativePluginManager, NativeHostPluginDiagnostic, NativeHostPluginState } from '@oneworks/types'
import {
  createNativeHostPluginId,
  discoverNativeHostSkills,
  listChildDirectories,
  listSafeChildDirectories,
  normalizeOptionalString,
  readSmallJsonObject,
  readSmallJsonObjectWithin,
  resolveOptionalPath,
  resolveRealUserHome,
  toHomeDisplayPath
} from '@oneworks/utils'

const capabilities = {
  discover: 'available',
  disable: 'read-only',
  enable: 'read-only',
  import: 'unsupported',
  install: 'read-only',
  uninstall: 'read-only',
  update: 'read-only'
} as const

const ensureSlashes = (value: string) => {
  const normalized = value.replaceAll('\\', '/')
  return `${normalized.startsWith('/') ? '' : '/'}${normalized}${normalized.endsWith('/') ? '' : '/'}`
}

const matchesRule = (rule: string, cwd: string) => {
  const disabled = rule.startsWith('!')
  const raw = disabled ? rule.slice(1) : rule
  const includeSubdirs = raw.endsWith('*')
  const base = ensureSlashes(includeSubdirs ? raw.slice(0, -1) : raw)
  const current = ensureSlashes(cwd)
  return {
    disabled,
    matches: includeSubdirs ? current.startsWith(base) : current === base
  }
}

const resolveState = (value: unknown, cwd: string): NativeHostPluginState => {
  if (value == null) return 'enabled'
  if (typeof value !== 'object' || Array.isArray(value)) return 'unknown'
  const overrides = (value as Record<string, unknown>).overrides
  if (!Array.isArray(overrides) || overrides.some(rule => typeof rule !== 'string')) return 'unknown'
  let enabled = true
  for (const rule of overrides) {
    const match = matchesRule(rule as string, cwd)
    if (match.matches) enabled = !match.disabled
  }
  return enabled ? 'enabled' : 'disabled'
}

const discover: AdapterNativePluginManager['discover'] = async ({ cwd, env }) => {
  const diagnostics: NativeHostPluginDiagnostic[] = []
  const realHome = resolveRealUserHome(env)
  const cliHome = resolveOptionalPath(env.GEMINI_CLI_HOME) ?? realHome
  const extensionsRoot = path.resolve(cliHome, '.gemini', 'extensions')
  let enablement: Record<string, unknown> | undefined
  try {
    enablement = await readSmallJsonObject(path.resolve(extensionsRoot, 'extension-enablement.json'))
  } catch {
    diagnostics.push({
      code: 'native_plugin_enablement_unreadable',
      level: 'warning',
      message: 'Gemini extension enablement could not be parsed; affected states are unknown.'
    })
  }

  const plugins = []
  for (const directoryName of await listChildDirectories(extensionsRoot)) {
    const root = path.resolve(extensionsRoot, directoryName)
    let manifest
    try {
      manifest = await readSmallJsonObject(path.resolve(root, 'gemini-extension.json'))
    } catch {
      diagnostics.push({
        code: 'native_plugin_manifest_unreadable',
        level: 'warning',
        message: `Gemini extension ${directoryName} has an unreadable manifest.`
      })
      continue
    }
    if (manifest == null) continue
    const name = normalizeOptionalString(manifest.name) ?? directoryName
    const linked = await lstat(root).then(value => value.isSymbolicLink()).catch(() => false)
    plugins.push({
      adapter: 'gemini',
      capabilities,
      id: createNativeHostPluginId('gemini', `${linked ? 'local' : 'user'}:${root}`),
      name,
      scope: linked ? 'local' as const : 'user' as const,
      source: {
        displayPath: toHomeDisplayPath(realHome, root),
        internalRoot: root,
        kind: linked ? 'local-file' as const : 'installed-copy' as const
      },
      state: enablement == null && diagnostics.length > 0 ? 'unknown' as const : resolveState(enablement?.[name], cwd),
      ...(normalizeOptionalString(manifest.description) != null
        ? { description: normalizeOptionalString(manifest.description) }
        : {}),
      ...(normalizeOptionalString(manifest.version) != null
        ? { version: normalizeOptionalString(manifest.version) }
        : {})
    })
  }

  const projectRoot = path.resolve(cwd, '.gemini', 'extensions')
  for (const child of await listSafeChildDirectories(projectRoot)) {
    let manifest
    try {
      manifest = await readSmallJsonObjectWithin(
        child.resolvedPath,
        path.resolve(child.resolvedPath, 'gemini-extension.json')
      )
    } catch {
      diagnostics.push({
        code: 'native_plugin_manifest_unreadable',
        level: 'warning',
        message: `Gemini project extension ${child.name} has an unreadable manifest.`
      })
      continue
    }
    if (manifest == null) continue
    const name = normalizeOptionalString(manifest.name) ?? child.name
    plugins.push({
      adapter: 'gemini',
      capabilities,
      id: createNativeHostPluginId('gemini', `project:${child.resolvedPath}`),
      name,
      scope: 'project' as const,
      source: {
        displayPath: toHomeDisplayPath(realHome, child.displayPath),
        internalRoot: child.resolvedPath,
        kind: 'local-file' as const
      },
      state: resolveState(enablement?.[name], cwd),
      ...(normalizeOptionalString(manifest.description) != null
        ? { description: normalizeOptionalString(manifest.description) }
        : {}),
      ...(normalizeOptionalString(manifest.version) != null
        ? { version: normalizeOptionalString(manifest.version) }
        : {})
    })
  }
  return { diagnostics, plugins }
}

const discoverSkills: NonNullable<AdapterNativePluginManager['discoverSkills']> = async ({ cwd, env }) => {
  const realHome = resolveRealUserHome(env)
  const cliHome = resolveOptionalPath(env.GEMINI_CLI_HOME) ?? realHome
  return {
    diagnostics: [],
    skills: await discoverNativeHostSkills({
      adapter: 'gemini',
      realHome,
      roots: [
        { id: 'home-gemini', path: path.resolve(cliHome, '.gemini', 'skills'), scope: 'global' },
        { id: 'home-agents', path: path.resolve(realHome, '.agents', 'skills'), scope: 'global' },
        { id: 'project-gemini', path: path.resolve(cwd, '.gemini', 'skills'), scope: 'project' },
        { id: 'project-agents', path: path.resolve(cwd, '.agents', 'skills'), scope: 'project' }
      ]
    })
  }
}

const manager: AdapterNativePluginManager = {
  adapter: 'gemini',
  discoverSkills,
  displayName: 'Gemini CLI',
  discover
}

export default manager
