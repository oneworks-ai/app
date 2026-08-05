import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { access, readFile, readdir, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import process from 'node:process'

import type { ManagedPluginAdapter, ManagedPluginInstallConfig, ManagedPluginSource } from '@oneworks/types'

import { resolveProjectHomePath } from './ai-path'
import { isSafePublicPluginIdentity } from './native-app-metadata'

const MANAGED_PLUGIN_CONFIG_FILE = '.oneworks-plugin.json'
const MANAGED_PLUGIN_INSTALL_DIR = 'install'
const MANAGED_PLUGIN_SCOPE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/
const MANAGED_PLUGIN_SCOPE_HASH_LENGTH = 24
const NPM_PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/iu
const MAX_NPM_SPEC_BYTES = 512
const MAX_NPM_REGISTRY_BYTES = 2048
const DEFAULT_NPM_REGISTRY_AUTHORITY = 'https://registry.npmjs.org'
const UNSAFE_NPM_SPEC_PATTERN =
  /\0|(?:api[_-]?key|client[_-]?secret|password|token)\s*[:=]|\bBearer\s+|AIza[\w-]{20,}|A(?:KIA|SIA)[0-9A-Z]{16}|\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}\b/iu

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)
const isManagedPluginAdapter = (value: unknown): value is ManagedPluginAdapter => (
  typeof value === 'string' && value.trim() !== ''
)

const decodeRegistryComponent = (value: string) => {
  let decoded = value
  for (let depth = 0; depth < 4 && decoded.includes('%'); depth += 1) {
    try {
      const next = decodeURIComponent(decoded)
      if (next === decoded) break
      decoded = next
    } catch {
      throw new Error('Managed plugin npm registry contains malformed encoding.')
    }
  }
  return decoded
}

export const resolveManagedNpmRegistryAuthority = (registry?: string) => {
  if (registry == null) return DEFAULT_NPM_REGISTRY_AUTHORITY
  const trimmed = registry.trim()
  if (trimmed === '' || Buffer.byteLength(trimmed, 'utf8') > MAX_NPM_REGISTRY_BYTES) {
    throw new Error('Managed plugin npm registry is invalid.')
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error('Managed plugin npm registry must be an absolute HTTP(S) URL.')
  }
  if (
    (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new Error('Managed plugin npm registry must not contain credentials, query, or fragment data.')
  }

  const decodedPath = decodeRegistryComponent(parsed.pathname)
  if (
    hasControlCharacter(decodedPath) ||
    decodedPath.includes('\\') ||
    UNSAFE_NPM_SPEC_PATTERN.test(decodedPath)
  ) {
    throw new Error('Managed plugin npm registry path is unsafe.')
  }
  const pathname = parsed.pathname.replace(/\/+$/gu, '')
  return `${parsed.origin}${pathname}`
}

const isManagedPluginSource = (value: unknown): value is ManagedPluginInstallConfig['source'] => {
  if (!isRecord(value) || typeof value.type !== 'string') return false

  switch (value.type) {
    case 'npm': {
      if (typeof value.spec !== 'string' || value.spec.trim() === '') return false
      const registry = value.registry
      if (registry != null && typeof registry !== 'string') return false
      try {
        resolveManagedNpmRegistryAuthority(registry ?? undefined)
        return true
      } catch {
        return false
      }
    }
    case 'github':
      return typeof value.repo === 'string' && value.repo.trim() !== '' && (
        value.ref == null || (typeof value.ref === 'string' && value.ref.trim() !== '')
      ) && (
        value.sha == null || (typeof value.sha === 'string' && value.sha.trim() !== '')
      )
    case 'git':
      return typeof value.url === 'string' && value.url.trim() !== '' && (
        value.ref == null || (typeof value.ref === 'string' && value.ref.trim() !== '')
      ) && (
        value.sha == null || (typeof value.sha === 'string' && value.sha.trim() !== '')
      )
    case 'git-subdir':
      return typeof value.url === 'string' && value.url.trim() !== '' &&
        typeof value.path === 'string' && value.path.trim() !== '' && (
          value.ref == null || (typeof value.ref === 'string' && value.ref.trim() !== '')
        ) && (
          value.sha == null || (typeof value.sha === 'string' && value.sha.trim() !== '')
        )
    case 'path':
      return typeof value.path === 'string' && value.path.trim() !== ''
    case 'marketplace':
      return typeof value.marketplace === 'string' && value.marketplace.trim() !== '' &&
        typeof value.plugin === 'string' && value.plugin.trim() !== ''
    default:
      return false
  }
}

interface ParsedNpmPackageSpec {
  alias?: string
  name: string
  spec?: string
}

const splitNpmNameAndSpec = (value: string): ParsedNpmPackageSpec | undefined => {
  const trimmed = value.trim()
  const splitAt = trimmed.startsWith('@')
    ? trimmed.indexOf('@', trimmed.indexOf('/') + 1)
    : trimmed.indexOf('@')
  const name = splitAt < 0 ? trimmed : trimmed.slice(0, splitAt)
  const spec = splitAt < 0 ? undefined : trimmed.slice(splitAt + 1).trim()
  if (!NPM_PACKAGE_NAME_PATTERN.test(name) || spec === '') return undefined
  return { name: name.toLowerCase(), ...(spec == null ? {} : { spec }) }
}

const parseNpmPackageSpec = (value: string): ParsedNpmPackageSpec | undefined => {
  const trimmed = value.trim()
  if (trimmed === '' || Buffer.byteLength(trimmed, 'utf8') > MAX_NPM_SPEC_BYTES) return undefined
  const aliasMarker = '@npm:'
  const aliasIndex = trimmed.toLowerCase().indexOf(aliasMarker)
  if (aliasIndex > 0) {
    const alias = trimmed.slice(0, aliasIndex)
    const target = splitNpmNameAndSpec(trimmed.slice(aliasIndex + aliasMarker.length))
    if (!NPM_PACKAGE_NAME_PATTERN.test(alias) || target == null) return undefined
    return { ...target, alias: alias.toLowerCase() }
  }
  return splitNpmNameAndSpec(trimmed)
}

const hasControlCharacter = (value: string) => (
  [...value].some(character => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31
  })
)

