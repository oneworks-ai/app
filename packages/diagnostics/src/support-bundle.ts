import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { FileDiagnosticJournal } from './file-journal.js'
import type { DiagnosticEvent, DiagnosticOperationOutcome } from './types.js'

export interface DiagnosticSupportBundleSource {
  directory: string
  label: string
}

export interface WriteDiagnosticSupportBundleOptions {
  architecture?: string
  destinationPath: string
  generatedAt?: Date
  platform?: string
  productName: string
  productVersion?: string
  sources: DiagnosticSupportBundleSource[]
}

const hashIdentifier = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 16)

const safeLabel = (value: string) => {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/gu, '-')
  return normalized === '' ? 'diagnostics' : normalized.slice(0, 64)
}

const summarize = (events: DiagnosticEvent[]) => {
  const failures: Record<string, number> = {}
  const outcomes: Partial<Record<DiagnosticOperationOutcome, number>> = {}
  const stages: Record<string, number> = {}

  for (const event of events) {
    const failureCode = event.operation.failure?.code
    if (failureCode != null) failures[failureCode] = (failures[failureCode] ?? 0) + 1
    const outcome = event.operation.outcome
    if (outcome != null) outcomes[outcome] = (outcomes[outcome] ?? 0) + 1
    const stage = event.operation.stage
    if (stage != null) stages[stage] = (stages[stage] ?? 0) + 1
  }

  return {
    eventCount: events.length,
    failures,
    outcomes,
    stages
  }
}

const safeEvent = (event: DiagnosticEvent, source: string) => ({
  context: Object.fromEntries(
    Object.entries(event.context)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([key, value]) => [key, hashIdentifier(value)])
  ),
  dataClass: event.dataClass,
  eventId: hashIdentifier(event.eventId),
  kind: event.kind,
  operation: {
    ...event.operation,
    id: hashIdentifier(event.operation.id)
  },
  resource: event.resource,
  schemaVersion: event.schemaVersion,
  source,
  timestamp: event.timestamp
})

export const writeDiagnosticSupportBundle = async (
  options: WriteDiagnosticSupportBundleOptions
) => {
  const eventSources = options.sources.flatMap(source => {
    const label = safeLabel(source.label)
    return new FileDiagnosticJournal({ directory: source.directory })
      .readEvents()
      .map(event => ({ event, label }))
  })
  const uniqueEvents = new Map<string, { event: DiagnosticEvent; label: string }>()
  for (const item of eventSources) uniqueEvents.set(item.event.eventId, item)
  const sorted = [...uniqueEvents.values()].sort((left, right) => (
    left.event.timestamp.localeCompare(right.event.timestamp)
  ))
  const events = sorted.map(item => safeEvent(item.event, item.label))
  const generatedAt = (options.generatedAt ?? new Date()).toISOString()
  const bundle = {
    bundleVersion: 1,
    events,
    generatedAt,
    privacy: {
      contextIdentifiers: 'sha256-truncated',
      excludes: [
        'configuration',
        'credentials',
        'paths',
        'prompts',
        'raw-errors',
        'stacks',
        'tool-inputs',
        'tool-outputs'
      ],
      rawLogsIncluded: false
    },
    product: {
      architecture: options.architecture,
      name: options.productName,
      platform: options.platform,
      version: options.productVersion
    },
    summary: summarize(sorted.map(item => item.event))
  }
  await mkdir(dirname(options.destinationPath), { recursive: true })
  await writeFile(options.destinationPath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8')
  return bundle
}
