import { describe, expect, it, vi } from 'vitest'

import {
  applyVersionBump,
  buildPublishArgs,
  bumpVersion,
  createPublishPlan,
  executePublishPlan,
  isPackageVersionPublished,
  loadWorkspacePackages,
  parseArgs,
  promptRetry,
  runPublishPlanCli
} from '../publish-plan-core.mjs'

const createPackage = (
  name: string,
  version: string,
  deps: Record<string, string> = {},
  extra: Record<string, unknown> = {}
) => ({
  name,
  dir: `/repo/${name}`,
  private: Boolean(extra.private),
  json: {
    name,
    version,
    ...(Object.keys(deps).length > 0 ? { dependencies: deps } : {}),
    ...extra
  }
})

describe('publish-plan', () => {
  it('parses CLI arguments and deduplicates packages', () => {
    const options = parseArgs([
      '--packages',
      '@scope/a,@scope/b',
      '--package',
      '@scope/b',
      '--publish',
      '--tag',
      'next',
      '--bump',
      'patch',
      '--dry-run',
      '--no-git-checks',
      '--no-confirm-retry',
      '--json'
    ])

    expect(options).toMatchObject({
      packages: ['@scope/a', '@scope/b'],
      publish: true,
      tag: 'next',
      bump: 'patch',
      dryRun: true,
      noGitChecks: true,
      confirmRetry: false,
      json: true
    })
  })

  it('keeps explicit selection narrow and only uses dependencies for analysis', () => {
    const packages = new Map([
      ['@oneworks/core', createPackage('@oneworks/core', '1.0.0')],
      [
        '@oneworks/adapter',
        createPackage('@oneworks/adapter', '1.0.0', {
          '@oneworks/core': 'workspace:^'
        })
      ],
      [
        '@oneworks/client',
        createPackage('@oneworks/client', '1.0.0', {
          '@oneworks/adapter': 'workspace:^'
        })
      ]
    ])

    const plan = createPublishPlan(packages, {
      packages: ['@oneworks/client'],
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

    expect(plan.items.map((item) => item.name)).toEqual([
      '@oneworks/client'
    ])
    expect(plan.items[0]?.internalDependencies).toEqual(['@oneworks/adapter'])
  })

  it('does not require dependent releases for compatible dependency bumps', () => {
    const packages = new Map([
      ['b', createPackage('b', '0.1.0')],
      ['a', createPackage('a', '1.0.0', { b: 'workspace:^0.1.0' })]
    ])

    const plan = createPublishPlan(packages, {
      packages: ['b'],
      publish: false,
      access: 'public',
      tag: '',
      dryRun: false,
      noGitChecks: false,
      bump: 'patch',
      confirmRetry: true,
      json: false,
      includePrivate: false,
      help: false
    })

    expect(plan.items.map((item) => item.name)).toEqual(['b'])
    expect(plan.items[0]?.nextVersion).toBe('0.1.1')
    expect(plan.items[0]?.impactedDependents).toEqual([])
  })

  it('marks dependents when a zero-major caret range is no longer compatible', () => {
    const packages = new Map([
      ['b', createPackage('b', '0.1.0')],
      ['a', createPackage('a', '1.0.0', { b: 'workspace:^0.1.0' })]
    ])

    const plan = createPublishPlan(packages, {
      packages: ['b'],
      publish: false,
      access: 'public',
      tag: '',
      dryRun: false,
      noGitChecks: false,
      bump: 'minor',
      confirmRetry: true,
      json: false,
      includePrivate: false,
      help: false
    })

    expect(plan.items.map((item) => item.name)).toEqual(['b'])
    expect(plan.items[0]?.nextVersion).toBe('0.2.0')
    expect(plan.items[0]?.impactedDependents).toEqual([
      {
        name: 'a',
        range: 'workspace:^0.1.0',
        field: 'dependencies',
        requiresRangeUpdate: true
      }
    ])
  })

  it('rejects plans that depend on a private workspace package', () => {
    const packages = new Map([
      ['@oneworks/private-core', createPackage('@oneworks/private-core', '1.0.0', {}, { private: true })],
      [
        '@oneworks/client',
        createPackage('@oneworks/client', '1.0.0', {
          '@oneworks/private-core': 'workspace:^'
        })
      ]
    ])

    expect(() =>
      createPublishPlan(packages, {
        packages: ['@oneworks/client'],
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
    ).toThrow('依赖 private 包')
  })

  it('bumps versions for every package in the plan', async () => {
    const packages = new Map([
      ['@oneworks/core', createPackage('@oneworks/core', '1.2.3')],
      ['@oneworks/client', createPackage('@oneworks/client', '2.0.0')]
    ])
    const plan = {
      items: [
        { name: '@oneworks/core' },
        { name: '@oneworks/client' }
      ]
    }
    const writes: Array<{ filePath: string; content: string }> = []

    const updates = await applyVersionBump(plan as never, packages, 'minor', {
      readText: vi.fn(),
      readdir: vi.fn(),
      stat: vi.fn(),
      writeText: vi.fn(async (filePath: string, content: string) => {
        writes.push({ filePath, content })
      })
    })

    expect(updates).toEqual([
      { name: '@oneworks/core', version: '1.3.0' },
      { name: '@oneworks/client', version: '2.1.0' }
    ])
    expect(writes.map((entry) => entry.filePath)).toEqual([
      '/repo/@oneworks/core/package.json',
      '/repo/@oneworks/client/package.json'
    ])
    expect(JSON.parse(writes[0]!.content).version).toBe('1.3.0')
  })

  it('builds pnpm publish arguments from publish flags', () => {
    expect(buildPublishArgs({
      access: 'public',
      tag: 'beta',
      dryRun: true,
      noGitChecks: true
    })).toEqual([
      'publish',
      '--access',
      'public',
      '--tag',
      'beta',
      '--dry-run',
      '--no-git-checks'
    ])
  })

  it('detects package versions that already exist in the registry', () => {
    const runCommand = vi.fn(() => ({
      status: 0,
      stdout: '"1.0.0"\n'
    }))

    expect(isPackageVersionPublished({
      name: '@oneworks/cli',
      version: '1.0.0',
      nextVersion: ''
    }, runCommand)).toBe(true)
    expect(runCommand).toHaveBeenCalledWith(
      'npm',
      ['view', '@oneworks/cli@1.0.0', 'version', '--json'],
      {
        encoding: 'utf8',
        stdio: 'pipe'
      }
    )
  })

  it('skips already published versions during real publish', async () => {
    const packages = new Map([
      ['@oneworks/core', createPackage('@oneworks/core', '1.0.0')],
      ['@oneworks/client', createPackage('@oneworks/client', '1.0.0')]
    ])
    const plan = createPublishPlan(packages, {
      packages: [],
      publish: true,
      access: 'public',
      tag: 'alpha',
      dryRun: false,
      noGitChecks: true,
      skipExisting: true,
      bump: '',
      confirmRetry: false,
      json: false,
      includePrivate: false,
      help: false
    })
    const runCommand = vi.fn((command: string, args: string[]) => {
      if (command === 'npm' && args[1] === '@oneworks/core@1.0.0') {
        return { status: 0, stdout: '"1.0.0"\n' }
      }
      if (command === 'npm') {
        return { status: 1, stdout: '' }
      }
      return { status: 0 }
    })

    const result = await executePublishPlan(
      plan,
      {
        publish: true,
        access: 'public',
        tag: 'alpha',
        dryRun: false,
        noGitChecks: true,
        skipExisting: true,
        confirmRetry: false
      },
      runCommand,
      async () => false,
      {
        write: vi.fn()
      }
    )

    expect(result.failures).toEqual([])
    expect(result.attempts).toEqual([
      {
        name: '@oneworks/client',
        status: 0,
        attempts: 1,
        success: true
      },
      {
        name: '@oneworks/core',
        status: 0,
        attempts: 0,
        success: true,
        skipped: true
      }
    ])
  })

  it('does not skip existing versions during dry-run publish', async () => {
    const packages = new Map([
      ['@oneworks/core', createPackage('@oneworks/core', '1.0.0')]
    ])
    const plan = createPublishPlan(packages, {
      packages: [],
      publish: true,
      access: 'public',
      tag: 'alpha',
      dryRun: true,
      noGitChecks: true,
      skipExisting: true,
      bump: '',
      confirmRetry: false,
      json: false,
      includePrivate: false,
      help: false
    })
    const runCommand = vi.fn((command: string) => {
      if (command === 'npm') {
        return { status: 0, stdout: '"1.0.0"\n' }
      }
      return { status: 0 }
    })

    const result = await executePublishPlan(
      plan,
      {
        publish: true,
        access: 'public',
        tag: 'alpha',
        dryRun: true,
        noGitChecks: true,
        skipExisting: true,
        confirmRetry: false
      },
      runCommand,
      async () => false,
      {
        write: vi.fn()
      }
    )

    expect(result.attempts).toEqual([
      {
        name: '@oneworks/core',
        status: 0,
        attempts: 1,
        success: true
      }
    ])
    expect(runCommand).toHaveBeenCalledTimes(1)
    expect(runCommand.mock.calls[0]?.[0]).toBe('pnpm')
  })

  it('does not retry publish failures when retry confirmation is disabled', async () => {
    await expect(promptRetry('@oneworks/cli', {
      confirmRetry: false
    }, {
      stdin: { isTTY: true },
      stdout: { write: vi.fn() }
    })).resolves.toBe(false)
  })

  it('does not retry publish failures in non-interactive environments', async () => {
    await expect(promptRetry('@oneworks/cli', {
      confirmRetry: true
    }, {
      stdin: { isTTY: false },
      stdout: { write: vi.fn() }
    })).resolves.toBe(false)
  })

  it('loads workspace packages from pnpm-workspace patterns', async () => {
    const dirs = new Map<string, string[]>([
      ['/repo/apps', ['cli', 'server']]
    ])
    const files = new Map<string, string>([
      ['/repo/pnpm-workspace.yaml', 'packages:\n  - apps/*\n'],
      ['/repo/apps/cli/package.json', JSON.stringify({ name: '@oneworks/cli', version: '1.0.0' })],
      ['/repo/apps/server/package.json', JSON.stringify({ name: '@oneworks/server', version: '1.0.0' })]
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

    expect(Array.from(packages.keys())).toEqual([
      '@oneworks/cli',
      '@oneworks/server'
    ])
  })

  it('prints help without touching the workspace', async () => {
    const output: string[] = []

    const result = await runPublishPlanCli(['--help'], {
      repoRoot: '/repo',
      stdout: {
        write(value: string) {
          output.push(value)
        }
      },
      fsOps: {
        readText: vi.fn(async () => ''),
        readdir: vi.fn(async () => []),
        stat: vi.fn(async () => ({ isDirectory: () => false })),
        writeText: vi.fn(async () => {})
      }
    })

    expect((result as { kind: string }).kind).toBe('help')
    expect(output.join('')).toContain('pnpm tools publish-plan')
  })

  it('throws when publish failures remain after retries are disabled', async () => {
    const output: string[] = []
    const files = new Map<string, string>([
      ['/repo/pnpm-workspace.yaml', 'packages:\n  - packages/*\n'],
      ['/repo/packages/cli/package.json', JSON.stringify({ name: '@oneworks/cli', version: '1.0.0' })]
    ])

    await expect(runPublishPlanCli(['--publish', '--no-confirm-retry'], {
      repoRoot: '/repo',
      stdout: {
        write(value: string) {
          output.push(value)
        }
      },
      fsOps: {
        async readText(filePath: string) {
          const content = files.get(filePath)
          if (!content) {
            throw new Error(`missing file: ${filePath}`)
          }
          return content
        },
        async readdir(dirPath: string) {
          return dirPath === '/repo/packages' ? ['cli'] : []
        },
        async stat() {
          return { isDirectory: () => true }
        },
        async writeText() {}
      },
      runCommand: vi.fn(() => ({ status: 1, stdout: '' })),
      retryPrompt: vi.fn(async () => false)
    })).rejects.toThrow('1 个包发布失败')

    expect(output.join('')).toContain('发布失败的包:')
    expect(output.join('')).toContain('@oneworks/cli')
  })

  it('bumps semantic versions by kind', () => {
    expect(bumpVersion('1.2.3', 'patch')).toBe('1.2.4')
    expect(bumpVersion('1.2.3', 'minor')).toBe('1.3.0')
    expect(bumpVersion('1.2.3', 'major')).toBe('2.0.0')
  })
})
