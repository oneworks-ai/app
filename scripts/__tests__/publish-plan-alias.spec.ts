import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  createPublishAliasManifest,
  createPublishPlan,
  loadWorkspacePackages,
  stagePublishAliasManifest
} from '../publish-plan-core.mjs'

describe('publish-plan aliases', () => {
  const loadAliasFixturePackages = async () => {
    const dirs = new Map<string, string[]>([
      ['/repo/apps', ['bootstrap']]
    ])
    const files = new Map<string, string>([
      ['/repo/pnpm-workspace.yaml', 'packages:\n  - apps/*\n'],
      [
        '/repo/apps/bootstrap/package.json',
        JSON.stringify({
          name: 'oneworks',
          version: '0.1.0-alpha.2',
          bin: {
            oneworks: './cli.js',
            ow: './cli.js',
            owo: './cli.js'
          },
          oneworks: {
            runtimeTranspile: true,
            publishAliases: ['onework', 'oneork', 'oneorks']
          },
          dependencies: {
            '@oneworks/cli-helper': 'workspace:*'
          }
        })
      ]
    ])

    const packages = await loadWorkspacePackages('/repo', {
      async readText(filePath: string) {
        const content = files.get(filePath)
        if (!content) {
          throw new Error(`missing file: ${filePath}`)
        }
        return content
      },
      async readdir(dirPath: string) {
        return dirs.get(dirPath) ?? []
      },
      async stat(filePath: string) {
        return {
          isDirectory: () => !filePath.endsWith('package.json')
        }
      },
      async writeText() {}
    })

    return packages
  }

  it('expands bootstrap publish aliases from the source package metadata', async () => {
    const packages = await loadAliasFixturePackages()

    expect(Array.from(packages.keys())).toEqual([
      'oneworks',
      'onework',
      'oneork',
      'oneorks'
    ])
    expect(packages.get('onework')).toMatchObject({
      dir: '/repo/apps/bootstrap',
      publishAliasFor: 'oneworks',
      json: {
        name: 'onework',
        version: '0.1.0-alpha.2',
        bin: {
          onework: './cli.js'
        },
        dependencies: {
          '@oneworks/cli-helper': 'workspace:*'
        }
      }
    })

    const plan = createPublishPlan(packages, {
      packages: ['oneworks'],
      publish: false,
      access: 'public',
      tag: '',
      dryRun: false,
      noGitChecks: false,
      bump: '',
      confirmRetry: true,
      json: false,
      includePrivate: false,
      help: false
    })

    expect(plan.items[0]?.name).toBe('oneworks')
    expect(plan.items.map(item => item.name).sort()).toEqual([
      'oneork',
      'oneorks',
      'onework',
      'oneworks'
    ])
    expect(plan.items.filter(item => item.publishAliasFor === 'oneworks').map(item => item.dir)).toEqual([
      '/repo/apps/bootstrap',
      '/repo/apps/bootstrap',
      '/repo/apps/bootstrap'
    ])
  })

  it('expands the full bootstrap alias group when an alias is requested directly', async () => {
    const packages = await loadAliasFixturePackages()
    const plan = createPublishPlan(packages, {
      packages: ['onework'],
      publish: false,
      access: 'public',
      tag: '',
      dryRun: false,
      noGitChecks: false,
      bump: '',
      confirmRetry: true,
      json: false,
      includePrivate: false,
      help: false
    })

    expect(plan.items[0]?.name).toBe('oneworks')
    expect(plan.items.map(item => item.name).sort()).toEqual([
      'oneork',
      'oneorks',
      'onework',
      'oneworks'
    ])
  })

  it('creates alias manifests by renaming the source package and bin', () => {
    const aliasManifest = createPublishAliasManifest({
      name: 'oneworks',
      version: '0.1.0-alpha.2',
      bin: {
        oneworks: './cli.js',
        ow: './cli.js',
        owo: './cli.js'
      },
      oneworks: {
        runtimeTranspile: true,
        publishAliases: ['onework']
      },
      dependencies: {
        '@oneworks/cli-helper': 'workspace:*'
      }
    }, 'onework')

    expect(aliasManifest).toMatchObject({
      name: 'onework',
      version: '0.1.0-alpha.2',
      bin: {
        onework: './cli.js'
      },
      oneworks: {
        runtimeTranspile: true
      },
      dependencies: {
        '@oneworks/cli-helper': 'workspace:*'
      }
    })
    expect((aliasManifest.oneworks as { publishAliases?: unknown }).publishAliases).toBeUndefined()
  })

  it('stages and restores an alias manifest while publishing', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'oneworks-publish-alias-'))
    const manifestPath = path.join(tempDir, 'package.json')
    const sourceManifest = {
      name: 'oneworks',
      version: '0.1.0-alpha.2',
      bin: {
        oneworks: './cli.js',
        ow: './cli.js',
        owo: './cli.js'
      },
      oneworks: {
        runtimeTranspile: true,
        publishAliases: ['onework']
      }
    }

    try {
      writeFileSync(manifestPath, `${JSON.stringify(sourceManifest, null, 2)}\n`)

      const restore = stagePublishAliasManifest({
        name: 'onework',
        dir: tempDir,
        publishAliasFor: 'oneworks'
      })

      expect(JSON.parse(readFileSync(manifestPath, 'utf8'))).toMatchObject({
        name: 'onework',
        bin: {
          onework: './cli.js'
        }
      })

      restore?.()
      expect(JSON.parse(readFileSync(manifestPath, 'utf8'))).toEqual(sourceManifest)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