const isSafeNpmVersionOrRange = (value: string | undefined) => (
  value == null || (
    value !== '' &&
    !UNSAFE_NPM_SPEC_PATTERN.test(value) &&
    isSafePublicPluginIdentity(value) &&
    !value.includes('\\') &&
    !hasControlCharacter(value) &&
    !/^(?:file:|git\+|https?:|ssh:|github:|\.|\/)/iu.test(value)
  )
)

const resolveNpmPackageIdentity = (spec: string) => {
  const parsed = parseNpmPackageSpec(spec)
  if (parsed == null || !isSafeNpmVersionOrRange(parsed.spec)) {
    return `invalid-${createHash('sha256').update(spec).digest('hex').slice(0, MANAGED_PLUGIN_SCOPE_HASH_LENGTH)}`
  }
  return parsed.alias == null ? parsed.name : `${parsed.alias}@npm:${parsed.name}`
}

const getManagedPluginScopeIdentity = (
  adapter: ManagedPluginAdapter,
  name: string,
  source: ManagedPluginSource
) => {
  switch (source.type) {
    case 'marketplace':
      return {
        canonical: `${adapter}\0marketplace\0${source.marketplace}\0${source.plugin}`,
        label: `${adapter}-${source.marketplace}-${source.plugin}`
      }
    case 'npm': {
      const packageIdentity = resolveNpmPackageIdentity(source.spec)
      const registryAuthority = resolveManagedNpmRegistryAuthority(source.registry)
      return {
        canonical: `${adapter}\0npm\0${registryAuthority}\0${packageIdentity}`,
        label: `${adapter}-${packageIdentity}`
      }
    }
    case 'github':
      return {
        canonical: `${adapter}\0github\0${source.repo}`,
        label: `${adapter}-${name}`
      }
    case 'git':
      return {
        canonical: `${adapter}\0git\0${source.url}`,
        label: `${adapter}-${name}`
      }
    case 'git-subdir':
      return {
        canonical: `${adapter}\0git-subdir\0${source.url}\0${source.path}`,
        label: `${adapter}-${name}`
      }
    case 'path':
      return {
        canonical: `${adapter}\0path\0${name}`,
        label: `${adapter}-${name}`
      }
  }
}

const normalizeManagedPluginScopeLabel = (value: string) => (
  value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{Mark}+/gu, '')
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^[^a-z0-9]+|[-._]+$/gu, '')
)

const toSafeManagedPluginScopeLabel = (value: string) => (
  isSafePublicPluginIdentity(value) ? normalizeManagedPluginScopeLabel(value) : 'plugin'
)

export const resolveManagedPluginPublicPackageId = (params: {
  adapter: ManagedPluginAdapter
  name: string
  source: Extract<ManagedPluginSource, { type: 'npm' }>
}) => {
  const spec = params.source.spec.trim()
  const parsed = parseNpmPackageSpec(spec)
  if (parsed != null && isSafeNpmVersionOrRange(parsed.spec)) return spec

  const identity = getManagedPluginScopeIdentity(params.adapter, params.name, params.source)
  const hash = createHash('sha256').update(identity.canonical).digest('hex').slice(0, MANAGED_PLUGIN_SCOPE_HASH_LENGTH)
  const name = toSafeManagedPluginScopeLabel(params.name).slice(0, 48) || 'plugin'
  return `npm:${name}-${hash}`
}

