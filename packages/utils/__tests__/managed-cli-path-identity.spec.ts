import { chmod, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ensureManagedNpmCli,
  resolveManagedNpmCliBinaryPath,
  resolveManagedNpmCliInstallOptions
} from '#~/managed-npm-cli.js'
import { resolveSkillsCliCommand } from '#~/skills-cli/runtime.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

describe('managed CLI filesystem path identity', () => {
  it('probes and selects the exact whitespace-bearing system executable', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ow-managed-cli-path-'))
    const adjacentBinary = path.join(root, 'tool')
    const exactBinary = path.join(root, 'tool ')
    tempDirs.push(root)
    await Promise.all([
      writeFile(adjacentBinary, '#!/bin/sh\necho 0.1.0\n', 'utf8'),
      writeFile(exactBinary, '#!/bin/sh\necho 2.3.4\n', 'utf8')
    ])
    await Promise.all([chmod(adjacentBinary, 0o755), chmod(exactBinary, 0o755)])

    const selected = await ensureManagedNpmCli({
      adapterKey: 'sample',
      binaryName: 'missing-sample-tool',
      config: { autoInstall: false, source: 'system' },
      cwd: root,
      defaultPackageName: '@scope/sample',
      defaultVersion: 'latest',
      env: {},
      logger: { info: vi.fn() },
      systemBinaryPaths: [exactBinary, adjacentBinary],
      versionRange: '>=2.0.0'
    })

    expect(selected).toBe(await realpath(exactBinary))
  })

  it('preserves executable paths from env, config, npm, and skills owners', async () => {
    const exactPath = ' /tmp/bin/tool '
    const baseOptions = {
      adapterKey: 'sample',
      binaryName: 'sample-tool',
      defaultPackageName: '@scope/sample',
      defaultVersion: 'latest'
    }
    expect(resolveManagedNpmCliBinaryPath({
      ...baseOptions,
      env: { __ONEWORKS_PROJECT_ADAPTER_SAMPLE_CLI_PATH__: exactPath }
    })).toBe(exactPath)
    expect(resolveManagedNpmCliBinaryPath({
      ...baseOptions,
      config: { path: exactPath, source: 'path' },
      env: {}
    })).toBe(exactPath)
    expect(
      resolveManagedNpmCliInstallOptions({
        ...baseOptions,
        env: { __ONEWORKS_PROJECT_ADAPTER_SAMPLE_NPM_PATH__: exactPath }
      }).npmPath
    ).toBe(exactPath)
    await expect(resolveSkillsCliCommand({
      cwd: '/tmp/workspace',
      config: { path: exactPath, source: 'path' }
    })).resolves.toMatchObject({ command: exactPath, prefixArgs: [] })
  })
})
