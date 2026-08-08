import type {
  NativeHostPlugin,
  NativeHostPluginDiagnostic,
  NativeHostPluginScope,
  NativeHostPluginSourceKind,
  NativeHostPluginState
} from '@oneworks/types'
import { isCredentialShapedNativeAppValue, isFilesystemShapedNativeAppValue, redactPrivateRoots } from '@oneworks/utils'

const NATIVE_HOST_PLUGIN_SCOPES = new Set<NativeHostPluginScope>([
  'builtin',
  'local',
  'managed',
  'project',
  'unknown',
  'user'
])
const NATIVE_HOST_PLUGIN_SOURCE_KINDS = new Set<NativeHostPluginSourceKind>([
  'cache',
  'installed-copy',
  'local-file',
  'managed',
  'npm-config'
])
const NATIVE_HOST_PLUGIN_STATES = new Set<NativeHostPluginState>([
  'disabled',
  'enabled',
  'unknown'
])

const toNativePublicString = (value: unknown, privatePaths: string[] = []) => (
  typeof value !== 'string' ||
    isCredentialShapedNativeAppValue(value) ||
    isFilesystemShapedNativeAppValue(value)
    ? undefined
    : redactPrivateRoots(value, privatePaths)
)

const normalizeNativeCapabilityStatus = (value: unknown) => (
  value === 'available' || value === 'read-only' || value === 'unsupported'
    ? value
    : 'unsupported'
)

const toPublicNativeHostScope = (value: unknown): NativeHostPluginScope => (
  typeof value === 'string' && NATIVE_HOST_PLUGIN_SCOPES.has(value as NativeHostPluginScope)
    ? value as NativeHostPluginScope
    : 'unknown'
)

export const toPublicNativeHostDiagnostic = (
  diagnostic: NativeHostPluginDiagnostic,
  privatePaths: string[] = []
) => {
  const adapter = toNativePublicString(diagnostic.adapter, privatePaths)
  const code = toNativePublicString(diagnostic.code, privatePaths)
  const message = toNativePublicString(diagnostic.message, privatePaths)
  const level = diagnostic.level === 'error' || diagnostic.level === 'info' || diagnostic.level === 'warning'
    ? diagnostic.level
    : 'warning'
  return {
    ...(adapter == null
      ? {}
      : { adapter }),
    code: code ?? 'native_plugin_diagnostic_redacted',
    level,
    message: message ?? 'Native plugin diagnostic was redacted.'
  }
}

export const toPublicNativeHostPlugin = (
  plugin: NativeHostPlugin,
  authoritativePrivateRoots: string[]
): NativeHostPlugin | undefined => {
  const source = plugin.source as unknown
  if (source == null || typeof source !== 'object' || Array.isArray(source)) return undefined
  const sourceRecord = source as Record<string, unknown>
  const privatePaths = [
    ...authoritativePrivateRoots,
    sourceRecord.displayPath,
    sourceRecord.internalRoot
  ].filter((value): value is string => typeof value === 'string')
  const adapter = toNativePublicString(plugin.adapter, privatePaths)
  const id = toNativePublicString(plugin.id, privatePaths)
  const name = toNativePublicString(plugin.name, privatePaths)
  const sourceKind = sourceRecord.kind
  const description = toNativePublicString(plugin.description, privatePaths)
  const displayName = toNativePublicString(plugin.displayName, privatePaths)
  const icon = toNativePublicString(plugin.icon, privatePaths)
  const marketplace = toNativePublicString(plugin.marketplace, privatePaths)
  const version = toNativePublicString(plugin.version, privatePaths)
  if (
    adapter == null || id == null || name == null ||
    typeof sourceKind !== 'string' ||
    !NATIVE_HOST_PLUGIN_SOURCE_KINDS.has(sourceKind as NativeHostPluginSourceKind) ||
    !NATIVE_HOST_PLUGIN_STATES.has(plugin.state)
  ) return undefined
  return {
    adapter,
    capabilities: {
      discover: normalizeNativeCapabilityStatus(plugin.capabilities.discover),
      disable: normalizeNativeCapabilityStatus(plugin.capabilities.disable),
      enable: normalizeNativeCapabilityStatus(plugin.capabilities.enable),
      import: normalizeNativeCapabilityStatus(plugin.capabilities.import),
      install: normalizeNativeCapabilityStatus(plugin.capabilities.install),
      uninstall: normalizeNativeCapabilityStatus(plugin.capabilities.uninstall),
      update: normalizeNativeCapabilityStatus(plugin.capabilities.update)
    },
    id,
    name,
    scope: toPublicNativeHostScope(plugin.scope),
    source: { kind: sourceKind as NativeHostPluginSourceKind },
    state: plugin.state,
    ...(description == null ? {} : { description }),
    ...(plugin.diagnostics == null
      ? {}
      : {
        diagnostics: plugin.diagnostics.slice(0, 64).map(diagnostic =>
          toPublicNativeHostDiagnostic(diagnostic, privatePaths)
        )
      }),
    ...(displayName == null ? {} : { displayName }),
    ...(icon == null ? {} : { icon }),
    ...(marketplace == null ? {} : { marketplace }),
    ...(version == null ? {} : { version })
  }
}