export const resolveManagedPluginScope = (params: {
  adapter: ManagedPluginAdapter
  name: string
  scope?: string
  source: ManagedPluginSource
}) => {
  if (params.scope != null) {
    if (!MANAGED_PLUGIN_SCOPE_PATTERN.test(params.scope)) {
      throw new Error('Plugin scope must match [a-z0-9][a-z0-9._-]{0,63}.')
    }
    return params.scope
  }

  const identity = getManagedPluginScopeIdentity(params.adapter, params.name, params.source)
  const hash = createHash('sha256')
    .update(identity.canonical)
    .digest('hex')
    .slice(0, MANAGED_PLUGIN_SCOPE_HASH_LENGTH)
  const maxBaseLength = 64 - hash.length - 1
  const base = toSafeManagedPluginScopeLabel(identity.label)
    .slice(0, maxBaseLength)
    .replace(/[-._]+$/gu, '') || 'plugin'
  return `${base}-${hash}`
}

export const resolveManagedPluginInstallIdentity = (params: {
  adapter: ManagedPluginAdapter
  name: string
  source: ManagedPluginSource
}) => {
  const sourceIdentity = (() => {
    switch (params.source.type) {
      case 'marketplace':
        return ['marketplace', params.source.marketplace, params.source.plugin]
      case 'npm':
        return [
          'npm',
          resolveManagedNpmRegistryAuthority(params.source.registry),
          resolveNpmPackageIdentity(params.source.spec)
        ]
      case 'github':
        return ['github', params.source.repo]
      case 'git':
        return ['git', params.source.url]
      case 'git-subdir':
        return ['git-subdir', params.source.url, params.source.path]
      case 'path':
        return ['path', params.source.path]
    }
  })()
  return createHash('sha256')
    .update(JSON.stringify([params.adapter, params.name, ...sourceIdentity]))
    .digest('hex')
}

const normalizeManagedPluginConfig = (value: unknown, filePath: string): ManagedPluginInstallConfig | undefined => {
  if (!isRecord(value)) return undefined
  if (value.version !== 1) return undefined
  if (!isManagedPluginAdapter(value.adapter)) return undefined
  if (typeof value.name !== 'string' || !isSafePublicPluginIdentity(value.name)) {
    throw new Error(`Invalid managed plugin config at ${filePath}. "name" must be a non-empty string.`)
  }
  if (!isManagedPluginSource(value.source)) {
    throw new Error(`Invalid managed plugin config at ${filePath}. "source" is invalid.`)
  }
  if (typeof value.nativePluginPath !== 'string' || value.nativePluginPath.trim() === '') {
    throw new Error(`Invalid managed plugin config at ${filePath}. "nativePluginPath" is required.`)
  }
  if (typeof value.oneworksPluginPath !== 'string' || value.oneworksPluginPath.trim() === '') {
    throw new Error(`Invalid managed plugin config at ${filePath}. "oneworksPluginPath" is required.`)
  }
  if (typeof value.installedAt !== 'string' || value.installedAt.trim() === '') {
    throw new Error(`Invalid managed plugin config at ${filePath}. "installedAt" is required.`)
  }
  const name = value.name.trim()
  const configuredScope = typeof value.scope === 'string' ? value.scope : undefined
  const legacyImplicitScope = configuredScope != null &&
    configuredScope === name &&
    !MANAGED_PLUGIN_SCOPE_PATTERN.test(configuredScope)
  const source = value.source.type === 'npm' && value.source.registry != null
    ? { ...value.source, registry: resolveManagedNpmRegistryAuthority(value.source.registry) }
    : value.source

  return {
    version: 1,
    adapter: value.adapter,
    name,
    scope: resolveManagedPluginScope({
      adapter: value.adapter,
      name,
      scope: legacyImplicitScope ? undefined : configuredScope,
      source
    }),
    installedAt: value.installedAt,
    source,
    nativePluginPath: value.nativePluginPath,
    oneworksPluginPath: value.oneworksPluginPath
  }
}
export interface ManagedPluginInstall {
  config: ManagedPluginInstallConfig
  installDir: string
  nativePluginDir: string
  oneworksPluginDir: string
}
export const getManagedPluginsRoot = (cwd: string, env: NodeJS.ProcessEnv = process.env) =>
  resolveProjectHomePath(cwd, env, '.local', 'plugins')
