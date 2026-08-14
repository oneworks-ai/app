/* eslint-disable max-lines -- file target resolution and atomic structured-memory sync form one boundary. */
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { closeSync, lstatSync, openSync, readFileSync, readSync } from 'node:fs'
import path from 'node:path'

import { getDb } from '#~/db/index.js'
import type { ChannelMemorySubjectType, ChannelMemoryVisibility } from '#~/db/index.js'
import { resolveChannelMemoryRoot } from '#~/services/session/channel-context.js'
import type { EntityMemoryPolicy } from '@oneworks/types'

import type { ChannelMemoryResolverScope } from './filter.js'
import { extractMemoryKeywords } from './ranking.js'

const DEFAULT_MEMORY_PATH = 'README.md'
const META_FILE_NAME = '.oneworks-mem.json'
const MAX_MEMORY_FILE_BYTES = 64 * 1024

export interface ChannelFileMemorySyncInput extends ChannelMemoryResolverScope {
  childRunId?: string
  conversationStateId?: string
  memoryRoot?: string
  memoryPolicy?: EntityMemoryPolicy
  senderId?: string
  sourceMessageId?: string
}

interface FileMemoryTarget {
  filePath: string
  scope: 'channel' | 'conversation' | 'entity' | 'room' | 'user'
  subjectId: string
  subjectType: ChannelMemorySubjectType
  visibilityPartition?: 'direct' | 'organization'
}

const toStorageSegment = (value: string) => Buffer.from(value, 'utf8').toString('base64url')

const trimNonEmpty = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

