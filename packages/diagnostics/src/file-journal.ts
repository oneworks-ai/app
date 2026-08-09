import { createHash, randomUUID } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

import { DIAGNOSTIC_SCHEMA_VERSION } from './types.js'
import type { DiagnosticEvent, DiagnosticExporter } from './types.js'

const DEFAULT_MAX_JOURNAL_BYTES = 5 * 1024 * 1024
const INTERRUPTED_OPERATION_CODE = 'process.terminated_before_completion'

const isDiagnosticEvent = (value: unknown): value is DiagnosticEvent => {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false
  const event = value as Partial<DiagnosticEvent>
  return event.schemaVersion === DIAGNOSTIC_SCHEMA_VERSION &&
    typeof event.eventId === 'string' &&
    typeof event.timestamp === 'string' &&
    event.operation != null &&
    typeof event.operation.id === 'string' &&
    typeof event.operation.name === 'string' &&
    typeof event.operation.startedAt === 'string'
}

const operationFileName = (operationId: string) => `${createHash('sha256').update(operationId).digest('hex')}.json`

const safeUnlink = (path: string) => {
  try {
    unlinkSync(path)
  } catch {
    // Ignore missing or already-removed diagnostic files.
  }
}

export interface FileDiagnosticJournalOptions {
  directory: string
  maxBytes?: number
}

export interface RecoverInterruptedOperationsOptions {
  createId?: () => string
  now?: () => Date
}

export class FileDiagnosticJournal implements DiagnosticExporter {
  private readonly activeDirectory: string
  private readonly eventsPath: string
  private readonly maxBytes: number

  constructor(options: FileDiagnosticJournalOptions) {
    this.activeDirectory = join(options.directory, 'active')
    this.eventsPath = join(options.directory, 'events.jsonl')
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_JOURNAL_BYTES
    mkdirSync(this.activeDirectory, { recursive: true })
  }

  export(event: DiagnosticEvent) {
    this.rotateIfNeeded()
    appendFileSync(this.eventsPath, `${JSON.stringify(event)}\n`, { encoding: 'utf8' })

    const activePath = join(this.activeDirectory, operationFileName(event.operation.id))
    if (event.kind === 'operation.completed') {
      safeUnlink(activePath)
      return
    }

    const temporaryPath = `${activePath}.${process.pid}.${randomUUID()}.tmp`
    writeFileSync(temporaryPath, JSON.stringify(event), { encoding: 'utf8' })
    renameSync(temporaryPath, activePath)
  }

  readEvents(): DiagnosticEvent[] {
    const paths = [
      `${this.eventsPath}.1`,
      this.eventsPath
    ]
    const events: DiagnosticEvent[] = []

    for (const path of paths) {
      if (!existsSync(path)) continue
      for (const line of readFileSync(path, 'utf8').split(/\r?\n/u)) {
        if (line.trim() === '') continue
        try {
          const event = JSON.parse(line) as unknown
          if (isDiagnosticEvent(event)) events.push(event)
        } catch {
          // Ignore partial lines left by a terminated process.
        }
      }
    }
    return events
  }

  recoverInterruptedOperations(
    options: RecoverInterruptedOperationsOptions = {}
  ): DiagnosticEvent[] {
    const now = options.now ?? (() => new Date())
    const createId = options.createId ?? randomUUID
    const recovered: DiagnosticEvent[] = []

    for (const entry of readdirSync(this.activeDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const activePath = join(this.activeDirectory, entry.name)

      try {
        const source = JSON.parse(readFileSync(activePath, 'utf8')) as unknown
        if (!isDiagnosticEvent(source) || source.kind === 'operation.completed') {
          safeUnlink(activePath)
          continue
        }

        const timestamp = now().toISOString()
        const durationMs = Date.parse(timestamp) - Date.parse(source.operation.startedAt)
        const event: DiagnosticEvent = {
          ...source,
          eventId: createId(),
          kind: 'operation.completed',
          operation: {
            ...source.operation,
            completedAt: timestamp,
            durationMs: Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0,
            failure: {
              code: INTERRUPTED_OPERATION_CODE,
              domain: 'process',
              retryable: true
            },
            outcome: 'abandoned'
          },
          timestamp
        }
        this.export(event)
        recovered.push(event)
      } catch {
        safeUnlink(activePath)
      }
    }

    return recovered
  }

  private rotateIfNeeded() {
    if (!existsSync(this.eventsPath)) return
    if (statSync(this.eventsPath).size < this.maxBytes) return

    const rotatedPath = `${this.eventsPath}.1`
    safeUnlink(rotatedPath)
    renameSync(this.eventsPath, rotatedPath)
  }
}
