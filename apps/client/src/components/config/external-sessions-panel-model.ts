import { nativeHistoryAdapters } from '#~/api'
import type { NativeHistoryAdapter, NativeHistoryImportAdapterPreview } from '#~/api'
import { NATIVE_HISTORY_IMPORT_MAX_FILE_SIZE_BYTES } from '@oneworks/types'

export { nativeHistoryAdapters }

export interface NativeHistoryImportAdapterSettings {
  autoImport?: boolean
  maxFileSizeBytes?: number | null
}

export interface NativeHistoryImportSettings {
  autoImport?: boolean
  maxFileSizeBytes?: number | null
  adapters?: Partial<Record<NativeHistoryAdapter, NativeHistoryImportAdapterSettings>>
}

export interface ExternalSessionsProjectOption {
  description?: string
  isCurrent?: boolean
  label: string
  value: string
}

export const defaultNativeHistoryImportMaxFileSizeBytes = NATIVE_HISTORY_IMPORT_MAX_FILE_SIZE_BYTES

export const megabytesToNativeHistoryBytes = (value: number | null) => {
  if (value == null) return null
  const bytes = Math.round(value * 1024 * 1024)
  return Number.isFinite(bytes) && bytes >= 0 && bytes <= NATIVE_HISTORY_IMPORT_MAX_FILE_SIZE_BYTES
    ? bytes
    : undefined
}

export const isValidNativeHistorySizeLimit = (value: number | null | undefined) => (
  value == null || (
    Number.isFinite(value) && value >= 0 && value <= NATIVE_HISTORY_IMPORT_MAX_FILE_SIZE_BYTES
  )
)

export const resolveNativeHistoryGlobalSizeLimit = (
  settings: NativeHistoryImportSettings | undefined
) =>
  typeof settings?.maxFileSizeBytes === 'number'
    ? settings.maxFileSizeBytes
    : NATIVE_HISTORY_IMPORT_MAX_FILE_SIZE_BYTES

export const resolveNativeHistoryAdapterSizeLimit = (
  settings: NativeHistoryImportSettings | undefined,
  adapter: NativeHistoryAdapter
) => {
  const adapterSettings = settings?.adapters?.[adapter]
  if (adapterSettings != null && Object.prototype.hasOwnProperty.call(adapterSettings, 'maxFileSizeBytes')) {
    return typeof adapterSettings.maxFileSizeBytes === 'number'
      ? adapterSettings.maxFileSizeBytes
      : NATIVE_HISTORY_IMPORT_MAX_FILE_SIZE_BYTES
  }
  return resolveNativeHistoryGlobalSizeLimit(settings)
}

export const nativeHistoryAdapterIcons: Record<NativeHistoryAdapter, string> = {
  codex: 'terminal',
  'claude-code': 'auto_awesome',
  cline: 'smart_toy',
  cursor: 'near_me',
  droid: 'smart_toy',
  goose: 'flutter_dash',
  grok: 'star',
  'qwen-code': 'code'
}

export const getAdapterLabelKey = (adapter: NativeHistoryAdapter) => (
  adapter === 'codex'
    ? 'nativeHistoryImport.platforms.codex'
    : adapter === 'cline'
    ? 'nativeHistoryImport.platforms.cline'
    : adapter === 'cursor'
    ? 'nativeHistoryImport.platforms.cursor'
    : adapter === 'droid'
    ? 'nativeHistoryImport.platforms.droid'
    : adapter === 'grok'
    ? 'nativeHistoryImport.platforms.grok'
    : adapter === 'goose'
    ? 'nativeHistoryImport.platforms.goose'
    : adapter === 'qwen-code'
    ? 'nativeHistoryImport.platforms.qwenCode'
    : 'nativeHistoryImport.platforms.claudeCode'
)

export const removeImportedNativeHistoryPreviewCandidates = (
  pages: Array<NativeHistoryImportAdapterPreview | undefined> | undefined,
  importedSourcePaths: ReadonlySet<string>
) => {
  if (pages == null || importedSourcePaths.size === 0) {
    return pages
  }
  return pages.map((page) => {
    if (page == null) {
      return page
    }
    const candidates = page.candidates.filter(
      candidate => !importedSourcePaths.has(candidate.sourcePath)
    )
    return {
      ...page,
      candidates,
      largeFiles: candidates.filter(candidate => candidate.isLarge).length + page.perFileLimitedFiles,
      largestFileBytes: Math.max(
        page.perFileLimitedFiles > 0 ? page.largestFileBytes : 0,
        ...candidates.map(candidate => candidate.fileSizeBytes)
      ),
      matchedFiles: candidates.length,
      aggregateLimitedBytes: page.aggregateLimitedBytes,
      aggregateLimitedFiles: page.aggregateLimitedFiles,
      perFileLimitedBytes: page.perFileLimitedBytes,
      perFileLimitedFiles: page.perFileLimitedFiles,
      rejectedFiles: page.rejectedFiles,
      sizeLimitedBytes: page.sizeLimitedBytes,
      sizeLimitedFiles: page.sizeLimitedFiles,
      totalBytes: page.sizeLimitedBytes + candidates.reduce(
        (sum, candidate) => sum + candidate.fileSizeBytes,
        0
      )
    }
  })
}

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
