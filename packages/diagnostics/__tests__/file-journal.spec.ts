import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createDiagnosticClient } from '@oneworks/diagnostics'
import type { DiagnosticEvent } from '@oneworks/diagnostics'
import { FileDiagnosticJournal } from '@oneworks/diagnostics/node'

const tempDirs: string[] = []

const createTempDir = async () => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'oneworks-diagnostics-'))
  tempDirs.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(directory => fs.rm(directory, { force: true, recursive: true })))
})

describe('file diagnostic journal', () => {
  it('persists lifecycle events and removes completed operations from the active set', async () => {
    const directory = await createTempDir()
    const journal = new FileDiagnosticJournal({ directory })
    const client = createDiagnosticClient({
      exporters: [journal],
      resource: {
        environment: 'test',
        serviceName: 'oneworks-desktop',
        surface: 'desktop'
      }
    })

    const operation = client.startOperation('oneworks.app.startup')
    operation.stage('client.ready')

    expect(await fs.readdir(path.join(directory, 'active'))).toHaveLength(1)

    operation.succeed()

    expect(await fs.readdir(path.join(directory, 'active'))).toEqual([])
    expect(journal.readEvents().map(event => event.kind)).toEqual([
      'operation.started',
      'operation.stage',
      'operation.completed'
    ])
  })

  it('recovers unfinished operations as abandoned on the next startup', async () => {
    const directory = await createTempDir()
    const firstJournal = new FileDiagnosticJournal({ directory })
    const client = createDiagnosticClient({
      createId: () => 'event-started',
      exporters: [firstJournal],
      now: () => new Date('2026-08-09T00:00:00.000Z'),
      resource: {
        serviceName: 'oneworks-desktop',
        surface: 'desktop'
      }
    })

    client.startOperation('oneworks.app.startup', { operationId: 'startup-previous' })

    const nextJournal = new FileDiagnosticJournal({ directory })
    const recovered = nextJournal.recoverInterruptedOperations({
      createId: () => 'event-recovered',
      now: () => new Date('2026-08-09T00:00:10.000Z')
    })

    expect(recovered).toHaveLength(1)
    expect(recovered[0]).toMatchObject<Partial<DiagnosticEvent>>({
      eventId: 'event-recovered',
      kind: 'operation.completed',
      operation: {
        completedAt: '2026-08-09T00:00:10.000Z',
        durationMs: 10000,
        failure: {
          code: 'process.terminated_before_completion',
          domain: 'process',
          retryable: true
        },
        id: 'startup-previous',
        name: 'oneworks.app.startup',
        outcome: 'abandoned',
        stageSequence: 0,
        startedAt: '2026-08-09T00:00:00.000Z'
      }
    })
    expect(await fs.readdir(path.join(directory, 'active'))).toEqual([])
  })

  it('rotates the JSONL journal at a bounded size', async () => {
    const directory = await createTempDir()
    const journal = new FileDiagnosticJournal({ directory, maxBytes: 1 })
    const client = createDiagnosticClient({
      exporters: [journal],
      resource: {
        serviceName: 'oneworks-test',
        surface: 'test'
      }
    })

    const operation = client.startOperation('oneworks.test.run')
    operation.succeed()

    expect(await fs.readdir(directory)).toEqual(expect.arrayContaining(['events.jsonl', 'events.jsonl.1']))
    expect(journal.readEvents()).toHaveLength(2)
  })
})
