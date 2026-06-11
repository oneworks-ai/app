import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  isReleaseBuild,
  resolveDesktopAppMetadata
} = require('../scripts/desktop-app-metadata.cjs') as typeof import('../scripts/desktop-app-metadata.cjs')

const builderArtifactPattern = `${'$'}{version}-${'$'}{os}-${'$'}{arch}.${'$'}{ext}`

describe('desktop app metadata', () => {
  it('uses a separate dev identity by default', () => {
    expect(resolveDesktopAppMetadata({ env: {}, platform: 'darwin' })).toEqual({
      appId: 'ai.oneworks.desktop.dev',
      artifactBaseName: 'oneworks-dev',
      artifactName: `oneworks-dev-${builderArtifactPattern}`,
      executableName: 'One Works Dev',
      isDevBuild: true,
      productName: 'One Works Dev'
    })
  })

  it('uses a separate dev identity for non-release CI builds', () => {
    expect(resolveDesktopAppMetadata({ env: { CI: 'true', GITHUB_ACTIONS: 'true' }, platform: 'linux' })).toEqual({
      appId: 'ai.oneworks.desktop.dev',
      artifactBaseName: 'oneworks-dev',
      artifactName: `oneworks-dev-${builderArtifactPattern}`,
      executableName: 'oneworks-dev',
      isDevBuild: true,
      productName: 'One Works Dev'
    })
  })

  it('keeps the release identity when explicitly requested', () => {
    expect(resolveDesktopAppMetadata({ env: { ONEWORKS_DESKTOP_RELEASE_BUILD: 'true' }, platform: 'linux' })).toEqual({
      appId: 'ai.oneworks.desktop',
      artifactBaseName: 'oneworks',
      artifactName: `oneworks-${builderArtifactPattern}`,
      executableName: 'oneworks',
      isDevBuild: false,
      productName: 'One Works'
    })
  })

  it('detects explicit release builds', () => {
    expect(isReleaseBuild({ ONEWORKS_DESKTOP_RELEASE_BUILD: 'true' })).toBe(true)
  })
})
