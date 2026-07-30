import type { PluginNativeAppMetadata, PluginNativeMetadataDiagnostic } from '@oneworks/types'
import { MAX_PUBLIC_NATIVE_APPS } from '@oneworks/types'
import { isCredentialLikeNativeAppKey } from '@oneworks/utils'

import { parseAppMetadataDescriptor } from './app-metadata-descriptor'
import {
  collectAppMetadataFiles,
  getAppManifestEntries,
  getManifestCapabilities,
  readBoundedAppManifest,
  toBoundedDiagnosticValue,
  toGeneratedAppPath,
  toSafeRelativeAppPath
} from './app-metadata-files'
import { inspectAppMetadataShape } from './app-metadata-inspection'
import {
  hasOnlyOwnAllowedAppMetadataKeys,
  isPlainAppMetadataRecord,
  normalizeDeclarativeValue
} from './app-metadata-normalization'
import type { CodexPluginManifest } from './source'

const MAX_APP_MANIFEST_TOTAL_BYTES = 1024 * 1024
const APP_CONTAINER_KEYS = new Set(['apps'])
const DANGEROUS_METADATA_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

interface GeneratedAppMetadataFile {
  content: string
  path: string
}

const diagnostic = (
  code: string,
  message: string
): PluginNativeMetadataDiagnostic => ({
  code,
  level: 'warning',
  message
})

export const collectCodexAppMetadata = async (
  pluginRoot: string,
  manifest: CodexPluginManifest | undefined
) => {
  const apps: PluginNativeAppMetadata[] = []
  const diagnostics: PluginNativeMetadataDiagnostic[] = []
  const generatedFiles: GeneratedAppMetadataFile[] = []
  const manifestEntries = getAppManifestEntries(manifest)
  const manifestCapabilities = getManifestCapabilities(manifest)
  if (manifestEntries.invalid || manifestCapabilities.invalid) {
    return {
      apps,
      diagnostics: [diagnostic(
        'codex_app_metadata_manifest_invalid',
        'Codex app metadata declarations must use bounded paths and capabilities.'
      )],
      generatedFiles
    }
  }

  const collection = await collectAppMetadataFiles(pluginRoot, manifestEntries.entries)
  if (collection.truncated) {
    diagnostics.push(diagnostic(
      'codex_app_metadata_file_limit',
      'Only the first 64 Codex app metadata files were inspected.'
    ))
  }
  if (collection.treeLimit) {
    diagnostics.push(diagnostic(
      'codex_app_metadata_tree_limit',
      'Codex app metadata discovery reached its bounded directory entry limit.'
    ))
  }

  let totalBytes = 0
  let appLimitReached = false
  for (const filePath of collection.files) {
    if (appLimitReached) break
    const relativePath = toSafeRelativeAppPath(pluginRoot, filePath)
    const diagnosticPath = toBoundedDiagnosticValue(relativePath, 'metadata')
    const bounded = await readBoundedAppManifest(filePath)
    if (bounded.oversized) {
      diagnostics.push(diagnostic(
        'codex_app_metadata_file_limit',
        `Codex app metadata "${diagnosticPath}" exceeded the per-file byte limit.`
      ))
      continue
    }
    if (totalBytes + bounded.bytes > MAX_APP_MANIFEST_TOTAL_BYTES) {
      diagnostics.push(diagnostic(
        'codex_app_metadata_total_limit',
        'Codex app metadata reached its total byte limit.'
      ))
      break
    }
    totalBytes += bounded.bytes

    let parsed: unknown
    try {
      parsed = JSON.parse(bounded.content) as unknown
    } catch {
      diagnostics.push(diagnostic(
        'codex_app_metadata_malformed',
        `Codex app metadata "${diagnosticPath}" is not valid JSON.`
      ))
      continue
    }
    if (
      !isPlainAppMetadataRecord(parsed) ||
      !hasOnlyOwnAllowedAppMetadataKeys(parsed, APP_CONTAINER_KEYS) ||
      !Object.hasOwn(parsed, 'apps') ||
      !isPlainAppMetadataRecord(parsed.apps)
    ) {
      diagnostics.push(diagnostic(
        'codex_app_metadata_malformed',
        `Codex app metadata "${diagnosticPath}" must contain one bounded apps object.`
      ))
      continue
    }

    const generatedApps: Record<string, PluginNativeAppMetadata> = Object.create(null) as Record<
      string,
      PluginNativeAppMetadata
    >
    for (const [rawName, rawDescriptor] of Object.entries(parsed.apps)) {
      if (apps.length >= MAX_PUBLIC_NATIVE_APPS) {
        diagnostics.push(diagnostic(
          'codex_app_metadata_app_limit',
          `Only the first ${MAX_PUBLIC_NATIVE_APPS} Codex app declarations were used.`
        ))
        appLimitReached = true
        break
      }
      const diagnosticName = toBoundedDiagnosticValue(rawName, 'app')
      const name = DANGEROUS_METADATA_KEYS.has(rawName) ||
          isCredentialLikeNativeAppKey(rawName)
        ? undefined
        : normalizeDeclarativeValue(rawName, { field: 'appName', maxBytes: 64 })
      const shape = { invalid: false, nodes: 0, secret: false }
      inspectAppMetadataShape(rawDescriptor, shape)
      if (shape.secret) {
        diagnostics.push(diagnostic(
          'codex_app_metadata_secret_rejected',
          `Codex app "${diagnosticName}" contained credential-shaped data and was ignored.`
        ))
        continue
      }
      if (name == null || shape.invalid) {
        diagnostics.push(diagnostic(
          'codex_app_metadata_app_invalid',
          `Codex app "${diagnosticName}" has an unsupported metadata shape and was ignored.`
        ))
        continue
      }
      const app = parseAppMetadataDescriptor(name, rawDescriptor, manifestCapabilities.value)
      if (app == null) {
        diagnostics.push(diagnostic(
          'codex_app_metadata_app_invalid',
          `Codex app "${diagnosticName}" has an unsupported metadata shape and was ignored.`
        ))
        continue
      }
      apps.push(app)
      generatedApps[name] = app
    }
    if (Object.keys(generatedApps).length > 0) {
      generatedFiles.push({
        content: `${JSON.stringify({ apps: generatedApps }, null, 2)}\n`,
        path: toGeneratedAppPath(relativePath)
      })
    }
  }

  return { apps, diagnostics, generatedFiles }
}
