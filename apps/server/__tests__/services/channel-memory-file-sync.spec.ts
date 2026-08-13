import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChannelMemoryRow } from '../../src/db/channelMemories/repo'
import { syncChannelFileMemories } from '../../src/services/channel-memory/file-sync'
import { filterChannelMemoryCandidates } from '../../src/services/channel-memory/filter'

const memories = new Map<string, Record<string, unknown> & { content: string; id: string }>()
const db = {
  commitChannelMemoryWriteback: vi.fn(),
  createPendingChannelMemoryWriteback: vi.fn(() => 'writeback-1'),
  getChannelMemory: vi.fn((id: string) => memories.get(id)),
  getChannelMemoryWritebackByPatchKey: vi.fn(),
  upsertChannelMemory: vi.fn((input: Record<string, unknown> & { content: string; id: string }) => {
    memories.set(input.id, input)
    return input
  })
}

vi.mock('../../src/db/index.js', () => ({ getDb: () => db }))

const tempDirs: string[] = []
const segment = (value: string) => Buffer.from(value, 'utf8').toString('base64url')

const writeMemory = async (
  root: string,
  parts: string[],
  content: string,
  sessionType = 'group'
) => {
  const dir = path.resolve(root, ...parts)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.resolve(dir, 'README.md'), `${content}\n`)
  await fs.writeFile(
    path.resolve(dir, '.oneworks-mem.json'),
    JSON.stringify({
      channelSessionType: sessionType
    })
  )
}

const scope = (memoryRoot: string) => ({
  accountId: 'account-1',
  canonicalUserId: 'user-1',
  channelId: 'chat-1',
  channelKey: 'main',
  channelType: 'lark',
  conversationStateId: 'conversation-1',
  entity: 'bot',
  issuer: 'main',
  memoryRoot,
  orgId: 'workspace-local',
  roomId: 'room-1',
  senderId: 'account-1',
  sessionType: 'group',
  threadKey: 'thread-1'
})

