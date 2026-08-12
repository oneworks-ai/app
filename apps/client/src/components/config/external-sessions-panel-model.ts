import { nativeHistoryAdapters } from '#~/api'
import type { NativeHistoryAdapter, NativeHistoryImportAdapterPreview } from '#~/api'

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

export const defaultNativeHistoryImportMaxFileSizeBytes = 50 * 1024 * 1024

export const nativeHistoryAdapterIcons: Record<NativeHistoryAdapter, string> = {
  codex: 'terminal',
  'claude-code': 'auto_awesome',
  cursor: 'near_me'
}

export const getAdapterLabelKey = (adapter: NativeHistoryAdapter) => (
  adapter === 'codex'
    ? 'nativeHistoryImport.platforms.codex'
    : adapter === 'cursor'
    ? 'nativeHistoryImport.platforms.cursor'
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
      largeFiles: candidates.filter(candidate => candidate.isLarge).length,
      largestFileBytes: Math.max(0, ...candidates.map(candidate => candidate.fileSizeBytes)),
      matchedFiles: candidates.length,
      totalBytes: candidates.reduce((sum, candidate) => sum + candidate.fileSizeBytes, 0)
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
