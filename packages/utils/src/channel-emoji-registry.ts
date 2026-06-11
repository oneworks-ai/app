/* eslint-disable max-lines -- Emoji registry storage helpers stay colocated. */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

export interface ChannelEmojiRegistryEntry {
  aliases?: string[]
  createdAt?: number
  id: string
  label?: string
  metadata?: Record<string, unknown>
  note?: string
  platform: string
  source?: Record<string, string | undefined>
  tags?: string[]
  updatedAt?: number
}

export interface ChannelEmojiRegistryFilter {
  query?: string
  sendable?: boolean
  tags?: string[]
}

interface ChannelEmojiRegistryFile {
  emojis: ChannelEmojiRegistryEntry[]
  updatedAt?: number
  version: 1
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const trimNonEmpty = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

const normalizeStringList = (value: unknown) => {
  const values = Array.isArray(value) ? value : [value]
  const unique = new Set<string>()
  for (const item of values) {
    const trimmed = trimNonEmpty(item)
    if (trimmed != null) unique.add(trimmed)
  }
  return [...unique]
}

const normalizeMetadata = (value: unknown) => (
  isRecord(value) ? value : undefined
)

const normalizeEntryId = (value: unknown, platform: string) => {
  let id = trimNonEmpty(value)
  const prefix = `${platform.toLowerCase()}:`
  while (id?.toLowerCase().startsWith(prefix) === true) {
    id = trimNonEmpty(id.slice(prefix.length))
  }
  return id
}

const toPositiveInteger = (value: unknown) => {
  const normalized = typeof value === 'number'
    ? value
    : Number.parseInt(trimNonEmpty(value) ?? '', 10)
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : undefined
}

const normalizeSource = (value: unknown) => {
  if (!isRecord(value)) return undefined
  const entries = Object.entries(value)
    .map(([key, item]) => [key, trimNonEmpty(item)] as const)
    .filter((entry): entry is readonly [string, string] => entry[1] != null)
  return entries.length === 0 ? undefined : Object.fromEntries(entries)
}

export const normalizeChannelEmojiRegistryEntry = (
  value: unknown
): ChannelEmojiRegistryEntry | undefined => {
  if (!isRecord(value)) return undefined
  const platform = trimNonEmpty(value.platform)
  const id = platform == null ? undefined : normalizeEntryId(value.id, platform)
  if (platform == null || id == null) return undefined

  const aliases = normalizeStringList(value.aliases)
  const tags = normalizeStringList(value.tags)
  return {
    id,
    platform,
    ...(aliases.length === 0 ? {} : { aliases }),
    ...(trimNonEmpty(value.label) == null ? {} : { label: trimNonEmpty(value.label) }),
    ...(normalizeMetadata(value.metadata) == null ? {} : { metadata: normalizeMetadata(value.metadata) }),
    ...(trimNonEmpty(value.note) == null ? {} : { note: trimNonEmpty(value.note) }),
    ...(normalizeSource(value.source) == null ? {} : { source: normalizeSource(value.source) }),
    ...(tags.length === 0 ? {} : { tags }),
    ...(typeof value.createdAt === 'number' ? { createdAt: value.createdAt } : {}),
    ...(typeof value.updatedAt === 'number' ? { updatedAt: value.updatedAt } : {})
  }
}

const sanitizePlatform = (platform: string) => {
  const sanitized = platform.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '')
  return sanitized === '' ? 'unknown' : sanitized
}

export const resolveChannelEmojiRegistryRoot = (channelMemoryRoot: string) =>
  path.resolve(channelMemoryRoot, 'emoji-registry', 'v1')

const resolvePlatformFile = (channelMemoryRoot: string, platform: string) =>
  path.resolve(resolveChannelEmojiRegistryRoot(channelMemoryRoot), `${sanitizePlatform(platform)}.json`)

