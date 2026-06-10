import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveManagedNpmCliPaths } from '@oneworks/utils/managed-npm-cli'

import { OPENCODE_CLI_PACKAGE, OPENCODE_CLI_VERSION, resolveOpenCodeBinaryPath } from '#~/paths.js'
import {
  buildOpenCodeRunArgs,
  buildOpenCodeSessionTitle,
  extractOpenCodeSessionRecords,
  normalizeOpenCodePrompt,
  resolveLocalAttachmentPath,
  resolveOpenCodeAgent,
  selectOpenCodeSessionByTitle
} from '#~/runtime/common.js'

describe('resolveOpenCodeBinaryPath', () => {
  it('resolves to a usable default binary without requiring a bundled dependency', () => {
    const result = resolveOpenCodeBinaryPath({})
    expect(result === 'opencode' || /node_modules\/\.bin\/opencode$/.test(result)).toBe(true)
  })

  it('returns the env-specified path when set', () => {
    expect(resolveOpenCodeBinaryPath({
      __ONEWORKS_PROJECT_ADAPTER_OPENCODE_CLI_PATH__: '/usr/local/bin/opencode'
    })).toBe('/usr/local/bin/opencode')
  })

  it('uses a managed binary from the global bootstrap cache', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ow-opencode-home-'))
    const worktree = await mkdtemp(join(tmpdir(), 'ow-opencode-worktree-'))
    try {
      const env = {
        __ONEWORKS_PROJECT_REAL_HOME__: home
      }
      const paths = resolveManagedNpmCliPaths({
        adapterKey: 'opencode',
        binaryName: 'opencode',
        cwd: worktree,
        env,
        packageName: OPENCODE_CLI_PACKAGE,
        version: OPENCODE_CLI_VERSION
      })
      await mkdir(paths.binDir, { recursive: true })
      await writeFile(paths.binaryPath, '#!/bin/sh\n')
      await chmod(paths.binaryPath, 0o755)

      expect(resolveOpenCodeBinaryPath(env, worktree)).toBe(await realpath(paths.binaryPath))
    } finally {
      await rm(home, { recursive: true, force: true })
      await rm(worktree, { recursive: true, force: true })
    }
  })
})

describe('openCode prompt and session helpers', () => {
  it('normalizes prompt text and attachments', () => {
    const result = normalizeOpenCodePrompt([
      { type: 'text', text: 'Explain this diff' },
      { type: 'image', url: 'file:///tmp/screenshot.png' }
    ])

    expect(result.prompt).toBe('Explain this diff')
    expect(result.files).toEqual(['/tmp/screenshot.png'])
  })

  it('collects workspace file attachments into the file argument list', () => {
    const result = normalizeOpenCodePrompt([
      { type: 'text', text: 'Inspect these files' },
      { type: 'file', path: 'apps/client/src/main.tsx' },
      { type: 'file', path: '.oo/rules/CODING-STYLE.md' }
    ] as any)

    expect(result.prompt).toBe('Inspect these files')
    expect(result.files).toEqual([
      'apps/client/src/main.tsx',
      '.oo/rules/CODING-STYLE.md'
    ])
  })

  it('builds a deterministic session title', () => {
    expect(buildOpenCodeSessionTitle('session-1', 'OW')).toBe('OW:session-1')
  })

  it('filters managed CLI flags from passthrough options', () => {
    expect(buildOpenCodeRunArgs({
      prompt: 'hello',
      files: ['/tmp/a.txt'],
      model: 'openai/gpt-5',
      title: 'OW:session-1',
      extraOptions: ['--log-level', 'DEBUG', '--format', 'json', '--session', 'abc']
    })).toEqual([
      'run',
      '--format',
      'default',
      '--title',
      'OW:session-1',
      '--model',
      'openai/gpt-5',
      '--file',
      '/tmp/a.txt',
      '--log-level',
      'DEBUG',
      'hello'
    ])
  })

  it('extracts session records from common JSON shapes', () => {
    const records = extractOpenCodeSessionRecords({
      sessions: [
        { id: 'sess-old', title: 'OW:one', updatedAt: '2026-03-25T10:00:00.000Z' },
        { sessionId: 'sess-new', title: 'OW:one', updated_at: '2026-03-25T11:00:00.000Z' }
      ]
    })

    expect(records).toHaveLength(2)
    expect(selectOpenCodeSessionByTitle(records, 'OW:one')?.id).toBe('sess-new')
  })

  it('resolves only local attachment paths', () => {
    expect(resolveLocalAttachmentPath('file:///tmp/file.txt')).toBe('/tmp/file.txt')
    expect(resolveLocalAttachmentPath('/tmp/file.txt')).toBe('/tmp/file.txt')
    expect(resolveLocalAttachmentPath('https://example.com/file.txt')).toBeUndefined()
  })

  it('uses the plan agent by default in plan mode', () => {
    expect(resolveOpenCodeAgent({ permissionMode: 'plan' })).toBe('plan')
    expect(resolveOpenCodeAgent({
      permissionMode: 'plan',
      agent: 'build',
      planAgent: false
    })).toBe('build')
    expect(resolveOpenCodeAgent({
      permissionMode: 'plan',
      agent: 'build',
      planAgent: 'review'
    })).toBe('review')
  })
})
