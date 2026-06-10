import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveManagedNpmCliPaths } from '@oneworks/utils/managed-npm-cli'

import {
  CLAUDE_CODE_CLI_PACKAGE,
  CLAUDE_CODE_CLI_VERSION,
  CLAUDE_CODE_ROUTER_CLI_PACKAGE,
  CLAUDE_CODE_ROUTER_CLI_VERSION,
  resolveAdapterCliPath,
  resolveClaudeCliPath
} from '../src/ccr/paths'

describe('claude code CLI paths', () => {
  it('uses a managed Claude binary from the global bootstrap cache', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ow-claude-home-'))
    const worktree = await mkdtemp(join(tmpdir(), 'ow-claude-worktree-'))
    try {
      const env = {
        __ONEWORKS_PROJECT_REAL_HOME__: home
      }
      const paths = resolveManagedNpmCliPaths({
        adapterKey: 'claude_code',
        binaryName: 'claude',
        cwd: worktree,
        env,
        packageName: CLAUDE_CODE_CLI_PACKAGE,
        version: CLAUDE_CODE_CLI_VERSION
      })
      await mkdir(paths.binDir, { recursive: true })
      await writeFile(paths.binaryPath, '#!/bin/sh\n')
      await chmod(paths.binaryPath, 0o755)

      expect(resolveClaudeCliPath(worktree, env)).toBe(await realpath(paths.binaryPath))
    } finally {
      await rm(home, { recursive: true, force: true })
      await rm(worktree, { recursive: true, force: true })
    }
  })

  it('uses a managed Claude Code Router binary from the global bootstrap cache', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ow-ccr-home-'))
    const worktree = await mkdtemp(join(tmpdir(), 'ow-ccr-worktree-'))
    try {
      const env = {
        __ONEWORKS_PROJECT_REAL_HOME__: home
      }
      const paths = resolveManagedNpmCliPaths({
        adapterKey: 'claude_code_router',
        binaryName: 'ccr',
        cwd: worktree,
        env,
        packageName: CLAUDE_CODE_ROUTER_CLI_PACKAGE,
        version: CLAUDE_CODE_ROUTER_CLI_VERSION
      })
      await mkdir(paths.binDir, { recursive: true })
      await writeFile(paths.binaryPath, '#!/bin/sh\n')
      await chmod(paths.binaryPath, 0o755)

      expect(resolveAdapterCliPath(worktree, env)).toBe(await realpath(paths.binaryPath))
    } finally {
      await rm(home, { recursive: true, force: true })
      await rm(worktree, { recursive: true, force: true })
    }
  })
})
