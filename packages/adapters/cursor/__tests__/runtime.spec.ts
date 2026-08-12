import { describe, expect, it } from 'vitest'

import { assertCursorInstallVersion, resolveCursorManagedVersionDir } from '#~/paths.js'
import { parseCursorInstallVersion } from '#~/runtime/init.js'
import { buildCursorArgs, normalizeCursorPrompt } from '#~/runtime/shared.js'

const options = {
  type: 'create' as const,
  runtime: 'server' as const,
  sessionId: 'session-1',
  permissionMode: 'bypassPermissions' as const,
  onEvent: () => undefined
}

describe('cursor adapter runtime', () => {
  it('parses the pinned version from the official installer layout', () => {
    expect(parseCursorInstallVersion(
      'ln -s ~/.local/share/cursor-agent/versions/2026.08.11-e8db854/cursor-agent ~/.local/bin/agent'
    )).toBe('2026.08.11-e8db854')
  })

  it.each(['../outside', '/tmp/outside', 'nested/version', 'nested\\version', '.', '..'])(
    'rejects unsafe managed install version %s',
    (version) => {
      expect(() => assertCursorInstallVersion(version)).toThrow('Invalid Cursor CLI version')
      expect(() =>
        resolveCursorManagedVersionDir({
          __ONEWORKS_PROJECT_PACKAGE_CACHE_DIR__: '/tmp/cursor-cache'
        }, version)
      ).toThrow('Invalid Cursor CLI version')
    }
  )

  it('builds headless resume args with Cursor permission and workspace flags', () => {
    expect(buildCursorArgs({
      adapterConfig: {
        approveMcps: true,
        sandbox: 'enabled',
        endpoint: 'https://cursor.example.test',
        additionalDirs: ['/workspace/shared']
      },
      nativeSessionId: 'cursor-chat-1',
      options,
      prompt: 'continue',
      stream: true
    })).toEqual([
      '--print',
      '--output-format',
      'stream-json',
      '--stream-partial-output',
      '--resume',
      'cursor-chat-1',
      '--force',
      '--approve-mcps',
      '--sandbox',
      'enabled',
      '--endpoint',
      'https://cursor.example.test',
      '--add-dir',
      '/workspace/shared',
      '--trust',
      'continue'
    ])
  })

  it('normalizes text and file inputs into a Cursor prompt', () => {
    expect(normalizeCursorPrompt([
      { type: 'text', text: 'Review this' },
      { type: 'file', path: '/workspace/a.ts' }
    ])).toBe('Review this\n\n[File: /workspace/a.ts]')
  })
})
