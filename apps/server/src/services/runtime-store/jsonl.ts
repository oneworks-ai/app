import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'

import {
  RuntimeCommandSchema,
  RuntimeEventSchema
} from '@oneworks/runtime-protocol'
import type { RuntimeCommand } from '@oneworks/runtime-protocol'

import type { RuntimeEvent, RuntimeEventCheckpoint, RuntimeEventReplayResult } from './types.js'
import {
  createPublicProjectionContext,
  normalizePublicRuntimeEvent,
  sanitizePublicRuntimeAuditEvent
} from './public-runtime-event.js'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const asString = (value: unknown) => typeof value === 'string' && value.trim() !== '' ? value : undefined

export const sanitizeRuntimeAuditEvent = (event: RuntimeEvent) =>
  sanitizePublicRuntimeAuditEvent(event, createPublicProjectionContext())
export const normalizeRuntimeEvent = (
  value: unknown,
  expectedSessionId?: string,
  expectedWorkspaceFolder?: string,
  expectedAdapter?: string
) => normalizePublicRuntimeEvent(
  value,
  expectedSessionId,
  expectedWorkspaceFolder,
  expectedAdapter,
  createPublicProjectionContext()
)

export const normalizeRuntimeCommand = (value: unknown): RuntimeCommand | undefined => {
  const parsed = RuntimeCommandSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

export async function readRuntimeCommandsJsonl(commandsPath: string): Promise<RuntimeCommand[]> {
  let content: string
  try {
    content = await readFile(commandsPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw error
  }

  const commands: RuntimeCommand[] = []
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') {
      continue
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }

    const command = normalizeRuntimeCommand(parsed)
    if (command != null) {
      commands.push(command)
    }
  }
  return commands
}

/**
 * Strict internal replay for runtime authority decisions. Unlike public
 * replay, this preserves server-only events such as recovery grants and never
 * routes them through a client projection.
 */
export async function readInternalRuntimeEventsJsonl(eventsPath: string): Promise<RuntimeEvent[]> {
  let content: string
  try {
    content = await readFile(eventsPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw error
  }

  const events: RuntimeEvent[] = []
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed) as unknown
    } catch {
      continue
    }
    const event = RuntimeEventSchema.safeParse(parsed)
    if (event.success) events.push(event.data as RuntimeEvent)
  }
  return events
}

export async function replayRuntimeEventsJsonl(
  eventsPath: string,
  checkpoint: RuntimeEventCheckpoint = { offset: 0 },
  expectedSessionId?: string,
  expectedWorkspaceFolder?: string,
  expectedAdapter?: string
): Promise<RuntimeEventReplayResult> {
  let buffer: Buffer
  try {
    buffer = await readFile(eventsPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        checkpoint,
        events: []
      }
    }
    throw error
  }

  const startOffset = checkpoint.offset <= buffer.byteLength ? checkpoint.offset : 0
  const chunk = buffer.subarray(startOffset).toString('utf8')
  const lines = chunk.split('\n')
  const completeLineCount = chunk.endsWith('\n') ? lines.length - 1 : Math.max(0, lines.length - 1)
  const events: RuntimeEvent[] = []
  let offset = startOffset
  let lastSeq = checkpoint.lastSeq

  for (let index = 0; index < completeLineCount; index += 1) {
    const line = lines[index] ?? ''
    offset += Buffer.byteLength(`${line}\n`)
    const trimmed = line.trim()
    if (trimmed === '') {
      continue
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }

    const event = normalizeRuntimeEvent(
      parsed,
      expectedSessionId,
      expectedWorkspaceFolder,
      expectedAdapter
    )
    if (event == null) {
      continue
    }
    if (event.seq != null && lastSeq != null && event.seq <= lastSeq) {
      continue
    }

    events.push(event)
    if (event.seq != null && (lastSeq == null || event.seq > lastSeq)) {
      lastSeq = event.seq
    }
  }

  return {
    checkpoint: {
      offset,
      ...(lastSeq != null ? { lastSeq } : {})
    },
    events
  }
}
