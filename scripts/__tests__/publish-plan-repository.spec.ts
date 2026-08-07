import { describe, expect, it, vi } from 'vitest'

import {
  canonicalRepositoryUrl,
  createPublishPlan,
  loadWorkspacePackages,
  parseArgs,
  runPublishPlanCli,
  validatePublishRepositoryMetadata
} from '../publish-plan-core.mjs'

const createRepository = (
  directory: string,
  overrides: Record<string, unknown> = {}
) => ({
  type: 'git',
  url: canonicalRepositoryUrl,
  directory,
  ...overrides
})

const createFixture = (
  manifests: Array<[directory: string, manifest: Record<string, unknown>]>
) => {
  const files = new Map<string, string>()
  const directoryEntries = new Map<string, string[]>()
  const workspaceParents = new Set<string>()
  const runCommand = vi.fn(() => ({ status: 0, stdout: '' }))
  const writeText = vi.fn(async () => {})

  for (const [directory, manifest] of manifests) {
    const parent = directory.split('/').slice(0, -1).join('/')
    const entry = directory.split('/').at(-1)!
    workspaceParents.add(parent)
    directoryEntries.set(`/repo/${parent}`, [
      ...(directoryEntries.get(`/repo/${parent}`) ?? []),
      entry
    ])
    files.set(`/repo/${directory}/package.json`, JSON.stringify(manifest))
  }

  files.set(
    '/repo/pnpm-workspace.yaml',
    `packages:\n${Array.from(workspaceParents).sort().map(parent => `  - ${parent}/*`).join('\n')}\n`
  )

  const fsOps = {
    async readText(filePath: string) {
      const content = files.get(filePath)
      if (!content) {
        throw new Error(`missing file: ${filePath}`)
      }
      return content
    },
    async readdir(dirPath: string) {
      return directoryEntries.get(dirPath) ?? []
    },
    async stat() {
      return { isDirectory: () => true }
    },
    writeText
  }

  return {
    fsOps,
    runCommand,
    writeText,
    runtime: {
      repoRoot: '/repo',
      stdout: { write: vi.fn() },
      fsOps,
      runCommand
    }
  }
}

const cliManifest = (repository: unknown = createRepository('packages/cli')) => ({
  name: '@oneworks/cli',
  version: '1.0.0',
  repository
})

describe('publish-plan repository metadata', () => {
  it.each([
    ['missing repository', {}, 'repository.type'],
    [
      'wrong repository type',
      { repository: createRepository('packages/cli', { type: 'svn' }) },
      'repository.type'
    ],
    [
      'wrong repository URL',
      { repository: createRepository('packages/cli', { url: 'https://github.com/example/app.git' }) },
      'repository.url'
    ],
    [
      'wrong repository directory',
      { repository: createRepository('packages/not-cli') },
      'repository.directory'
    ]
  ])('rejects %s', async (_, manifestExtra, expectedIssue) => {
    const fixture = createFixture([
      ['packages/cli', { name: '@oneworks/cli', version: '1.0.0', ...manifestExtra }]
    ])
    const packages = await loadWorkspacePackages('/repo', fixture.fsOps)
    const plan = createPublishPlan(
      packages,
      parseArgs(['--package', '@oneworks/cli'])
    )

    expect(() => validatePublishRepositoryMetadata(plan, packages, '/repo')).toThrow(expectedIssue)
  })

  it.each([
    ['real publish', ['--publish']],
    ['dry-run publish', ['--publish', '--dry-run']],
    ['bump-only write', ['--bump', 'patch']]
  ])('fails closed before commands or writes during %s', async (_, args) => {
    const fixture = createFixture([
      ['packages/cli', { name: '@oneworks/cli', version: '1.0.0' }]
    ])

    await expect(runPublishPlanCli(args, fixture.runtime)).rejects.toThrow(
      'repository 元数据无效'
    )
    expect(fixture.runCommand).not.toHaveBeenCalled()
    expect(fixture.writeText).not.toHaveBeenCalled()
  })

  it('accepts a valid selected package for dry-run publishing', async () => {
    const fixture = createFixture([
      ['packages/cli', cliManifest()]
    ])

    const result = await runPublishPlanCli([
      '--package',
      '@oneworks/cli',
      '--publish',
      '--dry-run'
    ], fixture.runtime)

    expect(result.publishResult?.failures).toEqual([])
    expect(fixture.runCommand).toHaveBeenCalledTimes(1)
    expect(fixture.runCommand).toHaveBeenCalledWith(
      'pnpm',
      ['publish', '--access', 'public', '--dry-run'],
      { cwd: '/repo/packages/cli', stdio: 'inherit' }
    )
  })

  it('validates aliases through their source package', async () => {
    const fixture = createFixture([
      [
        'apps/bootstrap',
        {
          name: 'oneworks',
          version: '1.0.0',
          repository: createRepository('apps/bootstrap'),
          oneworks: { publishAliases: ['onework'] }
        }
      ]
    ])
    const packages = await loadWorkspacePackages('/repo', fixture.fsOps)
    const plan = createPublishPlan(
      packages,
      parseArgs(['--package', 'onework', '--publish', '--dry-run'])
    )

    expect(plan.items.map(item => item.name)).toEqual(['oneworks', 'onework'])
    expect(() => validatePublishRepositoryMetadata(plan, packages, '/repo')).not.toThrow()
  })

  it('keeps targeted validation narrow', async () => {
    const fixture = createFixture([
      ['packages/valid', {
        name: '@oneworks/valid',
        version: '1.0.0',
        repository: createRepository('packages/valid')
      }],
      ['packages/invalid', { name: '@oneworks/invalid', version: '1.0.0' }]
    ])

    const result = await runPublishPlanCli([
      '--package',
      '@oneworks/valid',
      '--publish',
      '--dry-run'
    ], fixture.runtime)

    expect(result.plan.items.map(item => item.name)).toEqual(['@oneworks/valid'])
    expect(fixture.runCommand).toHaveBeenCalledTimes(1)
  })
})
