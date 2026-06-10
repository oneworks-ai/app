import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

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
