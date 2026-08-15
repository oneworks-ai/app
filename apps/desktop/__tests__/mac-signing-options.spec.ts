import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { resolveMacSigningOptions } = require('../scripts/mac-signing-options.cjs') as {
  resolveMacSigningOptions: (input: {
    appName: string
    desktopRoot: string
    env?: NodeJS.ProcessEnv
    platform?: NodeJS.Platform
  }) => {
    osxSign?: {
      continueOnError: boolean
      identity: string
      keychain: string
      optionsForFile: (filePath: string) => {
        entitlements?: string
        hardenedRuntime: boolean
      }
    }
  }
}
const {
  ARTIFACTS,
  readNativeAuthorityManifest,
  writeNativeAuthorityManifest
} = require('../../../packages/fs-authority-native/manifest.cjs') as {
  ARTIFACTS: Record<string, { architecture: string; path: string }>
  readNativeAuthorityManifest: (
    packageRoot: string,
    options: { requireClosed: boolean }
  ) => { artifacts: Record<string, { path: string; sha256: string; size: number }> }
  writeNativeAuthorityManifest: (
    packageRoot: string,
    artifacts: Record<string, { path: string; sha256: string; size: number }>,
    options: { requireClosed: boolean }
  ) => void
}

const completeEnv = {
  APPLE_ID: 'developer@example.test',
  APPLE_ID_PASSWORD: 'application-password',
  APPLE_TEAM_ID: 'TEAMID',
  ONEWORKS_DESKTOP_SIGN: 'true',
  ONEWORKS_DESKTOP_SIGNING_KEYCHAIN: '/tmp/signing.keychain-db'
}
const roots: string[] = []

