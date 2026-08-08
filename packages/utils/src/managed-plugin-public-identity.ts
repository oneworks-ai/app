import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

import type { ManagedPluginAdapter, ManagedPluginSource } from '@oneworks/types'

import { isSafePublicPluginIdentity } from './native-app-metadata'

const MANAGED_PLUGIN_SCOPE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/
const MANAGED_PLUGIN_SCOPE_HASH_LENGTH = 24
const NPM_PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/iu
const MAX_NPM_SPEC_BYTES = 512
const MAX_NPM_REGISTRY_BYTES = 2048
const DEFAULT_NPM_REGISTRY_AUTHORITY = 'https://registry.npmjs.org'
const UNSAFE_NPM_SPEC_PATTERN =
  /\0|(?:api[_-]?key|client[_-]?secret|password|token)\s*[:=]|\bBearer\s+|AIza[\w-]{20,}|A(?:KIA|SIA)[0-9A-Z]{16}|\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}\b/iu

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
  if (hasControlCharacter(decodedPath) || decodedPath.includes('\\') || UNSAFE_NPM_SPEC_PATTERN.test(decodedPath)) {
    throw new Error('Managed plugin npm registry path is unsafe.')
  }
  const pathname = parsed.pathname.replace(/\/+$/gu, '')
  return `${parsed.origin}${pathname}`
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
  [...value].some(character => (character.codePointAt(0) ?? 0) <= 31)
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
      return {
        canonical: `${adapter}\0npm\0${resolveManagedNpmRegistryAuthority(source.registry)}\0${packageIdentity}`,
        label: `${adapter}-${packageIdentity}`
      }
    }
    case 'github':
      return { canonical: `${adapter}\0github\0${source.repo}`, label: `${adapter}-${name}` }
    case 'git':
      return { canonical: `${adapter}\0git\0${source.url}`, label: `${adapter}-${name}` }
    case 'git-subdir':
      return {
        canonical: `${adapter}\0git-subdir\0${source.url}\0${source.path}`,
        label: `${adapter}-${name}`
      }
    case 'path':
      return { canonical: `${adapter}\0path\0${name}`, label: `${adapter}-${name}` }
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
