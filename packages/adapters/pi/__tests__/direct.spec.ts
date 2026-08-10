import type { ChildProcess } from 'node:child_process'

import { describe, expect, it, vi } from 'vitest'

import type { AdapterCtx, AdapterQueryOptions } from '@oneworks/types'

import { createDirectPiSession } from '#~/runtime/session/direct.js'

const createSpawnedProcess = () =>
  ({
    killed: false,
    kill: vi.fn(() => true),
    on: vi.fn(),
    pid: 12345
  }) as unknown as ChildProcess

describe('pi direct session', () => {
  it.each([
    ['--approve', ' --approve'],
    ['@/tmp/secret', ' @/tmp/secret'],
    ['  ordinary prompt  ', 'ordinary prompt']
  ])('passes %s to Pi as a message argument without changing the base approval flag', (description, expectedPrompt) => {
    const process = createSpawnedProcess()
    const spawnProcess = vi.fn(() => process)
    createDirectPiSession(
      {
        args: ['--no-approve', '--mode', 'json'],
        binaryPath: '/fake/pi',
        model: 'mock/pi',
        spawnEnv: {},
        tools: []
      },
      { cwd: '/workspace' } as AdapterCtx,
      {
        type: 'create',
        runtime: 'cli',
        sessionId: 'direct-session',
        description,
        onEvent: vi.fn()
      } as AdapterQueryOptions,
      spawnProcess as never
    )

    expect(spawnProcess).toHaveBeenCalledWith('/fake/pi', [
      '--no-approve',
      '--mode',
      'json',
      expectedPrompt
    ], expect.objectContaining({ cwd: '/workspace' }))
  })
})
