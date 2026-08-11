import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { canonicalRepositoryUrl } from '../publish-plan-core.mjs'
import {
  createReleaseTagPlanFromManifestChanges,
  formatReleaseTagPlan,
  loadReleaseTagPlan,
  parseGitNameStatusZ
} from '../release-tags'

describe('release tag planning', () => {
  it('creates release tags for changed workspace package versions', () => {
    const plan = createReleaseTagPlanFromManifestChanges([
      {
        path: 'packages/core/package.json',
        before: {
          name: '@oneworks/core',
          version: '1.0.0'
        },
        after: {
          name: '@oneworks/core',
          version: '1.1.0'
        }
      },
      {
        path: 'package.json',
        before: {
          name: 'oneworks-dev',
          version: '1.0.0'
        },
        after: {
          name: 'oneworks-dev',
          version: '1.1.0'
        }
      },
      {
        path: 'apps/client/package.json',
        before: {
          name: '@oneworks/client',
          version: '1.0.0'
        },
        after: {
          name: '@oneworks/client',
          version: '1.0.0'
        }
      }
    ], {
      base: 'base',
      head: 'head'
    })

    expect(plan.tags).toEqual([
      {
        isNewPackage: false,
        name: '@oneworks/core',
        path: 'packages/core/package.json',
        previousVersion: '1.0.0',
        private: false,
        tag: 'pkg/oneworks-core/v1.1.0',
        version: '1.1.0'
      }
    ])
  })

  it('creates tags for new and private workspace packages', () => {
    const plan = createReleaseTagPlanFromManifestChanges([
      {
        path: 'apps/desktop/package.json',
        before: {
          name: '@oneworks/desktop',
          version: '4.0.0-alpha'
        },
        after: {
          name: '@oneworks/desktop',
          private: true,
          version: '4.0.0-alpha.1'
        }
      },
      {
        path: 'packages/plugins/new-plugin/package.json',
        before: null,
        after: {
          name: '@oneworks/plugin-new',
          version: '0.1.0'
        }
      }
    ], {
      base: 'base',
      head: 'head'
    })

    expect(plan.tags.map(tag => tag.tag)).toEqual([
      'pkg/oneworks-desktop/v4.0.0-alpha.1',
      'pkg/oneworks-plugin-new/v0.1.0'
    ])
    expect(plan.tags[0]?.private).toBe(true)
    expect(plan.tags[1]?.isNewPackage).toBe(true)
  })

  it('plans the new filesystem authority package at the coordinated rc release identity', () => {
    const plan = createReleaseTagPlanFromManifestChanges([
      {
        path: 'packages/fs-authority-native/package.json',
        before: null,
        after: {
          name: '@oneworks/fs-authority-native',
          version: '0.1.0-rc.7'
        }
      }
    ], {
      base: 'base',
      head: 'head'
    })

    expect(plan.tags).toEqual([
      {
        isNewPackage: true,
        name: '@oneworks/fs-authority-native',
        path: 'packages/fs-authority-native/package.json',
        previousVersion: null,
        private: false,
        tag: 'pkg/oneworks-fs-authority-native/v0.1.0-rc.7',
        version: '0.1.0-rc.7'
      }
    ])
    expect(plan.tags[0]?.tag).not.toContain('beta')
  })

  it('excludes VS Code prereleases while preserving normal npm, Desktop, and Chrome tags', () => {
    const plan = createReleaseTagPlanFromManifestChanges([
      packageVersionChange('apps/vscode-extension/package.json', '@oneworks/vscode-extension'),
      packageVersionChange('packages/core/package.json', '@oneworks/core'),
      packageVersionChange('apps/desktop/package.json', '@oneworks/desktop', true),
      packageVersionChange(
        'packages/plugins/external-browser-driver/package.json',
        '@oneworks/plugin-external-browser-driver'
      )
    ], {
      base: 'base',
      existingReleaseTags: [],
      head: 'head'
    })

    expect(plan.tags.map(candidate => candidate.tag)).toEqual([
      'pkg/oneworks-core/v1.0.0-rc.0',
      'pkg/oneworks-desktop/v1.0.0-rc.0',
      'pkg/oneworks-plugin-external-browser-driver/v1.0.0-rc.0'
    ])
  })

  it('creates a stable VS Code tag and retains its store collision guard', () => {
    const stablePlan = createReleaseTagPlanFromManifestChanges([
      {
        path: 'apps/vscode-extension/package.json',
        before: { name: '@oneworks/vscode-extension', version: '1.0.0-rc.0' },
        after: { name: '@oneworks/vscode-extension', private: true, version: '1.0.0' }
      }
    ], {
      base: 'base',
      existingReleaseTags: [],
      head: 'head'
    })
    expect(stablePlan.tags.map(candidate => candidate.tag)).toEqual([
      'pkg/oneworks-vscode-extension/v1.0.0'
    ])

    expect(() =>
      createReleaseTagPlanFromManifestChanges([
        {
          path: 'apps/vscode-extension/package.json',
          before: { name: '@oneworks/vscode-extension', version: '1.0.0-rc.0' },
          after: { name: '@oneworks/vscode-extension', private: true, version: '1.0.0' }
        }
      ], {
        base: 'base',
        existingReleaseTags: ['pkg/oneworks-vscode-extension/v1.0.0-rc.9'],
        head: 'head'
      })
    ).toThrow(/already owned/u)

    expect(() =>
      createReleaseTagPlanFromManifestChanges([
        {
          path: 'apps/vscode-extension/package.json',
          before: { name: '@oneworks/vscode-extension', version: '0.9.0' },
          after: { name: '@oneworks/vscode-extension', private: true, version: '1.0.0' }
        }
      ], {
        base: 'base',
        existingReleaseTags: ['pkg/oneworks-vscode-extension/v2.0.0'],
        head: 'head'
      })
    ).toThrow(/must be newer/u)
  })

  it('coordinates the root and all 66 workspace manifests on 1.0.0-rc.2', () => {
    const manifestPaths = [
      'package.json',
      ...readPackageManifestPaths('apps'),
      ...readPackageManifestPaths('packages'),
      ...readPackageManifestPaths('packages/adapters'),
      ...readPackageManifestPaths('packages/channels'),
      ...readPackageManifestPaths('packages/plugins')
    ]

    const manifests = manifestPaths.map(manifestPath => ({
      manifestPath,
      manifest: JSON.parse(readFileSync(manifestPath, 'utf8'))
    }))

    expect(manifests).toHaveLength(67)
    expect(
      manifests
        .map(({ manifest }) => `${manifest.name}@${manifest.version}`)
        .filter(identity => !identity.endsWith('@1.0.0-rc.2'))
    ).toEqual([])
    expect(
      manifests
        .filter(({ manifestPath, manifest }) => manifestPath !== 'package.json' && !manifest.private)
        .filter(({ manifestPath, manifest }) =>
          manifest.repository?.type !== 'git' ||
          manifest.repository?.url !== canonicalRepositoryUrl ||
          manifest.repository?.directory !== path.dirname(manifestPath)
        )
        .map(({ manifestPath }) => manifestPath)
    ).toEqual([])

    const androidGradle = readFileSync('apps/android/app/build.gradle.kts', 'utf8')
    expect(androidGradle).toContain('versionName = androidPackageVersion')
    expect(androidGradle).toContain('readPackageVersion(androidPackageJson.asFile)')
    expect(androidGradle).not.toMatch(/versionName\s*=\s*"0\.1\.0"/u)
  })

  it('parses nul-separated git name-status output with renames', () => {
    const output = Buffer.from([
      'M',
      'packages/core/package.json',
      'R100',
      'packages/old/package.json',
      'packages/new/package.json',
      ''
    ].join('\0'))

    expect(parseGitNameStatusZ(output)).toEqual([
      {
        path: 'packages/core/package.json',
        status: 'M'
      },
      {
        oldPath: 'packages/old/package.json',
        path: 'packages/new/package.json',
        status: 'R100'
      }
    ])
  })

  it('formats an empty plan', () => {
    expect(formatReleaseTagPlan({
      base: 'base',
      head: 'head',
      tags: []
    })).toBe('[release-tags] no package version changes')
  })

  it('plans initial tags when no base commit is available', () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'oneworks-release-tags-'))
    const runGit = (args: string[]) =>
      execFileSync('git', args, {
        cwd: repoRoot,
        encoding: 'utf8'
      }).trim()

    runGit(['init'])
    mkdirSync(path.join(repoRoot, 'packages/core'), { recursive: true })
    mkdirSync(path.join(repoRoot, 'apps/desktop'), { recursive: true })
    mkdirSync(path.join(repoRoot, 'apps/vscode-extension'), { recursive: true })
    writeFileSync(
      path.join(repoRoot, 'packages/core/package.json'),
      `${
        JSON.stringify({
          name: '@oneworks/core',
          version: '0.1.0'
        })
      }\n`
    )
    writeFileSync(
      path.join(repoRoot, 'apps/desktop/package.json'),
      `${
        JSON.stringify({
          name: '@oneworks/desktop',
          private: true,
          version: '0.1.0-alpha.0'
        })
      }\n`
    )
    writeFileSync(
      path.join(repoRoot, 'apps/vscode-extension/package.json'),
      `${
        JSON.stringify({
          name: '@oneworks/vscode-extension',
          private: true,
          version: '1.0.0-rc.0'
        })
      }\n`
    )
    runGit(['add', '.'])
    runGit(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'init'])
    const head = runGit(['rev-parse', 'HEAD'])

    const plan = loadReleaseTagPlan({
      base: '',
      cwd: repoRoot,
      head
    })

    expect(plan.tags.map(tag => tag.tag)).toEqual([
      'pkg/oneworks-core/v0.1.0',
      'pkg/oneworks-desktop/v0.1.0-alpha.0'
    ])
    expect(plan.tags.every(tag => tag.isNewPackage)).toBe(true)
  })
})

const packageVersionChange = (path: string, name: string, privatePackage = false) => ({
  path,
  before: { name, private: privatePackage, version: '0.1.0' },
  after: { name, private: privatePackage, version: '1.0.0-rc.0' }
})

const readPackageManifestPaths = (parent: string) =>
  readdirSync(parent, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(parent, entry.name, 'package.json'))
    .filter(existsSync)
    .sort()