const readMemoryFile = (filePath: string) => {
  try {
    const stat = lstatSync(filePath)
    if (!stat.isFile() || stat.isSymbolicLink()) return undefined
    if (stat.size > MAX_MEMORY_FILE_BYTES) {
      throw new Error(`Channel memory file exceeds the ${MAX_MEMORY_FILE_BYTES} byte limit: ${filePath}`)
    }
    const fd = openSync(filePath, 'r')
    try {
      const buffer = Buffer.allocUnsafe(stat.size)
      const bytesRead = readSync(fd, buffer, 0, stat.size, 0)
      return buffer.subarray(0, bytesRead).toString('utf8').trim()
    } finally {
      closeSync(fd)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

const readSourceSessionType = (target: FileMemoryTarget, fallback: string) => {
  if (target.visibilityPartition === 'direct') return 'direct'
  if (target.visibilityPartition === 'organization') return 'group'
  try {
    const parsed = JSON.parse(
      readFileSync(path.resolve(path.dirname(target.filePath), META_FILE_NAME), 'utf8')
    ) as unknown
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback
    return trimNonEmpty((parsed as Record<string, unknown>).channelSessionType) ?? fallback
  } catch {
    return fallback
  }
}

const resolveVisibilityPartition = (sessionType: string) => {
  if (sessionType === 'direct') return 'direct' as const
  if (sessionType === 'group') return 'organization' as const
  throw new Error(`Unsupported channel memory session type: ${sessionType}`)
}

const createMemoryId = (input: ChannelFileMemorySyncInput, target: FileMemoryTarget, memoryRoot: string) => {
  const identity = JSON.stringify([
    input.orgId,
    input.issuer,
    path.relative(memoryRoot, target.filePath)
  ])
  return `channel_memory_file_${createHash('sha256').update(identity).digest('hex').slice(0, 32)}`
}

const resolveTargets = (input: ChannelFileMemorySyncInput, memoryRoot: string): FileMemoryTarget[] => {
  const targets: FileMemoryTarget[] = []
  const channelRef = `${input.channelType}:${input.channelKey}`
  const visibilityPartition = resolveVisibilityPartition(input.sessionType)
  if (input.entity != null) {
    targets.push({
      filePath: path.resolve(
        memoryRoot,
        'entities',
        toStorageSegment(input.entity),
        visibilityPartition,
        DEFAULT_MEMORY_PATH
      ),
      scope: 'entity',
      subjectId: input.entity,
      subjectType: 'entity',
      visibilityPartition
    })
  }
  if (input.roomId != null) {
    targets.push({
      filePath: path.resolve(
        memoryRoot,
        'rooms',
        toStorageSegment(input.roomId),
        visibilityPartition,
        DEFAULT_MEMORY_PATH
      ),
      scope: 'room',
      subjectId: input.roomId,
      subjectType: 'room',
      visibilityPartition
    })
  }
  targets.push({
    filePath: path.resolve(
      memoryRoot,
      'channels',
      toStorageSegment(channelRef),
      toStorageSegment(input.channelId),
      DEFAULT_MEMORY_PATH
    ),
    scope: 'channel',
    subjectId: `${input.issuer}:${input.channelId}`,
    subjectType: 'channel'
  })
  if (input.conversationStateId != null) {
    targets.push({
      filePath: path.resolve(
        memoryRoot,
        'conversations',
        toStorageSegment(input.conversationStateId),
        DEFAULT_MEMORY_PATH
      ),
      scope: 'conversation',
      subjectId: input.conversationStateId,
      subjectType: 'conversation'
    })
  }
  if (input.senderId != null) {
    targets.push({
      filePath: path.resolve(
        memoryRoot,
        'users',
        toStorageSegment(channelRef),
        toStorageSegment(input.senderId),
        toStorageSegment(input.sessionType),
        DEFAULT_MEMORY_PATH
      ),
      scope: 'user',
      subjectId: input.canonicalUserId ?? input.accountId,
      subjectType: input.canonicalUserId == null ? 'account' : 'canonical_user'
    })
  }
  return targets
}

const createVisibility = (
  input: ChannelFileMemorySyncInput,
  subjectType: ChannelMemorySubjectType,
  sourceSessionType: string
): ChannelMemoryVisibility => ({
  orgs: [input.orgId],
  ...(input.entity == null ? {} : { entities: [input.entity] }),
  ...(subjectType !== 'room' || input.roomId == null ? {} : { rooms: [input.roomId] }),
  ...(subjectType === 'channel' || subjectType === 'conversation'
    ? {
      channels: [`${input.channelType}:${input.channelKey}:${input.channelId}`],
      conversationTypes: sourceSessionType === 'direct' ? ['direct'] : ['direct', 'group']
    }
    : { conversationTypes: sourceSessionType === 'direct' ? ['direct'] : ['direct', 'group'] })
})

export const syncChannelFileMemories = (input: ChannelFileMemorySyncInput) => {
  const db = getDb()
  const memoryRoot = input.memoryRoot ?? resolveChannelMemoryRoot()
  const changedMemoryIds: string[] = []

  for (const target of resolveTargets(input, memoryRoot)) {
    const writableScopes = input.memoryPolicy?.writableScopes
    if (writableScopes != null && !writableScopes.includes(target.scope)) continue
    const content = readMemoryFile(target.filePath)
    if (content == null) continue
    const id = createMemoryId(input, target, memoryRoot)
    const existing = db.getChannelMemory(id)
    const expectedCanonicalUserId = target.subjectType === 'canonical_user' ? input.canonicalUserId : undefined
    const expectedAccountId = target.subjectType === 'account' ? input.accountId : undefined
    const changed = !(
      existing?.content === content &&
      existing.subjectType === target.subjectType &&
      existing.subjectId === target.subjectId &&
      (existing.canonicalUserId ?? undefined) === expectedCanonicalUserId &&
      (existing.accountId ?? undefined) === expectedAccountId
    )

    const sourceSessionType = readSourceSessionType(target, input.sessionType)
    const contentHash = createHash('sha256').update(content).digest('hex')
    const patchKey = `file-memory:${id}:${contentHash}`
    let writebackId: string | undefined
    if (input.childRunId != null && changed) {
      writebackId = db.createPendingChannelMemoryWriteback({
        childRunId: input.childRunId,
        patch: {
          contentHash,
          kind: 'file_memory_sync',
          memoryId: id,
          path: DEFAULT_MEMORY_PATH,
          subjectType: target.subjectType,
          visibilityPartition: target.visibilityPartition
        },
        patchKey
      })
    } else if (input.childRunId != null) {
      const pending = db.getChannelMemoryWritebackByPatchKey(input.childRunId, patchKey)
      if (pending?.status === 'pending') writebackId = pending.id
    }

    if (changed) {
      if (
        input.memoryPolicy?.requireEvidence === true &&
        input.childRunId == null && input.sourceMessageId == null
      ) {
        throw new Error('Entity memory policy requires evidence before memory writeback.')
      }
      const defaultTtlSeconds = input.memoryPolicy?.defaultTtlSeconds
      db.upsertChannelMemory({
        ...(target.subjectType === 'account' ? { accountId: input.accountId } : {}),
        ...(target.subjectType === 'canonical_user' ? { canonicalUserId: input.canonicalUserId } : {}),
        confidence: .8,
        content,
        entity: input.entity,
        expiresAt: defaultTtlSeconds == null ? undefined : Date.now() + defaultTtlSeconds * 1000,
        id,
        importance: .75,
        issuer: input.issuer,
        keywords: extractMemoryKeywords(content),
        metadata: {
          sourceChildRunId: input.childRunId,
          sourceMessageId: input.sourceMessageId
        },
        orgId: input.orgId,
        roomId: target.subjectType === 'room' ? input.roomId : undefined,
        pinned: false,
        sensitivity: 'normal',
        source: {
          channelId: input.channelId,
          channelKey: input.channelKey,
          channelType: input.channelType,
          issuer: input.issuer,
          org: input.orgId,
          roomId: input.roomId,
          sessionType: sourceSessionType
        },
        subjectId: target.subjectId,
        subjectType: target.subjectType,
        threadKey: target.subjectType === 'conversation' ? input.threadKey : undefined,
        visibility: createVisibility(input, target.subjectType, sourceSessionType)
      })
      changedMemoryIds.push(id)
    }

    if (writebackId != null) {
      db.commitChannelMemoryWriteback(writebackId)
    }
  }

  return { changedMemoryIds }
}