const readPlatformRegistry = async (
  channelMemoryRoot: string,
  platform: string
): Promise<ChannelEmojiRegistryFile> => {
  try {
    const parsed = JSON.parse(await readFile(resolvePlatformFile(channelMemoryRoot, platform), 'utf8')) as unknown
    if (!isRecord(parsed) || !Array.isArray(parsed.emojis)) {
      return { version: 1, emojis: [] }
    }
    const emojis = parsed.emojis
      .map(normalizeChannelEmojiRegistryEntry)
      .filter((item): item is ChannelEmojiRegistryEntry => item != null)
    return {
      version: 1,
      ...(typeof parsed.updatedAt === 'number' ? { updatedAt: parsed.updatedAt } : {}),
      emojis: mergeChannelEmojiRegistryEntries(emojis)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, emojis: [] }
    throw error
  }
}

const writePlatformRegistry = async (
  channelMemoryRoot: string,
  platform: string,
  registry: ChannelEmojiRegistryFile
) => {
  const filePath = resolvePlatformFile(channelMemoryRoot, platform)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8')
}

const mergeChannelEmojiRegistryEntries = (entries: ChannelEmojiRegistryEntry[]) => {
  const byId = new Map<string, ChannelEmojiRegistryEntry>()
  for (const entry of entries) {
    const previous = byId.get(entry.id)
    if (previous == null) {
      byId.set(entry.id, entry)
      continue
    }

    const updatedAt = Math.max(previous.updatedAt ?? 0, entry.updatedAt ?? 0)
    byId.set(entry.id, {
      ...previous,
      ...entry,
      aliases: Array.from(new Set([...(previous.aliases ?? []), ...(entry.aliases ?? [])])),
      createdAt: previous.createdAt ?? entry.createdAt,
      metadata: {
        ...(previous.metadata ?? {}),
        ...(entry.metadata ?? {})
      },
      source: {
        ...(previous.source ?? {}),
        ...(entry.source ?? {})
      },
      tags: Array.from(new Set([...(previous.tags ?? []), ...(entry.tags ?? [])])),
      ...(updatedAt <= 0 ? {} : { updatedAt })
    })
  }

  return [...byId.values()].map(entry => {
    const next = { ...entry }
    if (next.aliases?.length === 0) delete next.aliases
    if (Object.keys(next.metadata ?? {}).length === 0) delete next.metadata
    if (Object.keys(next.source ?? {}).length === 0) delete next.source
    if (next.tags?.length === 0) delete next.tags
    return next
  })
}

const entryMatches = (entry: ChannelEmojiRegistryEntry, id: string) => (
  entry.id === (normalizeEntryId(id, entry.platform) ?? id) || entry.aliases?.includes(id) === true
)

export const upsertChannelEmojiRegistryEntry = async (
  channelMemoryRoot: string,
  input: ChannelEmojiRegistryEntry
) => {
  const entry = normalizeChannelEmojiRegistryEntry(input)
  if (entry == null) throw new Error('Invalid emoji registry entry.')

  const now = Date.now()
  const registry = await readPlatformRegistry(channelMemoryRoot, entry.platform)
  const index = registry.emojis.findIndex(item => item.id === entry.id)
  const previous = index < 0 ? undefined : registry.emojis[index]
  const next: ChannelEmojiRegistryEntry = {
    ...previous,
    ...entry,
    aliases: Array.from(new Set([...(previous?.aliases ?? []), ...(entry.aliases ?? [])])),
    createdAt: previous?.createdAt ?? entry.createdAt ?? now,
    metadata: {
      ...(previous?.metadata ?? {}),
      ...(entry.metadata ?? {})
    },
    source: {
      ...(previous?.source ?? {}),
      ...(entry.source ?? {})
    },
    tags: Array.from(new Set([...(previous?.tags ?? []), ...(entry.tags ?? [])])),
    updatedAt: now
  }
  if (next.aliases?.length === 0) delete next.aliases
  if (Object.keys(next.metadata ?? {}).length === 0) delete next.metadata
  if (Object.keys(next.source ?? {}).length === 0) delete next.source
  if (next.tags?.length === 0) delete next.tags

  if (index < 0) {
    registry.emojis.push(next)
  } else {
    registry.emojis[index] = next
  }
  registry.emojis.sort((left, right) => left.id.localeCompare(right.id))
  registry.updatedAt = now
  await writePlatformRegistry(channelMemoryRoot, entry.platform, registry)
  return next
}

