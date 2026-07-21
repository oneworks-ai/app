import type { AdapterCtx } from './adapter'
import type { ConfigSource } from './common'
import type { ModelServiceConfig } from './config'

export type AdapterModelProviderImportSource = ConfigSource

export interface AdapterModelProviderImportResult {
  adapterKey: string
  existingServiceKeys: string[]
  found: boolean
  importedServiceKeys: string[]
  providerCount: number
  skippedProviderIds: string[]
  source: AdapterModelProviderImportSource
}

export interface AdapterModelProviderImportDiscoveryResult {
  found: boolean
  modelServices: Record<string, ModelServiceConfig>
  skippedProviderIds: string[]
}

export type AdapterModelProviderImportDiscoverer = (params: {
  cwd: string
  env: AdapterCtx['env']
  source: AdapterModelProviderImportSource
}) => Promise<AdapterModelProviderImportDiscoveryResult>

export interface AdapterModelProviderImportDescriptor {
  description?: string
  supportedSources: readonly AdapterModelProviderImportSource[]
  title: string
}

export interface AdapterModelProviderImportCapability {
  descriptor: AdapterModelProviderImportDescriptor
  discover: AdapterModelProviderImportDiscoverer
}

export interface AdapterModelProviderImporterDescriptor extends AdapterModelProviderImportDescriptor {
  adapterKey: string
  runtimeAdapter: string
  supportedSources: AdapterModelProviderImportSource[]
}
