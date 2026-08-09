import { describe, expect, it, vi } from 'vitest'

import { formatCodexCommandForDisplay } from '#~/command-display.js'
import {
  buildCodexApprovalResponse,
  buildCodexMcpElicitationResponse,
  releaseCodexAppServerAfterCleanup,
  resolveCodexAppServerClientInfo,
  resolveCodexApprovalDecision
} from '#~/runtime/stream.js'
import packageJson from '../package.json'

describe('codex app-server client identity', () => {
  it('defaults to the adapter package version while preserving explicit overrides', () => {
    expect(resolveCodexAppServerClientInfo()).toEqual({
      name: 'OneWorks',
      title: 'One Works',
      version: packageJson.version
    })
    expect(resolveCodexAppServerClientInfo({ version: 'custom-client' }).version).toBe('custom-client')
  })
})

describe('codex stream approval decision mapping', () => {
  it('maps file-change cancel responses to decline', () => {
    expect(resolveCodexApprovalDecision({
      answer: 'cancel',
      kind: 'file-change'
    })).toBe('decline')
  })

  it('preserves command cancel responses when supported', () => {
    expect(resolveCodexApprovalDecision({
      answer: 'cancel',
      kind: 'command',
      availableDecisions: ['accept', 'cancel', 'decline']
    })).toBe('cancel')
  })

  it('wraps file-change approvals in the schema response envelope', () => {
    expect(buildCodexApprovalResponse({
      answer: 'allow_once',
      kind: 'file-change'
    })).toEqual({ decision: 'accept' })
  })

  it('wraps session approvals in the schema response envelope', () => {
    expect(buildCodexApprovalResponse({
      answer: 'allow_session',
      kind: 'command',
      availableDecisions: ['accept', 'acceptForSession', 'decline']
    })).toEqual({ decision: 'acceptForSession' })
  })

  it('maps denied MCP approvals to decline actions', () => {
    expect(buildCodexMcpElicitationResponse('deny_once')).toEqual({ action: 'decline' })
  })
})

describe('codex app-server session cleanup', () => {
  it('waits for delayed teardown work before releasing the lease', async () => {
    let finishUnregister!: () => void
    let finishResponse!: () => void
    let finishUnsubscribe!: () => void
    const events: string[] = []
    const unregister = new Promise<void>((resolve) => {
      finishUnregister = () => {
        events.push('unregister:done')
        resolve()
      }
    })
    const response = new Promise<void>((resolve) => {
      finishResponse = () => {
        events.push('response:done')
        resolve()
      }
    })
    const unsubscribe = new Promise<void>((resolve) => {
      finishUnsubscribe = () => {
        events.push('unsubscribe:done')
        resolve()
      }
    })
    const detach = unregister.then(async () => {
      events.push('unsubscribe:start')
      await unsubscribe
    })
    const release = () => events.push('release')

    const cleanup = releaseCodexAppServerAfterCleanup(
      { release },
      [detach, response],
      1_000
    )

    await Promise.resolve()
    expect(events).toEqual([])
    finishUnregister()
    await Promise.resolve()
    expect(events).toEqual(['unregister:done', 'unsubscribe:start'])
    finishResponse()
    await Promise.resolve()
    expect(events).not.toContain('release')
    finishUnsubscribe()
    await cleanup

    expect(events).toEqual([
      'unregister:done',
      'unsubscribe:start',
      'response:done',
      'unsubscribe:done',
      'release'
    ])
  })

  it('releases after teardown rejects without leaking the rejection', async () => {
    const release = vi.fn()

    await expect(releaseCodexAppServerAfterCleanup(
      { release },
      [Promise.reject(new Error('unregister failed'))],
      1_000
    )).resolves.toBeUndefined()
    expect(release).toHaveBeenCalledOnce()
  })
})

describe('formatCodexCommandForDisplay', () => {
  it('formats array commands', () => {
    expect(formatCodexCommandForDisplay(['/usr/bin/zsh', '-lc', 'ls -la'])).toBe('/usr/bin/zsh -lc ls -la')
  })

  it('preserves string commands', () => {
    expect(formatCodexCommandForDisplay('/usr/bin/zsh -lc ls -la')).toBe('/usr/bin/zsh -lc ls -la')
  })

  it('formats structured commands without throwing', () => {
    expect(formatCodexCommandForDisplay({
      executable: '/usr/bin/zsh',
      args: ['-lc', 'ls -la']
    })).toBe('/usr/bin/zsh -lc ls -la')
  })

  it('falls back to a placeholder when command is empty', () => {
    expect(formatCodexCommandForDisplay(undefined)).toBe('[command]')
    expect(formatCodexCommandForDisplay({})).toBe('[command]')
  })
})
