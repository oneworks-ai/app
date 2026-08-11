import { createRequire } from 'node:module'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { resolveMacSigningOptions } = require('../scripts/mac-signing-options.cjs') as {
  resolveMacSigningOptions: (input: {
    appName: string
    desktopRoot: string
    env?: NodeJS.ProcessEnv
    platform?: NodeJS.Platform
  }) => {
    osxNotarize?: {
      appleId: string
      appleIdPassword: string
      teamId: string
    }
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

const completeEnv = {
  APPLE_ID: 'developer@example.test',
  APPLE_ID_PASSWORD: 'application-password',
  APPLE_TEAM_ID: 'TEAMID',
  ONEWORKS_DESKTOP_SIGN: 'true',
  ONEWORKS_DESKTOP_SIGNING_KEYCHAIN: '/tmp/signing.keychain-db'
}

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

  it.each([
    'APPLE_ID',
    'APPLE_ID_PASSWORD',
    'APPLE_TEAM_ID',
    'ONEWORKS_DESKTOP_SIGNING_KEYCHAIN'
  ])('fails closed when %s is missing', missingName => {
    expect(() =>
      resolveMacSigningOptions({
        appName: 'One Works',
        desktopRoot: '/workspace/apps/desktop',
        env: { ...completeEnv, [missingName]: '' },
        platform: 'darwin'
      })
    ).toThrow(missingName)
  })

  it('signs the full app with Developer ID and notarizes before packaging returns', () => {
    const desktopRoot = '/workspace/apps/desktop'
    const options = resolveMacSigningOptions({
      appName: 'One Works',
      desktopRoot,
      env: completeEnv,
      platform: 'darwin'
    })

    expect(options.osxNotarize).toEqual({
      appleId: completeEnv.APPLE_ID,
      appleIdPassword: completeEnv.APPLE_ID_PASSWORD,
      teamId: completeEnv.APPLE_TEAM_ID
    })
    expect(options.osxSign).toMatchObject({
      continueOnError: false,
      identity: 'Developer ID Application',
      keychain: completeEnv.ONEWORKS_DESKTOP_SIGNING_KEYCHAIN
    })
    expect(options.osxSign?.optionsForFile('/tmp/One Works.app')).toEqual({
      entitlements: path.join(desktopRoot, 'build', 'entitlements.mac.plist'),
      hardenedRuntime: true
    })
    expect(options.osxSign?.optionsForFile('/tmp/One Works Helper (Renderer).app')).toEqual({
      hardenedRuntime: true
    })
  })
})
