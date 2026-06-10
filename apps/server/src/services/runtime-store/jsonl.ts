import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'

import type { RuntimeCommand } from '@oneworks/runtime-protocol'

import type { RuntimeEvent, RuntimeEventCheckpoint, RuntimeEventReplayResult } from './types.js'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const asString = (value: unknown) => typeof value === 'string' && value.trim() !== '' ? value : undefined

const asNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined

export const normalizeRuntimeEvent = (value: unknown): RuntimeEvent | undefined => {
  if (!isRecord(value)) {
    return undefined
  }

  const id = asString(value.id)
  const sessionId = asString(value.sessionId)
  const type = asString(value.type)
  if (id == null || sessionId == null || type == null) {
    return undefined
  }

  return {
    ...value,
    id,
    sessionId,
    type,
    ...(asNumber(value.seq) != null ? { seq: asNumber(value.seq) } : {}),
    ...(asNumber(value.ts) != null ? { ts: asNumber(value.ts) } : {})
  } as RuntimeEvent
}

export const normalizeRuntimeCommand = (value: unknown): RuntimeCommand | undefined => {
  if (!isRecord(value)) {
    return undefined
  }

  const id = asString(value.id)
  const sessionId = asString(value.sessionId)
  const type = asString(value.type)
  const source = asString(value.source)
  if (id == null || sessionId == null || type == null || source == null) {
    return undefined
  }

  return {
    ...value,
    id,
    sessionId,
    type,
    source,
    ts: asNumber(value.ts) ?? Date.now(),
    priority: asNumber(value.priority) ?? 0
  } as RuntimeCommand
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

export async function replayRuntimeEventsJsonl(
  eventsPath: string,
  checkpoint: RuntimeEventCheckpoint = { offset: 0 }
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

    const event = normalizeRuntimeEvent(parsed)
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
