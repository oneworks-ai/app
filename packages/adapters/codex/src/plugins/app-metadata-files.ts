import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import type { Dirent } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import { isCredentialLikeNativeAppKey } from '@oneworks/utils'

import {
  containsControlCharacter,
  containsEncodedFilesystemPath,
  isCredentialShapedValue,
  normalizeDeclarativeList
} from './app-metadata-normalization'
import type { CodexPluginManifest } from './source'
import { pathExists, resolveCodexPathWithinPluginRoot } from './source'

const MAX_APP_MANIFEST_BYTES = 256 * 1024
const MAX_APP_MANIFEST_ENTRIES = 64
const MAX_APP_MANIFEST_ENTRY_BYTES = 1024
const MAX_APP_MANIFEST_FILES = 64
const MAX_APP_TREE_DEPTH = 6
const MAX_APP_TREE_ENTRIES = 4096
const MAX_DIAGNOSTIC_PATH_BYTES = 512
const DANGEROUS_METADATA_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

interface AppManifestFileCollection {
  files: string[]
  treeEntries: number
  treeLimit: boolean
  truncated: boolean
}

const collectAppManifestFiles = async (
  pluginRoot: string,
  targetPath: string,
  collection: AppManifestFileCollection,
  depth = 0
): Promise<void> => {
  if (collection.treeLimit) return
  if (depth > MAX_APP_TREE_DEPTH) {
    throw new Error(`Codex app metadata nesting exceeds ${MAX_APP_TREE_DEPTH} directories.`)
  }
  const resolved = await resolveCodexPathWithinPluginRoot(
    pluginRoot,
    targetPath,
    'Codex app metadata path'
  )
  if (!await pathExists(resolved)) return
  const targetStat = await fs.lstat(resolved)
  if (targetStat.isSymbolicLink()) {
    throw new Error('Codex app metadata paths must not use symbolic links.')
  }
  if (targetStat.isFile()) {
    if (!resolved.toLowerCase().endsWith('.app.json') || collection.files.includes(resolved)) return
    if (collection.files.length >= MAX_APP_MANIFEST_FILES) {
      collection.truncated = true
      return
    }
    collection.files.push(resolved)
    return
  }
  if (!targetStat.isDirectory()) return

  const entries: Dirent[] = []
  for await (const entry of await fs.opendir(resolved)) {
    collection.treeEntries += 1
    if (collection.treeEntries > MAX_APP_TREE_ENTRIES) {
      collection.treeLimit = true
      return
    }
    entries.push(entry)
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const candidate = path.join(resolved, entry.name)
    if (entry.isSymbolicLink()) {
      throw new Error('Codex app metadata paths must not use symbolic links.')
    }
    if (entry.isDirectory()) {
      await collectAppManifestFiles(pluginRoot, candidate, collection, depth + 1)
      continue
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.app.json')) continue
    if (collection.files.includes(candidate)) continue
    if (collection.files.length >= MAX_APP_MANIFEST_FILES) {
      collection.truncated = true
      continue
    }
    collection.files.push(candidate)
  }
}

const normalizeAppManifestEntry = (value: unknown) => (
  typeof value === 'string' &&
    value.trim() !== '' &&
    Buffer.byteLength(value.trim(), 'utf8') <= MAX_APP_MANIFEST_ENTRY_BYTES
    ? value.trim()
    : undefined
)

export const getAppManifestEntries = (manifest: CodexPluginManifest | undefined) => {
  if (manifest?.apps == null) return { entries: ['.app.json'], invalid: false }
  if (typeof manifest.apps === 'string') {
    const entry = normalizeAppManifestEntry(manifest.apps)
    return entry == null
      ? { entries: [], invalid: true }
      : { entries: [entry], invalid: false }
  }
  if (!Array.isArray(manifest.apps) || manifest.apps.length > MAX_APP_MANIFEST_ENTRIES) {
    return { entries: [], invalid: true }
  }
  const entries = manifest.apps.map(normalizeAppManifestEntry)
  return entries.some(entry => entry == null)
    ? { entries: [], invalid: true }
    : { entries: [...new Set(entries as string[])], invalid: false }
}

export const getManifestCapabilities = (manifest: CodexPluginManifest | undefined) => {
  if (manifest?.interface?.capabilities == null) return { invalid: false, value: undefined }
  const value = normalizeDeclarativeList(manifest.interface.capabilities, {
    itemBytes: 256,
    maxItems: 64,
    field: 'capability'
  })
  return value == null
    ? { invalid: true, value: undefined }
    : { invalid: false, value }
}

export const toSafeRelativeAppPath = (pluginRoot: string, filePath: string) => {
  const relative = path.relative(pluginRoot, filePath).split(path.sep).filter(part => part !== '')
  return relative.length === 0 ? '.app.json' : relative.join('/')
}

export const toBoundedDiagnosticValue = (value: string, prefix: string) => (
  Buffer.byteLength(value, 'utf8') <= MAX_DIAGNOSTIC_PATH_BYTES &&
    !containsControlCharacter(value) &&
    !containsEncodedFilesystemPath(value) &&
    !isCredentialShapedValue(value)
    ? value
    : `${prefix}-${createHash('sha256').update(value).digest('hex').slice(0, 16)}`
)

export const toGeneratedAppPath = (relativePath: string) => {
  const candidate = relativePath.startsWith('apps/')
    ? relativePath.slice('apps/'.length)
    : relativePath
  const safe = Buffer.byteLength(candidate, 'utf8') <= MAX_DIAGNOSTIC_PATH_BYTES &&
    candidate.split('/').every((segment) => {
      const stem = segment.replace(/\.app\.json$/iu, '')
      return (
        /^[a-z0-9][\w.-]{0,127}$/iu.test(segment) &&
        !DANGEROUS_METADATA_KEYS.has(stem) &&
        !isCredentialLikeNativeAppKey(stem) &&
        !isCredentialShapedValue(stem)
      )
    })
  return safe
    ? candidate
    : `metadata-${createHash('sha256').update(relativePath).digest('hex').slice(0, 16)}.app.json`
}

export const readBoundedAppManifest = async (filePath: string) => {
  const handle = await fs.open(filePath, constants.O_RDONLY)
  try {
    const fileStat = await handle.stat()
    if (fileStat.size > MAX_APP_MANIFEST_BYTES) return { oversized: true as const }
    const content = await handle.readFile()
    if (content.byteLength > MAX_APP_MANIFEST_BYTES) return { oversized: true as const }
    return {
      bytes: content.byteLength,
      content: content.toString('utf8'),
      oversized: false as const
    }
  } finally {
    await handle.close()
  }
}

export const collectAppMetadataFiles = async (
  pluginRoot: string,
  entries: string[]
) => {
  const collection: AppManifestFileCollection = {
    files: [],
    treeEntries: 0,
    treeLimit: false,
    truncated: false
  }
  for (const entry of entries) {
    await collectAppManifestFiles(pluginRoot, entry, collection)
  }
  collection.files.sort((left, right) => left.localeCompare(right))
  return collection
}