const createPackagedAppFixture = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'oneworks-mac-signing-options-'))
  roots.push(root)
  const appPath = path.join(root, 'One Works.app')
  const authorityRoot = path.join(
    appPath,
    'Contents',
    'Resources',
    'app',
    'node_modules',
    '.pnpm',
    'node_modules',
    '@oneworks',
    'fs-authority-native'
  )
  mkdirSync(path.join(authorityRoot, 'prebuilds'), { recursive: true })
  const staleArtifacts = Object.fromEntries(
    Object.entries(ARTIFACTS).map(([tuple, artifact]) => {
      const artifactPath = path.join(authorityRoot, artifact.path)
      mkdirSync(path.dirname(artifactPath), { recursive: true })
      writeFileSync(artifactPath, `unsigned-${tuple}`)
      return [tuple, { path: artifact.path, sha256: '0'.repeat(64), size: 1 }]
    })
  )
  writeNativeAuthorityManifest(authorityRoot, staleArtifacts, { requireClosed: true })
  return {
    appPath,
    authorityRoot,
    packagedAppRoot: path.join(appPath, 'Contents', 'Resources', 'app'),
    staleArtifacts
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

describe('macOS app signing options', () => {
  it('leaves unsigned and non-macOS packages unchanged', () => {
    expect(resolveMacSigningOptions({
      appName: 'One Works',
      desktopRoot: '/workspace/apps/desktop',
      env: {},
      platform: 'darwin'
    })).toEqual({})
    expect(resolveMacSigningOptions({
      appName: 'One Works',
      desktopRoot: '/workspace/apps/desktop',
      env: completeEnv,
      platform: 'linux'
    })).toEqual({})
  })

  it('fails closed when the application signing keychain is missing', () => {
    const missingName = 'ONEWORKS_DESKTOP_SIGNING_KEYCHAIN'
    expect(() =>
      resolveMacSigningOptions({
        appName: 'One Works',
        desktopRoot: '/workspace/apps/desktop',
        env: { ...completeEnv, [missingName]: '' },
        platform: 'darwin'
      })
    ).toThrow(missingName)
  })

  it('refreshes signed native bytes only at the outer root app callback', () => {
    const desktopRoot = '/workspace/apps/desktop'
    const fixture = createPackagedAppFixture()
    const options = resolveMacSigningOptions({
      appName: 'One Works',
      desktopRoot,
      env: completeEnv,
      platform: 'darwin'
    })

    expect(options).not.toHaveProperty('osxNotarize')
    expect(options.osxSign).toMatchObject({
      continueOnError: false,
      identity: 'Developer ID Application',
      keychain: completeEnv.ONEWORKS_DESKTOP_SIGNING_KEYCHAIN
    })
    expect(options.osxSign).not.toHaveProperty('batchCodesignCalls')
    expect(
      options.osxSign?.optionsForFile(path.join(
        fixture.appPath,
        'Contents',
        'Frameworks',
        'One Works Helper (Renderer).app'
      ))
    ).toEqual({
      hardenedRuntime: true
    })
    expect(readNativeAuthorityManifest(fixture.authorityRoot, { requireClosed: true }).artifacts)
      .toEqual(fixture.staleArtifacts)

    for (const [tuple, artifact] of Object.entries(ARTIFACTS)) {
      writeFileSync(path.join(fixture.authorityRoot, artifact.path), `signed-${tuple}`)
    }
    const previousManifestInode = statSync(path.join(fixture.authorityRoot, 'prebuilds', 'manifest.json')).ino

    expect(options.osxSign?.optionsForFile(fixture.appPath)).toEqual({
      entitlements: path.join(desktopRoot, 'build', 'entitlements.mac.plist'),
      hardenedRuntime: true
    })
    const refreshed = readNativeAuthorityManifest(fixture.authorityRoot, { requireClosed: true })
    for (const entry of Object.values(refreshed.artifacts)) {
      expect(entry.sha256).not.toBe('0'.repeat(64))
      expect(entry.size).toBeGreaterThan(1)
    }
    const refreshedManifestPath = path.join(fixture.authorityRoot, 'prebuilds', 'manifest.json')
    const refreshedManifest = readFileSync(refreshedManifestPath, 'utf8')
    const refreshedManifestInode = statSync(refreshedManifestPath).ino
    expect(refreshedManifestInode).not.toBe(previousManifestInode)

    options.osxSign?.optionsForFile(fixture.appPath)
    expect(readFileSync(refreshedManifestPath, 'utf8')).toBe(refreshedManifest)
    expect(statSync(refreshedManifestPath).ino).toBe(refreshedManifestInode)
  })

  it('fails before root signing when the packaged authority resolves outside the app', () => {
    const fixture = createPackagedAppFixture()
    const escapedRoot = path.join(path.dirname(fixture.appPath), 'escaped-authority')
    renameSync(fixture.authorityRoot, escapedRoot)
    symlinkSync(escapedRoot, fixture.authorityRoot)
    const options = resolveMacSigningOptions({
      appName: 'One Works',
      desktopRoot: '/workspace/apps/desktop',
      env: completeEnv,
      platform: 'darwin'
    })

    expect(() => options.osxSign?.optionsForFile(fixture.appPath)).toThrow(
      'packaged native authority escapes the root application'
    )
  })

  it('fails before any write when packaged application resources resolve outside the root app', () => {
    const fixture = createPackagedAppFixture()
    const escapedRoot = path.join(path.dirname(fixture.appPath), 'escaped-app-resources')
    const manifestPath = path.join(fixture.authorityRoot, 'prebuilds', 'manifest.json')
    const manifestBefore = readFileSync(manifestPath, 'utf8')
    renameSync(fixture.packagedAppRoot, escapedRoot)
    symlinkSync(escapedRoot, fixture.packagedAppRoot)
    const options = resolveMacSigningOptions({
      appName: 'One Works',
      desktopRoot: '/workspace/apps/desktop',
      env: completeEnv,
      platform: 'darwin'
    })

    expect(() => options.osxSign?.optionsForFile(fixture.appPath)).toThrow(
      'packaged application resources escape the root application'
    )
    expect(
      readFileSync(
        path.join(
          escapedRoot,
          'node_modules',
          '.pnpm',
          'node_modules',
          '@oneworks',
          'fs-authority-native',
          'prebuilds',
          'manifest.json'
        ),
        'utf8'
      )
    )
      .toBe(manifestBefore)
  })
})
