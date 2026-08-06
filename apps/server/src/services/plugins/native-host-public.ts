import type { NativeHostPlugin, NativeHostPluginDiagnostic, NativeHostPluginScope } from '@oneworks/types'
import { isCredentialLikeNativeAppValue, redactPrivateRoots } from '@oneworks/utils'

const NATIVE_HOST_PLUGIN_SCOPES = new Set<NativeHostPluginScope>([
  'builtin',
  'local',
  'managed',
  'project',
  'unknown',
  'user'
])

const redactNativePublicString = (value: string, privatePaths: string[] = []) => redactPrivateRoots(value, privatePaths)

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
) => ({
  ...(diagnostic.adapter == null ? {} : { adapter: redactNativePublicString(diagnostic.adapter, privatePaths) }),
  code: isCredentialLikeNativeAppValue(diagnostic.code)
    ? 'native_plugin_diagnostic_redacted'
    : redactNativePublicString(diagnostic.code, privatePaths),
  level: diagnostic.level,
  message: isCredentialLikeNativeAppValue(diagnostic.message)
    ? 'Native plugin diagnostic was redacted.'
    : redactNativePublicString(diagnostic.message, privatePaths)
})

export const toPublicNativeHostPlugin = (
  plugin: NativeHostPlugin,
  authoritativePrivateRoots: string[]
): NativeHostPlugin => {
  const privatePaths = [
    ...authoritativePrivateRoots,
    plugin.source.displayPath,
    plugin.source.internalRoot
  ].filter((value): value is string => value != null)
  return {
    adapter: redactNativePublicString(plugin.adapter, privatePaths),
    capabilities: {
      discover: normalizeNativeCapabilityStatus(plugin.capabilities.discover),
      disable: normalizeNativeCapabilityStatus(plugin.capabilities.disable),
      enable: normalizeNativeCapabilityStatus(plugin.capabilities.enable),
      import: normalizeNativeCapabilityStatus(plugin.capabilities.import),
      install: normalizeNativeCapabilityStatus(plugin.capabilities.install),
      uninstall: normalizeNativeCapabilityStatus(plugin.capabilities.uninstall),
      update: normalizeNativeCapabilityStatus(plugin.capabilities.update)
    },
    id: redactNativePublicString(plugin.id, privatePaths),
    name: redactNativePublicString(plugin.name, privatePaths),
    scope: toPublicNativeHostScope(plugin.scope),
    source: { kind: plugin.source.kind },
    state: plugin.state,
    ...(plugin.description == null
      ? {}
      : { description: redactNativePublicString(plugin.description, privatePaths) }),
    ...(plugin.diagnostics == null
      ? {}
      : {
        diagnostics: plugin.diagnostics.slice(0, 64).map(diagnostic =>
          toPublicNativeHostDiagnostic(diagnostic, privatePaths)
        )
      }),
    ...(plugin.displayName == null
      ? {}
      : { displayName: redactNativePublicString(plugin.displayName, privatePaths) }),
    ...(plugin.icon == null ? {} : { icon: redactNativePublicString(plugin.icon, privatePaths) }),
    ...(plugin.marketplace == null
      ? {}
      : { marketplace: redactNativePublicString(plugin.marketplace, privatePaths) }),
    ...(plugin.version == null ? {} : { version: redactNativePublicString(plugin.version, privatePaths) })
  }
}
