/* eslint-disable max-lines */

import { appendFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { callHook } from '@oneworks/hooks'

import { createCodexTranscriptHookWatcher } from '#~/runtime/transcript-hooks.js'

vi.mock('@oneworks/hooks', () => ({
  callHook: vi.fn()
}))

const callHookMock = vi.mocked(callHook)

const waitFor = async (ms: number) => {
  await new Promise(resolve => setTimeout(resolve, ms))
}

const createLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
})

const createTimestamp = () => new Date().toISOString()

describe('createCodexTranscriptHookWatcher', () => {
  let homeDir: string
  let sessionsDir: string

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), 'codex-transcript-hooks-'))
    sessionsDir = join(homeDir, '.codex', 'sessions', '2026', '04', '06')
    await mkdir(sessionsDir, { recursive: true })
    callHookMock.mockReset()
    callHookMock.mockResolvedValue({ continue: true } as any)
  })

  afterEach(async () => {
    await waitFor(20)
  })

  it('bridges apply_patch transcript events into observational pre/post hooks', async () => {
    const logger = createLogger()
    const timestamp = createTimestamp()
    const watcher = createCodexTranscriptHookWatcher({
      cwd: '/tmp/project',
      env: {},
      homeDir,
      logger: logger as any,
      runtime: 'server',
      sessionId: 'ow-session',
      pollIntervalMs: 10
    })

    watcher.start()

    const transcriptPath = join(sessionsDir, 'rollout-2026-04-06T00-00-00-abc.jsonl')
    await writeFile(
      transcriptPath,
      [
        JSON.stringify({
          timestamp,
          type: 'session_meta',
          payload: {
            id: 'codex-session',
            timestamp,
            cwd: '/tmp/project'
          }
        }),
        JSON.stringify({
          timestamp,
          type: 'response_item',
          payload: {
            type: 'custom_tool_call',
            status: 'completed',
            call_id: 'call_apply_patch',
            name: 'apply_patch',
            input: '*** Begin Patch\n*** Add File: /tmp/project/example.txt\n+hello\n*** End Patch\n'
          }
        }),
        JSON.stringify({
          timestamp,
          type: 'response_item',
          payload: {
            type: 'custom_tool_call_output',
            call_id: 'call_apply_patch',
            output: JSON.stringify({
              output: 'Success. Updated the following files:\nA /tmp/project/example.txt\n',
              metadata: { exit_code: 0 }
            })
          }
        }),
        ''
      ].join('\n')
    )

    await waitFor(80)
    watcher.stop()

    expect(callHookMock).toHaveBeenNthCalledWith(
      1,
      'PreToolUse',
      expect.objectContaining({
        adapter: 'codex',
        canBlock: false,
        cwd: '/tmp/project',
        hookSource: 'bridge',
        runtime: 'server',
        sessionId: 'ow-session',
        toolCallId: 'call_apply_patch',
        toolName: 'adapter:codex:ApplyPatch',
        toolInput: {
          patch: '*** Begin Patch\n*** Add File: /tmp/project/example.txt\n+hello\n*** End Patch\n'
        },
        transcriptPath
      }),
      {}
    )
    expect(callHookMock).toHaveBeenNthCalledWith(
      2,
      'PostToolUse',
      expect.objectContaining({
        adapter: 'codex',
        canBlock: false,
        cwd: '/tmp/project',
        hookSource: 'bridge',
        runtime: 'server',
        sessionId: 'ow-session',
        toolCallId: 'call_apply_patch',
        toolName: 'adapter:codex:ApplyPatch',
        toolInput: {
          patch: '*** Begin Patch\n*** Add File: /tmp/project/example.txt\n+hello\n*** End Patch\n'
        },
        transcriptPath,
        isError: false,
        toolResponse: {
          output: 'Success. Updated the following files:\nA /tmp/project/example.txt\n',
          metadata: { exit_code: 0 }
        }
      }),
      {}
    )
  })

  it('emits direct-mode adapter events from assistant and tool transcript items', async () => {
    const timestamp = createTimestamp()
    const onEvent = vi.fn()
    const watcher = createCodexTranscriptHookWatcher({
      cwd: '/tmp/project',
      env: {},
      homeDir,
      logger: createLogger() as any,
      onEvent,
      runtime: 'cli',
      sessionId: 'ow-session',
      pollIntervalMs: 10
    })

    watcher.start()

    const transcriptPath = join(sessionsDir, 'rollout-2026-04-06T00-00-00-events.jsonl')
    await writeFile(
      transcriptPath,
      [
        JSON.stringify({
          timestamp,
          type: 'session_meta',
          payload: {
            id: 'codex-session',
            timestamp,
            cwd: '/tmp/project'
          }
        }),
        JSON.stringify({
          timestamp,
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'injected context' }]
          }
        }),
        JSON.stringify({
          timestamp,
          type: 'event_msg',
          payload: {
            type: 'user_message',
            message: 'hi'
          }
        }),
        JSON.stringify({
          timestamp,
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: '我先读 README。' }]
          }
        }),
        JSON.stringify({
          timestamp,
          type: 'response_item',
          payload: {
            type: 'function_call',
            call_id: 'call_readme',
            name: 'exec_command',
            arguments: JSON.stringify({
              cmd: 'sed -n 1,120p README.md',
              workdir: '/tmp/project',
              yield_time_ms: 1000
            })
          }
        }),
        JSON.stringify({
          timestamp,
          type: 'response_item',
          payload: {
            type: 'function_call_output',
            call_id: 'call_readme',
            output: 'README output'
          }
        }),
        JSON.stringify({
          timestamp,
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'README 总结。' }]
          }
        }),
        ''
      ].join('\n')
    )

    await waitFor(80)
    watcher.stop()

    expect(onEvent).toHaveBeenCalledTimes(5)
    expect(onEvent.mock.calls[0]?.[0]).toMatchObject({
      type: 'message',
      data: {
        role: 'user',
        content: 'hi'
      }
    })
    expect(onEvent.mock.calls[1]?.[0]).toMatchObject({
      type: 'message',
      data: {
        role: 'assistant',
        content: '我先读 README。'
      }
    })
    expect(onEvent.mock.calls[2]?.[0]).toMatchObject({
      type: 'message',
      data: {
        content: [{
          type: 'tool_use',
          id: 'call_readme',
          name: 'adapter:codex:Bash',
          input: {
            command: 'sed -n 1,120p README.md',
            cwd: '/tmp/project',
            timeoutMs: 1000
          }
        }]
      }
    })
    expect(onEvent.mock.calls[3]?.[0]).toMatchObject({
      type: 'message',
      data: {
        content: [{
          type: 'tool_result',
          tool_use_id: 'call_readme',
          content: 'README output',
          is_error: false
        }]
      }
    })
    expect(onEvent.mock.calls[4]?.[0]).toMatchObject({
      type: 'message',
      data: {
        role: 'assistant',
        content: 'README 总结。'
      }
    })
  })

  it('flushes pending transcript tool results before stopping', async () => {
    const timestamp = createTimestamp()
    const watcher = createCodexTranscriptHookWatcher({
      cwd: '/tmp/project',
      env: {},
      homeDir,
      logger: createLogger() as any,
      runtime: 'server',
      sessionId: 'ow-session',
      pollIntervalMs: 1_000
    })

    watcher.start()

    const transcriptPath = join(sessionsDir, 'rollout-2026-04-06T00-00-00-flush.jsonl')
    await writeFile(
      transcriptPath,
      [
        JSON.stringify({
          timestamp,
          type: 'session_meta',
          payload: {
            id: 'codex-session',
            timestamp,
            cwd: '/tmp/project'
          }
        }),
        JSON.stringify({
          timestamp,
          type: 'response_item',
          payload: {
            type: 'custom_tool_call',
            call_id: 'call_apply_patch_flush',
            name: 'apply_patch',
            input: '*** Begin Patch\n*** Add File: /tmp/project/example.txt\n+hello\n*** End Patch\n'
          }
        }),
        ''
      ].join('\n')
    )

    await waitFor(50)
    await appendFile(
      transcriptPath,
      `${
        JSON.stringify({
          timestamp,
          type: 'response_item',
          payload: {
            type: 'custom_tool_call_output',
            call_id: 'call_apply_patch_flush',
            output: JSON.stringify({
              output: 'Success',
              metadata: { exit_code: 0 }
            })
          }
        })
      }\n`
    )

    watcher.stop()
    await waitFor(50)

    expect(callHookMock).toHaveBeenNthCalledWith(
      2,
      'PostToolUse',
      expect.objectContaining({
        toolCallId: 'call_apply_patch_flush',
        toolName: 'adapter:codex:ApplyPatch',
        transcriptPath,
        isError: false,
        toolResponse: {
          output: 'Success',
          metadata: { exit_code: 0 }
        }
      }),
      {}
    )
  })

  it('skips bash-like transcript tool calls to avoid duplicating native bash hooks', async () => {
    const timestamp = createTimestamp()
    const watcher = createCodexTranscriptHookWatcher({
      cwd: '/tmp/project',
      env: {},
      homeDir,
      logger: createLogger() as any,
      runtime: 'server',
      sessionId: 'ow-session',
      pollIntervalMs: 10
    })

    watcher.start()

    await writeFile(
      join(sessionsDir, 'rollout-2026-04-06T00-00-00-bash.jsonl'),
      [
        JSON.stringify({
          timestamp,
          type: 'session_meta',
          payload: {
            id: 'codex-session',
            timestamp,
            cwd: '/tmp/project'
          }
        }),
        JSON.stringify({
          timestamp,
          type: 'response_item',
          payload: {
            type: 'function_call',
            call_id: 'call_exec',
            name: 'exec_command',
            arguments: JSON.stringify({ cmd: 'pwd' })
          }
        }),
        ''
      ].join('\n')
    )

    await waitFor(60)
    watcher.stop()

    expect(callHookMock).not.toHaveBeenCalled()
  })

  it('emits observational pre/post hooks for web_search transcript entries', async () => {
    const timestamp = createTimestamp()
    const watcher = createCodexTranscriptHookWatcher({
      cwd: '/tmp/project',
      env: {},
      homeDir,
      logger: createLogger() as any,
      runtime: 'server',
      sessionId: 'ow-session',
      pollIntervalMs: 10
    })

    watcher.start()

    const transcriptPath = join(sessionsDir, 'rollout-2026-04-06T00-00-00-web.jsonl')
    await writeFile(
      transcriptPath,
      [
        JSON.stringify({
          timestamp,
          type: 'session_meta',
          payload: {
            id: 'codex-session',
            timestamp,
            cwd: '/tmp/project'
          }
        }),
        JSON.stringify({
          timestamp,
          type: 'response_item',
          payload: {
            type: 'web_search_call',
            status: 'completed',
            action: {
              type: 'search',
              query: 'codex transcript hooks'
            }
          }
        }),
        ''
      ].join('\n')
    )

    await waitFor(60)
    watcher.stop()

    expect(callHookMock).toHaveBeenNthCalledWith(
      1,
      'PreToolUse',
      expect.objectContaining({
        toolName: 'adapter:codex:WebSearch',
        toolInput: { query: 'codex transcript hooks' },
        transcriptPath
      }),
      {}
    )
    expect(callHookMock).toHaveBeenNthCalledWith(
      2,
      'PostToolUse',
      expect.objectContaining({
        toolName: 'adapter:codex:WebSearch',
        toolInput: { query: 'codex transcript hooks' },
        toolResponse: {
          status: 'completed',
          action: {
            type: 'search',
            query: 'codex transcript hooks'
          }
        },
        transcriptPath
      }),
      {}
    )
  })

  it('bridges mcp tool transcript events into observational pre/post hooks', async () => {
    const timestamp = createTimestamp()
    const watcher = createCodexTranscriptHookWatcher({
      cwd: '/tmp/project',
      env: {},
      homeDir,
      logger: createLogger() as any,
      runtime: 'server',
      sessionId: 'ow-session',
      pollIntervalMs: 10
    })

    watcher.start()

    const transcriptPath = join(sessionsDir, 'rollout-2026-04-06T00-00-00-mcp.jsonl')
    await writeFile(
      transcriptPath,
      [
        JSON.stringify({
          timestamp,
          type: 'session_meta',
          payload: {
            id: 'codex-session',
            timestamp,
            cwd: '/tmp/project'
          }
        }),
        JSON.stringify({
          timestamp,
          type: 'response_item',
          payload: {
            type: 'mcp_tool_call',
            call_id: 'call_mcp',
            server: 'Docs',
            tool: 'Search',
            arguments: JSON.stringify({ query: 'codex transcript hooks' })
          }
        }),
        JSON.stringify({
          timestamp,
          type: 'response_item',
          payload: {
            type: 'mcp_tool_call_output',
            call_id: 'call_mcp',
            output: JSON.stringify({
              success: true,
              content: [{ type: 'text', text: 'found' }]
            })
          }
        }),
        ''
      ].join('\n')
    )

    await waitFor(80)
    watcher.stop()

    expect(callHookMock).toHaveBeenNthCalledWith(
      1,
      'PreToolUse',
      expect.objectContaining({
        toolCallId: 'call_mcp',
        toolName: 'adapter:codex:mcp:Docs:Search',
        toolInput: { query: 'codex transcript hooks' },
        transcriptPath
      }),
      {}
    )
    expect(callHookMock).toHaveBeenNthCalledWith(
      2,
      'PostToolUse',
      expect.objectContaining({
        toolCallId: 'call_mcp',
        toolName: 'adapter:codex:mcp:Docs:Search',
        toolInput: { query: 'codex transcript hooks' },
        toolResponse: {
          success: true,
          content: [{ type: 'text', text: 'found' }]
        },
        transcriptPath,
        isError: false
      }),
      {}
    )
  })

  it('emits synthesized observational hooks for file change transcript entries', async () => {
    const timestamp = createTimestamp()
    const watcher = createCodexTranscriptHookWatcher({
      cwd: '/tmp/project',
      env: {},
      homeDir,
      logger: createLogger() as any,
      runtime: 'server',
      sessionId: 'ow-session',
      pollIntervalMs: 10
    })

    watcher.start()

    const transcriptPath = join(sessionsDir, 'rollout-2026-04-06T00-00-00-file-change.jsonl')
    await writeFile(
      transcriptPath,
      [
        JSON.stringify({
          timestamp,
          type: 'session_meta',
          payload: {
            id: 'codex-session',
            timestamp,
            cwd: '/tmp/project'
          }
        }),
        JSON.stringify({
          timestamp,
          type: 'response_item',
          payload: {
            type: 'file_change',
            status: 'completed',
            changes: [
              { kind: 'add', path: '/tmp/project/example.txt' }
            ]
          }
        }),
        ''
      ].join('\n')
    )

    await waitFor(80)
    watcher.stop()

    expect(callHookMock).toHaveBeenNthCalledWith(
      1,
      'PreToolUse',
      expect.objectContaining({
        toolName: 'adapter:codex:FileChange',
        toolInput: {
          status: 'completed',
          changes: [
            { kind: 'add', path: '/tmp/project/example.txt' }
          ]
        },
        transcriptPath
      }),
      {}
    )
    expect(callHookMock).toHaveBeenNthCalledWith(
      2,
      'PostToolUse',
      expect.objectContaining({
        toolName: 'adapter:codex:FileChange',
        toolInput: {
          status: 'completed',
          changes: [
            { kind: 'add', path: '/tmp/project/example.txt' }
          ]
        },
        toolResponse: {
          status: 'completed',
          changes: [
            { kind: 'add', path: '/tmp/project/example.txt' }
          ]
        },
        transcriptPath,
        isError: false
      }),
      {}
    )
  })

  it('ignores transcript files from other working directories', async () => {
    const timestamp = createTimestamp()
    const watcher = createCodexTranscriptHookWatcher({
      cwd: '/tmp/project',
      env: {},
      homeDir,
      logger: createLogger() as any,
      runtime: 'server',
      sessionId: 'ow-session',
      pollIntervalMs: 10
    })

    watcher.start()

    await writeFile(
      join(sessionsDir, 'rollout-2026-04-06T00-00-00-foreign.jsonl'),
      [
        JSON.stringify({
          timestamp,
          type: 'session_meta',
          payload: {
            id: 'codex-session',
            timestamp,
            cwd: '/tmp/other-project'
          }
        }),
        JSON.stringify({
          timestamp,
          type: 'response_item',
          payload: {
            type: 'custom_tool_call',
            status: 'completed',
            call_id: 'call_apply_patch',
            name: 'apply_patch',
            input: '*** Begin Patch\n*** End Patch\n'
          }
        }),
        ''
      ].join('\n')
    )

    await waitFor(60)
    watcher.stop()

    expect(callHookMock).not.toHaveBeenCalled()
  })
})
