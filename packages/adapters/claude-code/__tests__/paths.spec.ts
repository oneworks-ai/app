import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveManagedNpmCliPaths } from '@oneworks/utils/managed-npm-cli'

import {
  CLAUDE_CODE_CLI_PACKAGE,
  CLAUDE_CODE_CLI_VERSION,
  CLAUDE_CODE_ROUTER_CLI_COMPATIBILITY_RANGE,
  CLAUDE_CODE_ROUTER_CLI_PACKAGE,
  CLAUDE_CODE_ROUTER_CLI_VERSION,
  resolveAdapterCliPath,
  resolveClaudeCliPath
} from '../src/ccr/paths'
import { ensureClaudeCliPath } from '../src/claude/cli'

describe('claude code CLI paths', () => {
  it('pins the CCR release supported by the managed transformer contract', () => {
    expect(CLAUDE_CODE_ROUTER_CLI_VERSION).toBe('1.0.73')
    expect(CLAUDE_CODE_ROUTER_CLI_COMPATIBILITY_RANGE).toBe('1.0.73')
  })

  it('preserves an exact whitespace-bearing cached executable path', async () => {
    const cachedPath = '/opt/oneworks/claude '
    await expect(ensureClaudeCliPath({
      ctx: {
        cwd: '/workspace',
        env: { __ONEWORKS_PROJECT_ADAPTER_CLAUDE_CODE_CLI_PATH__: cachedPath },
        logger: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined }
      } as any,
      env: {}
    })).resolves.toBe(cachedPath)
  })

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
