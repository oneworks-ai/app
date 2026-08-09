import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createDiagnosticClient } from '@oneworks/diagnostics'
import { FileDiagnosticJournal } from '@oneworks/diagnostics/node'

import { formatDesktopSupportBundleFileName, writeDesktopSupportBundle } from '../src/main/support-bundle'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(directory => fs.rm(directory, { force: true, recursive: true })))
})

describe('desktop support bundle', () => {
  it('exports startup and JavaScript diagnostics from Electron user data', async () => {
    const userDataDirectory = await fs.mkdtemp(path.join(tmpdir(), 'oneworks-desktop-support-'))
    tempDirs.push(userDataDirectory)
    const journal = new FileDiagnosticJournal({
      directory: path.join(userDataDirectory, 'diagnostics', 'startup')
    })
    const client = createDiagnosticClient({
      exporters: [journal],
      resource: { serviceName: 'oneworks-desktop', surface: 'desktop' }
    })
    client.startOperation('oneworks.app.startup').succeed()
    const javascriptJournal = new FileDiagnosticJournal({
      directory: path.join(userDataDirectory, 'diagnostics', 'javascript')
    })
    const javascriptClient = createDiagnosticClient({
      exporters: [javascriptJournal],
      resource: { serviceName: 'oneworks-desktop', surface: 'desktop' }
    })
    javascriptClient.startOperation('oneworks.javascript.error').fail({
      code: 'javascript.client_window_error',
      domain: 'client',
      fingerprint: 'js_1234567890abcdef'
    })
    const destinationPath = path.join(userDataDirectory, 'bundle.json')

    await writeDesktopSupportBundle({
      architecture: 'arm64',
      destinationPath,
      platform: 'darwin',
      productName: 'One Works',
      productVersion: '1.2.3',
      userDataDirectory
    })

    const bundle = JSON.parse(await fs.readFile(destinationPath, 'utf8')) as {
      product: { name: string }
      summary: { eventCount: number }
    }
    expect(bundle.product.name).toBe('One Works')
    expect(bundle.summary.eventCount).toBe(4)
    expect(formatDesktopSupportBundleFileName(new Date('2026-08-09T01:02:03.000Z')))
      .toBe('oneworks-support-20260809T010203Z.json')
  })
})
