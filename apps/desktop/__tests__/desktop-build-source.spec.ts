import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

interface DesktopBuildSource {
  branch: string
  buildTime: string
  gitHash: string
  runtimePackageCacheVersion: string
}

interface ResolveDesktopBuildSourceOptions {
  cwd?: string
  env?: Record<string, string | undefined>
  now?: () => Date
  runGitCommand?: (args: string[], cwd: string) => string | undefined
}

const {
  DESKTOP_BUILD_SOURCE_FILE,
  resolveDesktopBuildSource
} = require('../scripts/desktop-build-source.cjs') as {
  DESKTOP_BUILD_SOURCE_FILE: string
  resolveDesktopBuildSource: (options?: ResolveDesktopBuildSourceOptions) => DesktopBuildSource | undefined
}

const fixedBuildDate = new Date('2026-05-19T01:02:03.000Z')

describe('desktop build source metadata', () => {
  it('uses explicit desktop build source env values', () => {
    expect(resolveDesktopBuildSource({
      env: {
        ONEWORKS_DESKTOP_BUILD_GIT_BRANCH: 'codex/macos-desktop-dmg-ci',
        ONEWORKS_DESKTOP_BUILD_GIT_HASH: 'abcdef1234567890',
        ONEWORKS_DESKTOP_BUILD_TIME: '2026-05-19T09:02:03+08:00'
      },
      runGitCommand: () => {
        throw new Error('git should not be called when env values are complete')
      }
    })).toEqual({
      branch: 'codex/macos-desktop-dmg-ci',
      buildTime: '2026-05-19T01:02:03.000Z',
      gitHash: 'abcdef1234567890',
      runtimePackageCacheVersion: 'dev-abcdef123456-20260519010203'
    })
  })

  it('prefers GitHub pull request head branch over the merge ref name', () => {
    expect(resolveDesktopBuildSource({
      env: {
        GITHUB_HEAD_REF: 'feature/source-branch',
        GITHUB_REF_NAME: '123/merge',
        GITHUB_SHA: 'github-sha'
      },
      now: () => fixedBuildDate
    })).toEqual({
      branch: 'feature/source-branch',
      buildTime: '2026-05-19T01:02:03.000Z',
      gitHash: 'github-sha',
      runtimePackageCacheVersion: 'dev-githubsha-20260519010203'
    })
  })

  it('falls back to local git when build source env values are absent', () => {
    const gitValues: Record<string, string> = {
      'branch --show-current': 'local-branch',
      'rev-parse HEAD': 'local-hash'
    }

    expect(resolveDesktopBuildSource({
      cwd: '/repo',
      env: {},
      now: () => fixedBuildDate,
      runGitCommand: args => gitValues[args.join(' ')]
    })).toEqual({
      branch: 'local-branch',
      buildTime: '2026-05-19T01:02:03.000Z',
      gitHash: 'local-hash',
      runtimePackageCacheVersion: 'dev-localhash-20260519010203'
    })
  })

  it('allows an explicit packaged runtime cache version', () => {
    expect(resolveDesktopBuildSource({
      env: {
        ONEWORKS_RUNTIME_PACKAGE_CACHE_VERSION: 'dev-local'
      },
      now: () => fixedBuildDate,
      runGitCommand: args =>
        ({
          'branch --show-current': 'local-branch',
          'rev-parse HEAD': 'local-hash'
        })[args.join(' ')]
    })).toEqual({
      branch: 'local-branch',
      buildTime: '2026-05-19T01:02:03.000Z',
      gitHash: 'local-hash',
      runtimePackageCacheVersion: 'dev-local'
    })
  })

  it('does not emit build source metadata for release builds', () => {
    expect(resolveDesktopBuildSource({
      env: {
        ONEWORKS_DESKTOP_RELEASE_BUILD: 'true',
        GITHUB_REF_NAME: 'main',
        GITHUB_SHA: 'release-sha'
      },
      now: () => fixedBuildDate
    })).toBeUndefined()
  })

  it('exports the packaged resource file name', () => {
    expect(DESKTOP_BUILD_SOURCE_FILE).toBe('desktop-build-source.json')
  })
})
