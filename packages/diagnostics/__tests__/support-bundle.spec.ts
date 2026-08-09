import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createDiagnosticClient } from '@oneworks/diagnostics'
import { FileDiagnosticJournal, writeDiagnosticSupportBundle } from '@oneworks/diagnostics/node'

const tempDirs: string[] = []

const createTempDir = async () => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'oneworks-support-bundle-'))
  tempDirs.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(directory => fs.rm(directory, { force: true, recursive: true })))
})

describe('diagnostic support bundle', () => {
  it('writes one pseudonymized file without raw identifiers or sensitive fields', async () => {
    const directory = await createTempDir()
    const journalDirectory = path.join(directory, 'journal')
    const destinationPath = path.join(directory, 'out', 'support.json')
    const journal = new FileDiagnosticJournal({ directory: journalDirectory })
    const client = createDiagnosticClient({
      context: {
        startupId: 'startup-private-id',
        userId: 'private-user@example.com'
      },
      exporters: [journal],
      resource: {
        environment: 'test',
        serviceName: 'oneworks-desktop',
        surface: 'desktop'
      }
    })
    const operation = client.startOperation('oneworks.app.startup', { operationId: 'operation-private-id' })
    operation.fail({ code: 'desktop.startup_failed', domain: 'process' })

    const bundle = await writeDiagnosticSupportBundle({
      architecture: 'arm64',
      destinationPath,
      generatedAt: new Date('2026-08-09T00:00:00.000Z'),
      platform: 'darwin',
      productName: 'One Works',
      productVersion: '1.2.3',
      sources: [{ directory: journalDirectory, label: 'Desktop Startup' }]
    })

    expect(bundle.summary).toMatchObject({
      eventCount: 2,
      failures: { 'desktop.startup_failed': 1 },
      outcomes: { error: 1 }
    })
    const contents = await fs.readFile(destinationPath, 'utf8')
    expect(contents).not.toContain('startup-private-id')
    expect(contents).not.toContain('private-user@example.com')
    expect(contents).not.toContain('operation-private-id')
    expect(contents).toContain('sha256-truncated')
    expect(contents).toContain('desktop-startup')
  })
})
