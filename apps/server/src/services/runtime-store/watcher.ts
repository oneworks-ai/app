/* eslint-disable max-lines -- watcher coordinates runtime replay, polling and file watch lifecycle */
import type { ChildProcess } from 'node:child_process'
import { existsSync, watch } from 'node:fs'
import type { FSWatcher } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import type { WSEvent } from '@oneworks/core'
import type { RuntimeCommand } from '@oneworks/runtime-protocol'

import type { SqliteDb } from '#~/db/index.js'
import { getDb } from '#~/db/index.js'
import { loadAgentRoomExperimentEnabled } from '#~/services/config/index.js'
import { logger } from '#~/utils/logger.js'

import {
  discoverRuntimeSessionStores,
  migrateRuntimeRoots,
  readRuntimeSessionMetadata,
  readRuntimeSessionState,
  resolveRuntimeRoots
} from './discovery.js'
import {
  readLatestRuntimeConsumerQueuedCommand,
  readRuntimeConsumerHeartbeat,
  shouldStartServerRuntimeConsumer,
  startServerRuntimeConsumer
} from './engine-consumer.js'
import { readRuntimeCommandsJsonl, replayRuntimeEventsJsonl } from './jsonl.js'
import { projectRuntimeMetadata, readStartCommandSummary, shouldProjectRuntimeMetadata } from './metadata-projection.js'
import { projectRuntimeEvent } from './projection.js'
import type { RuntimeProjectionResult } from './projection.js'
import { projectRuntimeCommand } from './session-command-projection.js'
import { runtimeStatusToSessionStatus } from './session-projection.js'
import type { RuntimeEventCheckpoint, RuntimeSessionStore } from './types.js'
import { createWorkspaceRuntimeEnv } from './workspace-env.js'

export interface RuntimeStoreWatcherOptions {
  roots?: string[]
  cwd?: string
  db?: SqliteDb
  pollIntervalMs?: number
  broadcast?: boolean
  agentRoomProjectionEnabled?: boolean
  deliverSessionEvent?: RuntimeStoreSessionEventDelivery
}

export interface RuntimeStoreReplayOptions {
  db: SqliteDb
  checkpoint?: RuntimeEventCheckpoint
  broadcast?: boolean
  agentRoomProjectionEnabled?: boolean
  deliverSessionEvent?: RuntimeStoreSessionEventDelivery
}

export interface RuntimeStoreReplayResult {
  checkpoint: RuntimeEventCheckpoint
  projectedCount: number
}

export interface RuntimeConsumerStartRegistry {
  consumers: Map<string, ChildProcess>
  starting: Set<string>
}

export type RuntimeStoreSessionEventDelivery = (
  sessionId: string,
  event: WSEvent
) => Promise<boolean> | boolean

const deliverProjectedSessionEvents = async (
  projection: RuntimeProjectionResult,
  deliverSessionEvent?: RuntimeStoreSessionEventDelivery
) => {
  if (deliverSessionEvent == null || projection.sessionEvents.length === 0) {
    return
  }

  for (const { sessionId, event } of projection.sessionEvents) {
    try {
      await deliverSessionEvent(sessionId, event)
    } catch (error) {
      logger.warn({
        sessionId,
        eventType: event.type,
        error: error instanceof Error ? error.message : String(error)
      }, '[runtime-store] Failed to deliver projected session event to channel')
    }
  }
}

const isTerminalRuntimeStatus = (status: string | undefined) =>
  status === 'completed' ||
  status === 'failed' ||
  status === 'crashed' ||
  status === 'stopped' ||
  status === 'cancelled' ||
  status === 'killed'

const isSessionActivationCommand = (command: RuntimeCommand) =>
  command.type === 'start' || command.type === 'resume' || command.type === 'send_message'

const hasActivationCommandAfterRuntimeState = (
  commands: RuntimeCommand[],
  stateUpdatedAt: number | undefined
) => (
  typeof stateUpdatedAt === 'number' &&
  commands.some(command =>
    isSessionActivationCommand(command) &&
    typeof command.ts === 'number' &&
    command.ts > stateUpdatedAt
  )
)

