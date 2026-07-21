import { serializeComparableConfigValue } from './configConflict'

interface AdapterImporterPluginIdentity {
  packageId?: string
  requestId: string
  scope: string
  version?: string
}

export const getAdapterImporterConfigFingerprint = (params: {
  mergedConfig?: {
    adapters?: unknown
    general?: { defaultAdapter?: unknown }
  }
  pluginInstances?: AdapterImporterPluginIdentity[]
}) =>
  serializeComparableConfigValue({
    adapters: params.mergedConfig?.adapters,
    defaultAdapter: params.mergedConfig?.general?.defaultAdapter,
    pluginInstances: [...(params.pluginInstances ?? [])].sort((left, right) => (
      left.scope.localeCompare(right.scope) || left.requestId.localeCompare(right.requestId)
    ))
  })
