import { mkdir, mkdtemp } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  verifySignedMacAppBundle,
  verifySignedMacAppBundles
} = require('../scripts/verify-macos-signed-apps.cjs') as {
  verifySignedMacAppBundle: (input: {
    appPath: string
    requireNotarization?: boolean
    runCommand?: (command: string, args: string[]) => string
  }) => string
  verifySignedMacAppBundles: (input: {
    outputDir: string
    requireNotarization?: boolean
    runCommand?: (command: string, args: string[]) => string
  }) => string[]
}

const signedDetails = [
  'Authority=Developer ID Application: One Works (TEAMID)',
  'TeamIdentifier=TEAMID',
  'Timestamp=Aug 12, 2026 at 10:00:00',
  'Runtime Version=26.0.0'
].join('\n')

describe('signed macOS app verification', () => {
  it('requires a strict signature, Developer ID, hardened runtime, timestamp and staple', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'oneworks-signed-app-'))
    const appPath = path.join(root, 'One Works.app')
    await mkdir(appPath)
    const commands: string[] = []

    expect(verifySignedMacAppBundle({
      appPath,
      runCommand: (command, args) => {
        commands.push(`${command} ${args.join(' ')}`)
        return command === 'codesign' && args[0] === '-d' ? signedDetails : ''
      }
    })).toBe(signedDetails)
    expect(commands).toEqual([
      `codesign --verify --deep --strict --verbose=4 ${appPath}`,
      `codesign -d --verbose=4 ${appPath}`,
      `xcrun stapler validate ${appPath}`,
      `spctl --assess --type execute --verbose=4 ${appPath}`
    ])
  })

  it('can verify the complete signature before asynchronous notarization', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'oneworks-signed-app-pre-notary-'))
    const appPath = path.join(root, 'One Works.app')
    await mkdir(appPath)
    const commands: string[] = []

    verifySignedMacAppBundle({
      appPath,
      requireNotarization: false,
      runCommand: (command, args) => {
        commands.push(`${command} ${args.join(' ')}`)
        return command === 'codesign' && args[0] === '-d' ? signedDetails : ''
      }
    })

    expect(commands).toHaveLength(2)
    expect(commands.every(command => command.startsWith('codesign '))).toBe(true)
  })

  it.each([
    [
      'Developer ID Application',
      signedDetails.replace('Authority=Developer ID Application:', 'Authority=Apple Development:')
    ],
    ['Apple Developer Team identifier', signedDetails.replace('TeamIdentifier=TEAMID', 'TeamIdentifier=not set')],
    ['trusted signing timestamp', signedDetails.replace(/^Timestamp=.+\n/mu, '')],
    ['hardened runtime signing', signedDetails.replace(/^Runtime Version=.+$/mu, '')]
  ])('fails closed without %s', async (expected, details) => {
    const root = await mkdtemp(path.join(tmpdir(), 'oneworks-signed-app-invalid-'))
    const appPath = path.join(root, 'One Works.app')
    await mkdir(appPath)
    expect(() =>
      verifySignedMacAppBundle({
        appPath,
        runCommand: (command, args) => command === 'codesign' && args[0] === '-d' ? details : ''
      })
    ).toThrow(expected)
  })

  it('requires and verifies every prepackaged app bundle', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'oneworks-signed-output-'))
    expect(() => verifySignedMacAppBundles({ outputDir: root })).toThrow(
      'No prepackaged macOS app bundles'
    )

    const armApp = path.join(root, 'One Works-darwin-arm64', 'One Works.app')
    const x64App = path.join(root, 'One Works-darwin-x64', 'One Works.app')
    await mkdir(armApp, { recursive: true })
    await mkdir(x64App, { recursive: true })

    expect(verifySignedMacAppBundles({
      outputDir: root,
      runCommand: (command, args) => command === 'codesign' && args[0] === '-d' ? signedDetails : ''
    })).toEqual([armApp, x64App])
  })
})