export async function replayRuntimeStore(
  store: RuntimeSessionStore,
  options: RuntimeStoreReplayOptions
): Promise<RuntimeStoreReplayResult> {
  const metadata = await readRuntimeSessionMetadata(store)
  const assignmentSummary = metadata == null ? undefined : await readStartCommandSummary(store.commandsPath)
  if (metadata != null && shouldProjectRuntimeMetadata(metadata, options, assignmentSummary)) {
    projectRuntimeMetadata(metadata, options, assignmentSummary)
  }

  const commands = await readRuntimeCommandsJsonl(store.commandsPath)
  for (const command of commands) {
    projectRuntimeCommand(options.db, command, options.broadcast ?? false)
  }

  const result = await replayRuntimeEventsJsonl(store.eventsPath, options.checkpoint)
  for (const event of result.events) {
    const projection = projectRuntimeEvent(event, {
      db: options.db,
      broadcast: options.broadcast,
      metadata,
      agentRoomProjectionEnabled: options.agentRoomProjectionEnabled
    })
    await deliverProjectedSessionEvents(projection, options.deliverSessionEvent)
  }

  const state = await readRuntimeSessionState(store)
  const session = options.db.getSession(store.sessionId)
  const projectedStateStatus = runtimeStatusToSessionStatus(state?.status)
  if (
    state != null &&
    isTerminalRuntimeStatus(state.status) &&
    projectedStateStatus != null &&
    !hasActivationCommandAfterRuntimeState(commands, state.updatedAt) &&
    session?.status !== projectedStateStatus
  ) {
    const projection = projectRuntimeEvent({
      id: `runtime-state:${store.sessionId}:${state.lastSeq ?? 0}:${state.status}`,
      seq: state.lastSeq,
      sessionId: store.sessionId,
      type: 'status_changed',
      status: state.status,
      ts: state.updatedAt,
      visibility: 'room',
      ...(state.title != null ? { title: state.title } : {}),
      ...(state.lastMessage != null ? { summary: state.lastMessage } : {})
    }, {
      db: options.db,
      broadcast: options.broadcast,
      metadata,
      agentRoomProjectionEnabled: options.agentRoomProjectionEnabled
    })
    await deliverProjectedSessionEvents(projection, options.deliverSessionEvent)
  }

  return {
    checkpoint: result.checkpoint,
    projectedCount: result.events.length
  }
}

export async function ensureServerRuntimeConsumerOnce(
  store: RuntimeSessionStore,
  registry: RuntimeConsumerStartRegistry,
  startConsumer = startServerRuntimeConsumer
) {
  const activeConsumer = registry.consumers.get(store.storePath)
  if (activeConsumer != null && activeConsumer.exitCode == null && activeConsumer.signalCode == null) {
    return
  }
  if (registry.starting.has(store.storePath)) {
    return
  }

  registry.starting.add(store.storePath)
  try {
    const [metadata, state, heartbeat, queuedCommand] = await Promise.all([
      readRuntimeSessionMetadata(store),
      readRuntimeSessionState(store),
      readRuntimeConsumerHeartbeat(store),
      readLatestRuntimeConsumerQueuedCommand(store.commandsPath)
    ])
    if (metadata == null || !shouldStartServerRuntimeConsumer({ heartbeat, metadata, queuedCommand, state })) {
      return
    }

    const child = await startConsumer({
      metadata,
      store
    })
    if (child == null) {
      return
    }

    registry.consumers.set(store.storePath, child)
    const cleanup = () => {
      if (registry.consumers.get(store.storePath) === child) {
        registry.consumers.delete(store.storePath)
      }
    }
    child.once('exit', cleanup)
    child.once('error', cleanup)
    child.unref()
  } finally {
    registry.starting.delete(store.storePath)
  }
}

export class RuntimeStoreWatcher {
  private readonly roots: Set<string>
  private readonly db: SqliteDb
  private readonly pollIntervalMs: number
  private readonly broadcast: boolean
  private readonly configuredAgentRoomProjectionEnabled: boolean | undefined
  private readonly deliverSessionEvent: RuntimeStoreSessionEventDelivery | undefined
  private readonly checkpoints = new Map<string, RuntimeEventCheckpoint>()
  private readonly engineConsumers = new Map<string, ChildProcess>()
  private readonly runtimeMigrationCwds = new Map<string, NodeJS.ProcessEnv>()
  private readonly startingEngineConsumers = new Set<string>()
  private readonly watchers: FSWatcher[] = []
  private readonly watchedRoots = new Set<string>()
  private replayQueue: Promise<void> = Promise.resolve()
  private pollTimer: ReturnType<typeof setInterval> | undefined
  private stopped = true

  constructor(options: RuntimeStoreWatcherOptions = {}) {
    this.db = options.db ?? getDb()
    this.roots = new Set((options.roots ?? this.resolveInitialRoots(options.cwd)).map(root => path.resolve(root)))
    this.pollIntervalMs = options.pollIntervalMs ?? 2000
    this.broadcast = options.broadcast ?? true
    this.configuredAgentRoomProjectionEnabled = options.agentRoomProjectionEnabled
    this.deliverSessionEvent = options.deliverSessionEvent
  }

