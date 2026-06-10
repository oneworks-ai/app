/* eslint-disable max-lines -- file runtime store keeps session and index operations in one backend */
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { appendJsonlLine, readJsonFile, readJsonlFile, tailJsonlFile, writeJsonFileAtomic } from './json'
import { acquireLockFile, createOwnerMetadata, isRuntimeOwnerStale } from './lock'
import type {
  RuntimeCommand,
  RuntimeEvent,
  RuntimeEventDraft,
  RuntimeHeartbeat,
  RuntimeIndex,
  RuntimeIndexSession,
  RuntimeLockName,
  RuntimeMeta,
  RuntimeOwnerMetadata,
  RuntimeState
} from './types'
import { DEFAULT_RUNTIME_PROTOCOL_VERSION, DEFAULT_SUPPORTED_PROTOCOL_RANGE } from './types'

export class FileRuntimeSessionStore {
  readonly locksPath: string

  constructor(readonly sessionPath: string, readonly sessionId: string) {
    this.locksPath = join(sessionPath, 'locks')
  }

  async ensure() {
    await mkdir(this.locksPath, { recursive: true })
  }

  getLockPath(lockName: RuntimeLockName) {
    return join(this.locksPath, `${lockName}.lock`)
  }

  async writeMeta(meta: RuntimeMeta) {
    await writeJsonFileAtomic(join(this.sessionPath, 'meta.json'), meta)
  }

  async readMeta() {
    return readJsonFile<RuntimeMeta>(join(this.sessionPath, 'meta.json'))
  }

  async writeState(state: RuntimeState) {
    const lock = await acquireLockFile(this.getLockPath('state.write'), { kind: 'state.write' })
    try {
      await writeJsonFileAtomic(join(this.sessionPath, 'state.json'), state)
    } finally {
      await lock.release()
    }
  }

  async readState() {
    return readJsonFile<RuntimeState>(join(this.sessionPath, 'state.json'))
  }

  async writeHeartbeat(heartbeat: RuntimeHeartbeat) {
    await writeJsonFileAtomic(join(this.sessionPath, 'heartbeat.json'), heartbeat)
  }

  async readHeartbeat() {
    return readJsonFile<RuntimeHeartbeat>(join(this.sessionPath, 'heartbeat.json'))
  }

  async appendCommand(command: RuntimeCommand) {
    const lock = await acquireLockFile(this.getLockPath('commands.append'), { kind: 'commands.append' })
    try {
      await appendJsonlLine(join(this.sessionPath, 'commands.jsonl'), command)
    } finally {
      await lock.release()
    }
    return command
  }

  async readCommands() {
    return readJsonlFile<RuntimeCommand>(join(this.sessionPath, 'commands.jsonl'))
  }

  async appendEvent(event: RuntimeEventDraft) {
    const lock = await acquireLockFile(this.getLockPath('events.append'), { kind: 'events.append' })
    try {
      const existing = await this.replayEvents()
      const lastSeq = existing.at(-1)?.seq ?? 0
      const seq = event.seq ?? lastSeq + 1
      const protocolVersion = typeof event.protocolVersion === 'string'
        ? event.protocolVersion
        : DEFAULT_RUNTIME_PROTOCOL_VERSION
      const supportedProtocolRange = typeof event.supportedProtocolRange === 'string'
        ? event.supportedProtocolRange
        : DEFAULT_SUPPORTED_PROTOCOL_RANGE
      const nextEvent = {
        ...event,
        protocolVersion,
        supportedProtocolRange,
        id: event.id ?? `evt_${seq}`,
        seq,
        ts: event.ts ?? Date.now()
      } satisfies RuntimeEvent
      await appendJsonlLine(join(this.sessionPath, 'events.jsonl'), nextEvent)
      return nextEvent
    } finally {
      await lock.release()
    }
  }

  async replayEvents(afterSeq = 0) {
    const events = await readJsonlFile<RuntimeEvent>(join(this.sessionPath, 'events.jsonl'))
    return events.filter(event => event.seq > afterSeq)
  }

  async tailEvents(offset = 0) {
    return tailJsonlFile<RuntimeEvent>(join(this.sessionPath, 'events.jsonl'), offset)
  }

  async acquireOwnerLock(runtimeId: string) {
    return acquireLockFile(this.getLockPath('runtime-owner'), createOwnerMetadata(runtimeId), {
      isStale: metadata =>
        isRuntimeOwnerStale(metadata as RuntimeOwnerMetadata | undefined, {
          staleMs: 30_000
        }),
      staleMs: 30_000,
      timeoutMs: 0
    })
  }

  async readOwnerLock() {
    try {
      return JSON.parse(await readFile(this.getLockPath('runtime-owner'), 'utf8')) as RuntimeOwnerMetadata
    } catch {
      return undefined
    }
  }

  async isOwnerLockStale(staleMs?: number) {
    return isRuntimeOwnerStale(await this.readOwnerLock(), { staleMs })
  }
}

export class FileRuntimeStore {
  constructor(readonly root: string) {
  }

  async ensure() {
    await mkdir(join(this.root, 'sessions'), { recursive: true })
    await mkdir(join(this.root, 'locks'), { recursive: true })
  }

  session(sessionId: string) {
    return new FileRuntimeSessionStore(join(this.root, 'sessions', sessionId), sessionId)
  }

  async createSession(meta: RuntimeMeta) {
    await this.ensure()
    const session = this.session(meta.sessionId)
    await session.ensure()
    await session.writeMeta(meta)
    await this.updateIndex(meta.sessionId, {
      storePath: relative(this.root, session.sessionPath),
      cwd: meta.cwd,
      status: 'starting',
      updatedAt: Date.now()
    })
    return session
  }

  async readIndex(): Promise<RuntimeIndex> {
    return await readJsonFile<RuntimeIndex>(join(this.root, 'index.json')) ?? {
      protocolVersion: DEFAULT_RUNTIME_PROTOCOL_VERSION,
      sessions: {}
    }
  }

  async updateIndex(sessionId: string, entry: RuntimeIndexSession) {
    await this.ensure()
    const lock = await acquireLockFile(join(this.root, 'locks', 'index.write.lock'), {
      kind: 'index.write'
    })
    try {
      const index = await this.readIndex()
      index.sessions[sessionId] = entry
      await writeJsonFileAtomic(join(this.root, 'index.json'), index)
      return index
    } finally {
      await lock.release()
    }
  }

  async deleteSession(sessionId: string) {
    await this.ensure()
    const sessionPath = this.session(sessionId).sessionPath
    const lock = await acquireLockFile(join(this.root, 'locks', 'index.write.lock'), {
      kind: 'index.write'
    })
    try {
      const index = await this.readIndex()
      delete index.sessions[sessionId]
      await writeJsonFileAtomic(join(this.root, 'index.json'), index)
    } finally {
      await lock.release()
    }
    await rm(sessionPath, { recursive: true, force: true })
  }
}

export const createFileRuntimeStore = async (root: string) => {
  const store = new FileRuntimeStore(root)
  await store.ensure()
  return store
}