export const listChannelEmojiRegistryEntries = async (
  channelMemoryRoot: string,
  platform?: string
) => {
  const requestedPlatform = trimNonEmpty(platform)
  if (requestedPlatform != null) {
    return (await readPlatformRegistry(channelMemoryRoot, requestedPlatform)).emojis
  }

  let files: string[]
  try {
    files = await readdir(resolveChannelEmojiRegistryRoot(channelMemoryRoot))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  const entries = await Promise.all(
    files
      .filter(file => file.endsWith('.json'))
      .map(async file => (await readPlatformRegistry(channelMemoryRoot, path.basename(file, '.json'))).emojis)
  )
  return entries.flat().sort((left, right) =>
    `${left.platform}:${left.id}`.localeCompare(`${right.platform}:${right.id}`)
  )
}

export const findChannelEmojiRegistryEntry = async (
  channelMemoryRoot: string,
  input: {
    id: string
    platform?: string
  }
) => {
  const id = trimNonEmpty(input.id)
  if (id == null) return undefined
  return (await listChannelEmojiRegistryEntries(channelMemoryRoot, input.platform))
    .find(entry => entryMatches(entry, id))
}

export const isChannelEmojiRegistryEntrySendable = (entry: ChannelEmojiRegistryEntry) => {
  if (entry.metadata?.sendable === true) return true
  if (entry.platform.toLowerCase() !== 'wechat') return false
  return trimNonEmpty(entry.metadata?.emojiMd5) != null &&
    toPositiveInteger(entry.metadata?.emojiSize) != null
}

export const filterChannelEmojiRegistryEntries = (
  entries: ChannelEmojiRegistryEntry[],
  filter: ChannelEmojiRegistryFilter = {}
) => {
  const query = trimNonEmpty(filter.query)?.toLowerCase()
  const requiredTags = normalizeStringList(filter.tags).map(tag => tag.toLowerCase())
  return entries.filter(entry => {
    if (filter.sendable === true && !isChannelEmojiRegistryEntrySendable(entry)) return false
    const entryTags = (entry.tags ?? []).map(tag => tag.toLowerCase())
    if (requiredTags.some(tag => !entryTags.includes(tag))) return false
    if (query == null) return true
    return [
      entry.platform,
      entry.id,
      entry.label,
      entry.note,
      ...(entry.aliases ?? []),
      ...(entry.tags ?? []),
      JSON.stringify(entry.metadata ?? {})
    ].filter((item): item is string => typeof item === 'string').join('\n').toLowerCase().includes(query)
  })
}

export const sortChannelEmojiRegistryEntriesByRecent = (entries: ChannelEmojiRegistryEntry[]) => (
  [...entries].sort((left, right) =>
    (right.updatedAt ?? right.createdAt ?? 0) - (left.updatedAt ?? left.createdAt ?? 0)
  )
)

export const formatChannelEmojiRegistryEntries = (entries: ChannelEmojiRegistryEntry[]) => {
  if (entries.length === 0) return 'No emojis found.'
  return entries.map(entry =>
    [
      `${entry.platform}:${entry.id}`,
      entry.label == null ? undefined : `label=${entry.label}`,
      entry.aliases == null ? undefined : `aliases=${entry.aliases.join(',')}`,
      entry.tags == null ? undefined : `tags=${entry.tags.join(',')}`,
      entry.note == null ? undefined : `note=${entry.note}`,
      `sendable=${isChannelEmojiRegistryEntrySendable(entry) ? 'yes' : 'no'}`,
      JSON.stringify(entry.metadata ?? {})
    ].filter(item => item != null && item !== '').join('\t')
  ).join('\n')
}