  private resolveInitialRoots(cwd: string | undefined) {
    const workspaceRoots = this.db.listSessionWorkspaces({ state: 'ready' })
      .flatMap((workspace) => {
        const env = createWorkspaceRuntimeEnv(workspace.workspaceFolder)
        this.runtimeMigrationCwds.set(path.resolve(workspace.workspaceFolder), env)
        return resolveRuntimeRoots({ cwd: workspace.workspaceFolder, env })
      })
    const rootCwd = cwd ?? process.cwd()
    const rootEnv = cwd == null ? process.env : createWorkspaceRuntimeEnv(rootCwd)
    this.runtimeMigrationCwds.set(path.resolve(rootCwd), rootEnv)
    return [
      ...resolveRuntimeRoots({ cwd, env: rootEnv }),
      ...workspaceRoots
    ]
  }

  async start() {
    if (!this.stopped) {
      return
    }
    this.stopped = false
    await this.migrateLegacyRuntimeRoots()
    await this.scanAndReplay()
    this.startFsWatchers()
    this.pollTimer = setInterval(() => {
      void this.scanAndReplay().catch(error => {
        logger.warn({ error }, '[runtime-store] Poll replay failed')
      })
    }, this.pollIntervalMs)
  }

  stop() {
    this.stopped = true
    for (const watcher of this.watchers.splice(0)) {
      watcher.close()
    }
    this.watchedRoots.clear()
    if (this.pollTimer != null) {
      clearInterval(this.pollTimer)
      this.pollTimer = undefined
    }
  }

  async addRoot(root: string) {
    const normalizedRoot = path.resolve(root)
    this.roots.add(normalizedRoot)
    if (!this.stopped) {
      this.startFsWatcher(normalizedRoot)
    }
    await this.scanAndReplay()
  }

  async scanAndReplay() {
    const replay = this.replayQueue.then(() => this.scanAndReplayNow())
    this.replayQueue = replay.catch(() => undefined)
    await replay
  }

  private async scanAndReplayNow() {
    await this.migrateLegacyRuntimeRoots()
    const stores = await discoverRuntimeSessionStores([...this.roots])
    for (const store of stores) {
      await this.replayStore(store)
    }
  }

  private async migrateLegacyRuntimeRoots() {
    for (const [cwd, env] of this.runtimeMigrationCwds) {
      await migrateRuntimeRoots({ cwd, env })
    }
  }

  private async replayStore(store: RuntimeSessionStore) {
    const previous = this.checkpoints.get(store.storePath)
    const agentRoomProjectionEnabled = this.configuredAgentRoomProjectionEnabled ??
      await loadAgentRoomExperimentEnabled().catch(() => false)
    const result = await replayRuntimeStore(store, {
      db: this.db,
      checkpoint: previous,
      broadcast: this.broadcast,
      agentRoomProjectionEnabled,
      deliverSessionEvent: this.deliverSessionEvent
    })
    this.checkpoints.set(store.storePath, result.checkpoint)
    await this.ensureServerRuntimeConsumer(store)
  }

  private async ensureServerRuntimeConsumer(store: RuntimeSessionStore) {
    await ensureServerRuntimeConsumerOnce(store, {
      consumers: this.engineConsumers,
      starting: this.startingEngineConsumers
    })
  }

  private startFsWatchers() {
    for (const root of this.roots) {
      this.startFsWatcher(root)
    }
  }

  private startFsWatcher(root: string) {
    if (this.watchedRoots.has(root) || !existsSync(root)) {
      return
    }

    this.watchedRoots.add(root)
    try {
      const watcher = watch(root, { recursive: true }, (_event, filename) => {
        if (filename == null) {
          return
        }
        const changedPath = String(filename)
        const basename = path.basename(changedPath)
        if (
          changedPath.endsWith('events.jsonl') ||
          changedPath.endsWith('commands.jsonl') ||
          basename === 'index.json' ||
          basename === 'meta.json'
        ) {
          void this.scanAndReplay().catch(error => {
            logger.warn({ root, error }, '[runtime-store] Watch replay failed')
          })
        }
      })
      this.watchers.push(watcher)
    } catch (error) {
      logger.warn({ root, error }, '[runtime-store] File watch unavailable; polling fallback remains active')
    }
  }
}

let runtimeStoreWatcher: RuntimeStoreWatcher | undefined

export function getRuntimeStoreWatcher() {
  return runtimeStoreWatcher
}

export async function watchRuntimeStoreRoot(root: string) {
  if (runtimeStoreWatcher == null) {
    return
  }
  await runtimeStoreWatcher.addRoot(root)
}

export function startRuntimeStoreWatcher(options: RuntimeStoreWatcherOptions = {}) {
  runtimeStoreWatcher = new RuntimeStoreWatcher(options)
  void runtimeStoreWatcher.start().catch(error => {
    logger.warn({ error }, '[runtime-store] Failed to start watcher')
  })
  return runtimeStoreWatcher
}