export const getManagedAdapterPluginsRoot = (
  cwd: string,
  adapter: ManagedPluginAdapter,
  env: NodeJS.ProcessEnv = process.env
) => resolve(getManagedPluginsRoot(cwd, env), adapter)
export const getManagedPluginInstallDir = (
  cwd: string,
  adapter: ManagedPluginAdapter,
  pluginSlug: string,
  env: NodeJS.ProcessEnv = process.env
) => resolve(getManagedAdapterPluginsRoot(cwd, adapter, env), pluginSlug, MANAGED_PLUGIN_INSTALL_DIR)
export const getManagedPluginConfigPath = (installDir: string) => resolve(installDir, MANAGED_PLUGIN_CONFIG_FILE)
const isOutsideInstallDir = (relativePath: string) => (
  relativePath === '..' ||
  relativePath.startsWith('../') ||
  relativePath.startsWith('..\\') ||
  isAbsolute(relativePath)
)
const assertManagedPluginSubpath = async (
  installDir: string,
  rawPath: string,
  fieldName: 'nativePluginPath' | 'oneworksPluginPath',
  filePath: string
) => {
  const trimmed = rawPath.trim()
  if (trimmed === '') {
    throw new Error(`Invalid managed plugin config at ${filePath}. "${fieldName}" is required.`)
  }
  if (isAbsolute(trimmed)) {
    throw new Error(`Invalid managed plugin config at ${filePath}. "${fieldName}" must stay inside the install dir.`)
  }

  const resolvedPath = resolve(installDir, trimmed)
  const relativePath = relative(installDir, resolvedPath)
  if (isOutsideInstallDir(relativePath)) {
    throw new Error(`Invalid managed plugin config at ${filePath}. "${fieldName}" must stay inside the install dir.`)
  }

  try {
    const [realInstallDir, realResolvedPath] = await Promise.all([
      realpath(installDir),
      realpath(resolvedPath)
    ])
    const realRelativePath = relative(realInstallDir, realResolvedPath)
    if (isOutsideInstallDir(realRelativePath)) {
      throw new Error(`Invalid managed plugin config at ${filePath}. "${fieldName}" resolves outside the install dir.`)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      throw error
    }
  }

  return trimmed
}
export const readManagedPluginInstall = async (installDir: string): Promise<ManagedPluginInstall | undefined> => {
  const configPath = getManagedPluginConfigPath(installDir)
  try {
    await access(configPath)
  } catch {
    return undefined
  }

  const raw = JSON.parse(await readFile(configPath, 'utf8')) as unknown
  const config = normalizeManagedPluginConfig(raw, configPath)
  if (config == null) return undefined
  const [nativePluginPath, oneworksPluginPath] = await Promise.all([
    assertManagedPluginSubpath(installDir, config.nativePluginPath, 'nativePluginPath', configPath),
    assertManagedPluginSubpath(installDir, config.oneworksPluginPath, 'oneworksPluginPath', configPath)
  ])
  return {
    config: {
      ...config,
      nativePluginPath,
      oneworksPluginPath
    },
    installDir,
    nativePluginDir: resolve(installDir, nativePluginPath),
    oneworksPluginDir: resolve(installDir, oneworksPluginPath)
  }
}
export const listManagedPluginInstalls = async (
  cwd: string,
  options?: {
    adapter?: ManagedPluginAdapter
    env?: NodeJS.ProcessEnv
  }
) => {
  const env = options?.env
  const root = getManagedPluginsRoot(cwd, env)
  const readAdapterInstalls = async (adapterRoot: string) => {
    try {
      const entries = await readdir(adapterRoot, { withFileTypes: true })
      const installDirs = entries
        .filter(entry => entry.isDirectory())
        .map(entry => resolve(adapterRoot, entry.name, MANAGED_PLUGIN_INSTALL_DIR))
      const installs = await Promise.allSettled(
        installDirs.map(installDir => readManagedPluginInstall(installDir))
      )
      return installs.flatMap((install) => {
        if (install.status === 'fulfilled') {
          return install.value == null ? [] : [install.value]
        }

        console.warn('Skipping a managed plugin install because its metadata is invalid.')
        return []
      })
    } catch {
      return []
    }
  }

  try {
    const adapterRoots = options?.adapter == null
      ? (await readdir(root, { withFileTypes: true }))
        .filter(entry => entry.isDirectory())
        .map(entry => resolve(root, entry.name))
      : [getManagedAdapterPluginsRoot(cwd, options.adapter, env)]
    const installGroups = await Promise.all(adapterRoots.map(adapterRoot => readAdapterInstalls(adapterRoot)))
    return installGroups
      .flat()
      .filter(install => options?.adapter == null || install.config.adapter === options.adapter)
      .sort((left, right) => left.config.name.localeCompare(right.config.name))
  } catch {
    return []
  }
}