describe('channel file memory sync', () => {
  beforeEach(() => {
    memories.clear()
    vi.clearAllMocks()
    db.createPendingChannelMemoryWriteback.mockReturnValue('writeback-1')
    db.getChannelMemoryWritebackByPatchKey.mockReturnValue(undefined)
  })

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { force: true, recursive: true })))
  })

  it('imports entity and canonical-user files, then audits only terminal changes', async () => {
    const memoryRoot = await fs.mkdtemp(path.join(tmpdir(), 'oneworks-channel-memory-'))
    tempDirs.push(memoryRoot)
    await writeMemory(memoryRoot, ['entities', segment('bot'), 'organization'], 'shared entity memory')
    await writeMemory(
      memoryRoot,
      ['users', segment('lark:main'), segment('account-1'), segment('group')],
      'group user memory'
    )

    const initial = syncChannelFileMemories(scope(memoryRoot))

    expect(initial.changedMemoryIds).toHaveLength(2)
    expect(db.upsertChannelMemory).toHaveBeenCalledWith(expect.objectContaining({
      content: 'shared entity memory',
      subjectId: 'bot',
      subjectType: 'entity',
      visibility: {
        conversationTypes: ['direct', 'group'],
        entities: ['bot'],
        orgs: ['workspace-local']
      }
    }))
    expect(db.upsertChannelMemory).toHaveBeenCalledWith(expect.objectContaining({
      canonicalUserId: 'user-1',
      content: 'group user memory',
      source: expect.objectContaining({ sessionType: 'group' }),
      subjectType: 'canonical_user'
    }))
    expect(syncChannelFileMemories(scope(memoryRoot)).changedMemoryIds).toEqual([])

    await writeMemory(memoryRoot, ['entities', segment('bot'), 'organization'], 'updated entity memory')
    const terminal = syncChannelFileMemories({ ...scope(memoryRoot), childRunId: 'run-1' })

    expect(terminal.changedMemoryIds).toHaveLength(1)
    expect(db.createPendingChannelMemoryWriteback).toHaveBeenCalledWith(expect.objectContaining({
      childRunId: 'run-1',
      patch: expect.objectContaining({ kind: 'file_memory_sync', subjectType: 'entity' })
    }))
    expect(db.commitChannelMemoryWriteback).toHaveBeenCalledWith('writeback-1')
  })

  it('reattributes the same platform user file after canonical identity binding', async () => {
    const memoryRoot = await fs.mkdtemp(path.join(tmpdir(), 'oneworks-channel-memory-'))
    tempDirs.push(memoryRoot)
    await writeMemory(
      memoryRoot,
      ['users', segment('lark:main'), segment('account-1'), segment('group')],
      'user preference'
    )

    const { canonicalUserId: _canonicalUserId, ...unbound } = scope(memoryRoot)
    syncChannelFileMemories(unbound)
    const accountWrite = db.upsertChannelMemory.mock.calls.at(-1)?.[0]

    syncChannelFileMemories(scope(memoryRoot))
    const canonicalWrite = db.upsertChannelMemory.mock.calls.at(-1)?.[0]

    expect(accountWrite).toEqual(expect.objectContaining({ subjectType: 'account' }))
    expect(canonicalWrite).toEqual(expect.objectContaining({
      canonicalUserId: 'user-1',
      id: accountWrite?.id,
      subjectType: 'canonical_user'
    }))
  })

  it('keeps direct user memory isolated from group reads and writes', async () => {
    const memoryRoot = await fs.mkdtemp(path.join(tmpdir(), 'oneworks-channel-memory-'))
    tempDirs.push(memoryRoot)
    await writeMemory(
      memoryRoot,
      ['users', segment('lark:main'), segment('account-1'), segment('direct')],
      'private preference',
      'direct'
    )

    const direct = syncChannelFileMemories({ ...scope(memoryRoot), sessionType: 'direct' })
    expect(direct.changedMemoryIds).toHaveLength(1)
    const directMemory = memories.get(direct.changedMemoryIds[0]!)
    expect(directMemory).toEqual(expect.objectContaining({
      content: 'private preference',
      visibility: expect.objectContaining({ conversationTypes: ['direct'] })
    }))

    expect(syncChannelFileMemories(scope(memoryRoot)).changedMemoryIds).toEqual([])
    expect([...memories.values()]).toHaveLength(1)

    await writeMemory(
      memoryRoot,
      ['users', segment('lark:main'), segment('account-1'), segment('group')],
      'shared group preference',
      'group'
    )
    const group = syncChannelFileMemories(scope(memoryRoot))
    expect(group.changedMemoryIds).toHaveLength(1)
    expect(group.changedMemoryIds[0]).not.toBe(direct.changedMemoryIds[0])
  })

  it('never reclassifies direct entity content during later group sync and selection', async () => {
    const memoryRoot = await fs.mkdtemp(path.join(tmpdir(), 'oneworks-channel-memory-'))
    tempDirs.push(memoryRoot)
    await writeMemory(
      memoryRoot,
      ['entities', segment('bot'), 'direct'],
      'private entity context',
      'group'
    )

    const direct = syncChannelFileMemories({ ...scope(memoryRoot), sessionType: 'direct' })
    expect(direct.changedMemoryIds).toHaveLength(1)
    const directMemory = memories.get(direct.changedMemoryIds[0]!)
    expect(directMemory).toEqual(expect.objectContaining({
      content: 'private entity context',
      source: expect.objectContaining({ sessionType: 'direct' }),
      visibility: expect.objectContaining({ conversationTypes: ['direct'] })
    }))

    expect(syncChannelFileMemories(scope(memoryRoot)).changedMemoryIds).toEqual([])
    await writeMemory(
      memoryRoot,
      ['entities', segment('bot'), 'organization'],
      'organization entity context',
      'direct'
    )
    const group = syncChannelFileMemories(scope(memoryRoot))

    expect(group.changedMemoryIds).toHaveLength(1)
    expect(group.changedMemoryIds[0]).not.toBe(direct.changedMemoryIds[0])
    expect(memories.get(direct.changedMemoryIds[0]!)?.content).toBe('private entity context')
    expect(memories.get(group.changedMemoryIds[0]!)).toEqual(expect.objectContaining({
      content: 'organization entity context',
      source: expect.objectContaining({ sessionType: 'group' }),
      visibility: expect.objectContaining({ conversationTypes: ['direct', 'group'] })
    }))

    const selectedForGroup = filterChannelMemoryCandidates(
      [...memories.values()] as unknown as ChannelMemoryRow[],
      scope(memoryRoot),
      Date.now()
    )
    expect(selectedForGroup.filtered.map(memory => memory.content)).toEqual(['organization entity context'])
  })

  it('never reclassifies direct Room content during later group sync and selection', async () => {
    const memoryRoot = await fs.mkdtemp(path.join(tmpdir(), 'oneworks-channel-memory-'))
    tempDirs.push(memoryRoot)
    await writeMemory(
      memoryRoot,
      ['rooms', segment('room-1'), 'direct'],
      'private Room context',
      'group'
    )

    const direct = syncChannelFileMemories({ ...scope(memoryRoot), sessionType: 'direct' })
    expect(direct.changedMemoryIds).toHaveLength(1)
    expect(syncChannelFileMemories(scope(memoryRoot)).changedMemoryIds).toEqual([])

    await writeMemory(
      memoryRoot,
      ['rooms', segment('room-1'), 'organization'],
      'organization Room context',
      'direct'
    )
    const group = syncChannelFileMemories(scope(memoryRoot))
    const selectedForGroup = filterChannelMemoryCandidates(
      [...memories.values()] as unknown as ChannelMemoryRow[],
      scope(memoryRoot),
      Date.now()
    )

    expect(group.changedMemoryIds).toHaveLength(1)
    expect(group.changedMemoryIds[0]).not.toBe(direct.changedMemoryIds[0])
    expect(selectedForGroup.filtered.map(memory => memory.content)).toEqual(['organization Room context'])
  })

  it('isolates same-platform file memory by channel issuer key', async () => {
    const memoryRoot = await fs.mkdtemp(path.join(tmpdir(), 'oneworks-channel-memory-'))
    tempDirs.push(memoryRoot)
    await writeMemory(
      memoryRoot,
      ['channels', segment('lark:main'), segment('chat-1')],
      'main app memory'
    )
    await writeMemory(
      memoryRoot,
      ['channels', segment('lark:other'), segment('chat-1')],
      'other app memory'
    )

    const main = syncChannelFileMemories(scope(memoryRoot))
    const other = syncChannelFileMemories({ ...scope(memoryRoot), channelKey: 'other', issuer: 'other' })

    expect(main.changedMemoryIds).toHaveLength(1)
    expect(other.changedMemoryIds).toHaveLength(1)
    expect(other.changedMemoryIds[0]).not.toBe(main.changedMemoryIds[0])
    expect([...memories.values()].map(memory => memory.content)).toEqual(expect.arrayContaining([
      'main app memory',
      'other app memory'
    ]))
  })

  it('imports Room memory with a Room-only visibility boundary', async () => {
    const memoryRoot = await fs.mkdtemp(path.join(tmpdir(), 'oneworks-channel-memory-'))
    tempDirs.push(memoryRoot)
    await writeMemory(memoryRoot, ['rooms', segment('room-1'), 'organization'], 'room planning context')

    const result = syncChannelFileMemories(scope(memoryRoot))

    expect(result.changedMemoryIds).toHaveLength(1)
    expect(db.upsertChannelMemory).toHaveBeenCalledWith(expect.objectContaining({
      content: 'room planning context',
      roomId: 'room-1',
      subjectId: 'room-1',
      subjectType: 'room',
      visibility: {
        conversationTypes: ['direct', 'group'],
        entities: ['bot'],
        orgs: ['workspace-local'],
        rooms: ['room-1']
      }
    }))
  })

  it('only imports file scopes allowed by the entity memory policy', async () => {
    const memoryRoot = await fs.mkdtemp(path.join(tmpdir(), 'oneworks-channel-memory-'))
    tempDirs.push(memoryRoot)
    await writeMemory(memoryRoot, ['entities', segment('bot'), 'organization'], 'entity memory')
    await writeMemory(memoryRoot, ['rooms', segment('room-1'), 'organization'], 'room memory')
    await writeMemory(
      memoryRoot,
      ['users', segment('lark:main'), segment('account-1'), segment('group')],
      'user memory'
    )

    const result = syncChannelFileMemories({
      ...scope(memoryRoot),
      memoryPolicy: { writableScopes: ['entity'] }
    })

    expect(result.changedMemoryIds).toHaveLength(1)
    expect([...memories.values()]).toEqual([
      expect.objectContaining({ content: 'entity memory', subjectType: 'entity' })
    ])
  })

  it('commits an existing pending file-sync audit after a terminal retry', async () => {
    const memoryRoot = await fs.mkdtemp(path.join(tmpdir(), 'oneworks-channel-memory-'))
    tempDirs.push(memoryRoot)
    await writeMemory(memoryRoot, ['entities', segment('bot'), 'organization'], 'terminal memory')
    db.commitChannelMemoryWriteback.mockImplementationOnce(() => {
      throw new Error('commit failed')
    })

    expect(() => syncChannelFileMemories({ ...scope(memoryRoot), childRunId: 'run-retry' }))
      .toThrow('commit failed')
    db.getChannelMemoryWritebackByPatchKey.mockReturnValue({ id: 'writeback-1', status: 'pending' })

    expect(syncChannelFileMemories({ ...scope(memoryRoot), childRunId: 'run-retry' }).changedMemoryIds).toEqual([])
    expect(db.commitChannelMemoryWriteback).toHaveBeenLastCalledWith('writeback-1')
  })
})
