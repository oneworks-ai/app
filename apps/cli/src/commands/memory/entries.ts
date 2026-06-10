import fs from 'node:fs/promises'
import path from 'node:path'

import { resolveContext } from './context'
import { META_FILE_NAME, ensureRelativeMemoryPath, fromStorageSegment, normalizeScope, trimNonEmpty } from './shared'
import type { MemoryCommandOptions, MemoryScope } from './shared'

interface MemoryEntry {
  channel?: string
  id?: string
  memoryPath: string
  scope: MemoryScope
  size: number
}

const decodeEntryParts = (scope: MemoryScope, parts: string[]) => {
  if (scope === 'global') {
    return { fileParts: parts, id: undefined, channel: undefined }
  }
  if (scope === 'session') {
    return {
      fileParts: parts.slice(1),
      id: parts[0] == null ? undefined : fromStorageSegment(parts[0]),
      channel: undefined
    }
  }
  return {
    fileParts: parts.slice(2),
    id: parts[1] == null ? undefined : fromStorageSegment(parts[1]),
    channel: parts[0] == null ? undefined : fromStorageSegment(parts[0])
  }
}

const maybeAddEntry = async (
  entries: MemoryEntry[],
  filePath: string,
  fileName: string,
  options: {
    channel?: string
    id?: string
    memoryPathFilter?: string
    parts: string[]
    scope: MemoryScope
  }
) => {
  const decoded = decodeEntryParts(options.scope, options.parts)
  if (options.channel != null && decoded.channel !== options.channel) return
  if (options.id != null && decoded.id !== options.id) return
  const memoryPath = decoded.fileParts.length === 0 ? fileName : [...decoded.fileParts, fileName].join('/')
  if (options.memoryPathFilter != null && memoryPath !== options.memoryPathFilter) return

  const stat = await fs.stat(filePath)
  entries.push({
    channel: decoded.channel,
    id: decoded.id,
    memoryPath,
    scope: options.scope,
    size: stat.size
  })
}

const collectEntriesUnder = async (
  root: string,
  scope: MemoryScope,
  channel: string | undefined,
  id: string | undefined,
  requestedPath: string | undefined
) => {
  const entries: MemoryEntry[] = []
  const memoryPathFilter = requestedPath == null ? undefined : ensureRelativeMemoryPath(requestedPath)

  const walk = async (dir: string, parts: string[]) => {
    let items: import('node:fs').Dirent[]
    try {
      items = await fs.readdir(dir, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }

    for (const item of items) {
      if (item.name === META_FILE_NAME) continue
      const itemPath = path.resolve(dir, item.name)
      if (item.isDirectory()) {
        await walk(itemPath, [...parts, item.name])
      } else if (item.isFile()) {
        await maybeAddEntry(entries, itemPath, item.name, { channel, id, memoryPathFilter, parts, scope })
      }
    }
  }

  await walk(root, [])
  return entries
}

const scopeRootName = (scope: MemoryScope) => {
  if (scope === 'global') return 'global'
  if (scope === 'channel') return 'channels'
  if (scope === 'session') return 'sessions'
  return 'users'
}

export const listMemoryEntries = async (options: MemoryCommandOptions) => {
  const context = resolveContext(options)
  const scope = normalizeScope(options.scope)
  const entries = await collectEntriesUnder(
    path.resolve(context.root, scopeRootName(scope)),
    scope,
    trimNonEmpty(options.channel),
    trimNonEmpty(options.filter),
    options.path
  )
  return entries.sort((left, right) =>
    `${left.scope}:${left.channel ?? ''}:${left.id ?? ''}:${left.memoryPath}`.localeCompare(
      `${right.scope}:${right.channel ?? ''}:${right.id ?? ''}:${right.memoryPath}`
    )
  )
}

export const formatEntries = (entries: MemoryEntry[]) => {
  if (entries.length === 0) return 'No memories found.'
  return entries.map(entry =>
    [
      entry.scope,
      entry.channel,
      entry.id,
      entry.memoryPath,
      `${entry.size}B`
    ].filter(Boolean).join('\t')
  ).join('\n')
}
