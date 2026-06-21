import type { NativeHistoryAdapter } from '#~/api'

export interface NativeHistoryImportAdapterSettings {
  autoImport?: boolean
  maxFileSizeBytes?: number | null
}

export interface NativeHistoryImportSettings {
  autoImport?: boolean
  maxFileSizeBytes?: number | null
  adapters?: Partial<Record<NativeHistoryAdapter, NativeHistoryImportAdapterSettings>>
}

export const defaultNativeHistoryImportMaxFileSizeBytes = 50 * 1024 * 1024

export const nativeHistoryAdapters: NativeHistoryAdapter[] = ['codex', 'claude-code']

export const nativeHistoryAdapterIcons: Record<NativeHistoryAdapter, string> = {
  codex: 'terminal',
  'claude-code': 'auto_awesome'
}

export const getAdapterLabelKey = (adapter: NativeHistoryAdapter) => (
  adapter === 'codex'
    ? 'nativeHistoryImport.platforms.codex'
    : 'nativeHistoryImport.platforms.claudeCode'
)

const compactAdapterSettings = (
  settings: NativeHistoryImportAdapterSettings | undefined
): NativeHistoryImportAdapterSettings | undefined => {
  if (settings == null) return undefined
  const next: NativeHistoryImportAdapterSettings = {
    ...(settings.autoImport === undefined ? {} : { autoImport: settings.autoImport }),
    ...(settings.maxFileSizeBytes === undefined ? {} : { maxFileSizeBytes: settings.maxFileSizeBytes })
  }
  return Object.keys(next).length === 0 ? undefined : next
}

export const compactNativeHistoryImportSettings = (
  settings: NativeHistoryImportSettings | undefined
): NativeHistoryImportSettings | undefined => {
  if (settings == null) return undefined

  const adapters = Object.fromEntries(
    nativeHistoryAdapters.flatMap((adapter) => {
      const adapterSettings = compactAdapterSettings(settings.adapters?.[adapter])
      return adapterSettings == null ? [] : [[adapter, adapterSettings]]
    })
  ) as Partial<Record<NativeHistoryAdapter, NativeHistoryImportAdapterSettings>>

  const next: NativeHistoryImportSettings = {
    ...(settings.autoImport === undefined ? {} : { autoImport: settings.autoImport }),
    ...(settings.maxFileSizeBytes === undefined ? {} : { maxFileSizeBytes: settings.maxFileSizeBytes }),
    ...(Object.keys(adapters).length === 0 ? {} : { adapters })
  }
  return Object.keys(next).length === 0 ? undefined : next
}
