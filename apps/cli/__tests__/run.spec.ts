/* eslint-disable max-lines -- run command coverage intentionally stays in one spec file for CLI matrix assertions. */
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'

import { Command } from 'commander'
import { describe, expect, it, vi } from 'vitest'

import { resolveConfiguredPluginInstances } from '@oneworks/utils/plugin-resolver'

import {
  createAdapterOption,
  createPrintIdleTimeoutController,
  createSessionExitController,
  getAdapterErrorMessage,
  getCliDefaultSkillNames,
  getCliDefaultSkillPluginConfig,
  getDisallowedResumeFlags,
  getPrintableAssistantText,
  handlePrintEvent,
  normalizeCliAdapterOptionValue,
  parseCliAdapterOptionValue,
  parseCliInputControlEvent,
  parsePrintIdleTimeoutSeconds,
  persistAdapterCliVersionSelection,
  registerRunCommand,
  resolveDefaultOneworksMcpServerOption,
  resolveInjectDefaultSystemPromptOption,
  resolvePrintableStopText,
  resolveResumeAdapterOptions,
  resolveRunMode,
  shouldPrintResumeHint
} from '#~/commands/run.js'

describe('run command print output', () => {
  it('lists entity helpers as default CLI skills', () => {
    expect(getCliDefaultSkillNames()).toEqual([
      'oneworks-cli-quickstart',
      'oneworks-cli-print-mode',
      'oneworks-channel',
      'oneworks-mem',
      'create-entity',
      'update-entity',
      'create-plugin'
    ])
  })

  it('resolves default CLI skills without target workspace dependencies', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-cli-default-skills-'))

    try {
      const plugins = getCliDefaultSkillPluginConfig()
      const pluginId = plugins[0]?.id

      expect(typeof pluginId).toBe('string')
      if (typeof pluginId !== 'string') {
        throw new TypeError('Expected the default CLI skill plugin id to be a path.')
      }
      expect(isAbsolute(pluginId)).toBe(true)

      const instances = await resolveConfiguredPluginInstances({
        cwd: workspace,
        plugins
      })
      const [instance] = instances

      expect(instance?.sourceType).toBe('directory')
      if (instance == null) {
        throw new TypeError('Expected the default CLI skill plugin to resolve.')
      }
      expect(await readdir(join(instance.rootDir, 'skills'))).toEqual(
        expect.arrayContaining(getCliDefaultSkillNames())
      )
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('extracts printable assistant text from string content', () => {
    expect(getPrintableAssistantText({
      id: 'msg-1',
      role: 'assistant',
      content: 'hello',
      createdAt: Date.now()
    })).toBe('hello')
  })

  it('ignores non-text assistant messages when choosing printable content', () => {
    expect(getPrintableAssistantText({
      id: 'msg-2',
      role: 'assistant',
      content: [{
        type: 'tool_result',
        tool_use_id: 'tool-1',
        content: 'done'
      }],
      createdAt: Date.now()
    })).toBeUndefined()
  })

  it('falls back to the last assistant text when stop has no message payload', () => {
    expect(resolvePrintableStopText(undefined, 'final answer')).toBe('final answer')
  })

  it('formats adapter error details for text output', () => {
    expect(getAdapterErrorMessage({
      message: 'Incomplete response returned',
      details: { reason: 'max_output_tokens' },
      fatal: true
    })).toContain('"reason": "max_output_tokens"')
  })

  it('treats commander default values as no CLI override for negative boolean flags', () => {
    expect(resolveInjectDefaultSystemPromptOption(true, 'default')).toBeUndefined()
    expect(resolveInjectDefaultSystemPromptOption(false, 'cli')).toBe(false)
    expect(resolveDefaultOneworksMcpServerOption(true, 'default')).toBeUndefined()
    expect(resolveDefaultOneworksMcpServerOption(false, 'cli')).toBe(false)
  })

  it('defers process exit until the adapter emits exit after a pending stop request', () => {
    const calls: number[] = []
    const controller = createSessionExitController({
      exit: (code) => {
        calls.push(code)
      }
    })
    let killCount = 0

    controller.requestExit(1)
    expect(calls).toEqual([])

    controller.bindSession({
      kill: () => {
        killCount += 1
      }
    })

    expect(killCount).toBe(1)
    expect(calls).toEqual([])

    controller.handleSessionExit(0)
    expect(calls).toEqual([1])
  })

  it('signals adapter stop instead of kill for a successful exit request', () => {
    const calls: number[] = []
    let killCount = 0
    let stopCount = 0
    const controller = createSessionExitController({
      exit: (code) => {
        calls.push(code)
      }
    })

    controller.bindSession({
      kill: () => {
        killCount += 1
      },
      stop: () => {
        stopCount += 1
      }
    })
    controller.requestExit(0)

    expect(killCount).toBe(0)
    expect(stopCount).toBe(1)
    expect(calls).toEqual([])

    controller.handleSessionExit(2)
    expect(calls).toEqual([0])
  })

  it('signals adapter stop after bind when success exit was requested early', () => {
    let killCount = 0
    let stopCount = 0
    const controller = createSessionExitController()

    controller.requestExit(0)

    controller.bindSession({
      kill: () => {
        killCount += 1
      },
      stop: () => {
        stopCount += 1
      }
    })

    expect(killCount).toBe(0)
    expect(stopCount).toBe(1)
  })

  it('falls back to kill when successful exit is requested without adapter stop support', () => {
    let killCount = 0
    const controller = createSessionExitController()

    controller.bindSession({
      kill: () => {
        killCount += 1
      }
    })

    controller.requestExit(0)

    expect(killCount).toBe(1)
  })

  it('defaults resume to direct mode unless print is explicitly requested', () => {
    expect(resolveRunMode(false, 'default', 'stream')).toBe('direct')
    expect(resolveRunMode(true, 'cli', 'direct')).toBe('stream')
  })

  it('normalizes simplified adapter values', () => {
    expect(normalizeCliAdapterOptionValue('claude')).toBe('claude-code')
    expect(normalizeCliAdapterOptionValue('adapter-codex')).toBe('codex')
    expect(normalizeCliAdapterOptionValue(' codex ')).toBe('codex')
    expect(normalizeCliAdapterOptionValue('codex@0.130.0')).toBe('codex')
  })

  it('parses adapter CLI version selectors', () => {
    expect(parseCliAdapterOptionValue('codex@0.130.0')).toEqual({
      adapter: 'codex',
      cliVersion: '0.130.0'
    })
    expect(parseCliAdapterOptionValue('adapter-codex@latest')).toEqual({
      adapter: 'codex',
      cliVersion: 'latest'
    })
    expect(parseCliAdapterOptionValue('@scope/adapter-corp@1.2.3')).toEqual({
      adapter: '@scope/adapter-corp',
      cliVersion: '1.2.3'
    })
  })

  it('parses -A as the adapter shorthand', () => {
    const command = new Command()
    command.addOption(createAdapterOption('Adapter to use'))
    command.parse(['-A', 'claude'], { from: 'user' })

    expect(command.opts<{ adapter?: string }>().adapter).toBe('claude-code')
  })

  it('keeps -A adapter version selectors when enabled', () => {
    const command = new Command()
    command.addOption(createAdapterOption('Adapter to use', { allowCliVersion: true }))
    command.parse(['-A', 'adapter-codex@0.130.0'], { from: 'user' })

    expect(command.opts<{ adapter?: string }>().adapter).toBe('codex@0.130.0')
  })

  it('persists adapter CLI version selectors to user adapter config', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-cli-adapter-version-'))

    try {
      await writeFile(
        join(workspace, '.oo.config.json'),
        `${
          JSON.stringify(
            {
              adapters: {
                codex: {
                  cli: {
                    source: 'managed'
                  },
                  effort: 'high'
                }
              }
            },
            null,
            2
          )
        }\n`
      )
      await writeFile(
        join(workspace, 'user-base.config.json'),
        `${
          JSON.stringify(
            {
              adapters: {
                codex: {
                  cli: {
                    package: '@base/codex'
                  },
                  effort: 'low'
                }
              }
            },
            null,
            2
          )
        }\n`
      )
      await writeFile(
        join(workspace, '.oo.dev.config.json'),
        `${
          JSON.stringify(
            {
              extend: './user-base.config.json',
              adapters: {
                codex: {
                  cli: {
                    source: 'system'
                  }
                }
              }
            },
            null,
            2
          )
        }\n`
      )

      await persistAdapterCliVersionSelection({
        adapter: 'codex',
        cwd: workspace,
        env: {},
        version: '0.130.0'
      })

      const projectConfig = JSON.parse(await readFile(join(workspace, '.oo.config.json'), 'utf8')) as {
        adapters?: {
          codex?: {
            cli?: {
              version?: string
            }
            effort?: string
          }
        }
      }
      const userConfig = JSON.parse(await readFile(join(workspace, '.oo.dev.config.json'), 'utf8')) as {
        extend?: string
        adapters?: {
          codex?: {
            cli?: {
              source?: string
              version?: string
            }
            effort?: string
          }
        }
      }
      expect(projectConfig.adapters?.codex?.cli?.version).toBeUndefined()
      expect(projectConfig.adapters?.codex?.effort).toBe('high')
      expect(userConfig.extend).toBe('./user-base.config.json')
      expect(userConfig.adapters?.codex?.cli).toEqual({
        source: 'system',
        version: '0.130.0'
      })
      expect(userConfig.adapters?.codex?.effort).toBeUndefined()
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('parses positive print idle timeout seconds', () => {
    expect(parsePrintIdleTimeoutSeconds('2')).toBe(2)
    expect(parsePrintIdleTimeoutSeconds('0.25')).toBe(0.25)
    expect(() => parsePrintIdleTimeoutSeconds('0')).toThrow('--print-idle-timeout must be a positive number')
    expect(() => parsePrintIdleTimeoutSeconds('abc')).toThrow('--print-idle-timeout must be a positive number')
  })

  it('resets the print idle timeout after each adapter event', () => {
    vi.useFakeTimers()
    try {
      const onTimeout = vi.fn()
      const controller = createPrintIdleTimeoutController({
        timeoutSeconds: 1,
        onTimeout
      })

      controller.start()
      vi.advanceTimersByTime(999)
      controller.recordEvent()
      vi.advanceTimersByTime(999)

      expect(onTimeout).not.toHaveBeenCalled()

      vi.advanceTimersByTime(1)

      expect(onTimeout).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps direct mode for shorthand runs when print behavior is inferred separately', () => {
    expect(resolveRunMode(false, 'default', 'direct')).toBe('direct')
    expect(resolveRunMode(false, 'default', 'stream')).toBe('direct')
  })

  it('rejects startup-only flags when resuming a cached session', () => {
    const command = new Command()
    command
      .option('--adapter <adapter>')
      .option('--account <account>')
      .option('--permission-mode <mode>')
      .option('--session-id <id>')
      .option('--no-inject-default-system-prompt')
      .option('--no-default-oneworks-mcp-server')

    command.parse(['--adapter', 'codex', '--account', 'work', '--permission-mode', 'dontAsk', '--session-id', 'abc'], {
      from: 'user'
    })

    expect(getDisallowedResumeFlags({
      print: false,
      adapter: 'codex',
      account: 'work',
      permissionMode: 'dontAsk',
      sessionId: 'abc',
      model: 'gpt-5.4',
      effort: 'high',
      includeTool: ['read'],
      excludeTool: ['edit']
    }, command)).toEqual(['--adapter', '--account', '--session-id'])
  })

  it('merges resume-time model, effort, and tool overrides into cached adapter options', () => {
    expect(resolveResumeAdapterOptions({
      runtime: 'cli',
      sessionId: 'session-demo',
      mode: 'direct',
      model: 'gpt-5.4',
      effort: 'medium',
      tools: {
        include: ['read'],
        exclude: ['edit']
      }
    }, {
      model: 'gpt-5.4-mini',
      effort: 'high',
      includeTool: ['grep'],
      excludeTool: ['bash']
    })).toEqual({
      runtime: 'cli',
      sessionId: 'session-demo',
      mode: 'direct',
      model: 'gpt-5.4-mini',
      effort: 'high',
      tools: {
        include: ['read', 'grep'],
        exclude: ['edit', 'bash']
      }
    })
  })

  it('parses structured stream-json input into a message control event', () => {
    expect(parseCliInputControlEvent({
      type: 'message',
      content: [
        { type: 'text', text: 'hello' }
      ]
    })).toEqual({
      type: 'message',
      content: [
        { type: 'text', text: 'hello' }
      ]
    })
  })

  it('parses interrupt control input', () => {
    expect(parseCliInputControlEvent({ type: 'interrupt' })).toEqual({ type: 'interrupt' })
  })

  it('rejects unsupported control input payloads', () => {
    expect(() => parseCliInputControlEvent({ type: 'message' })).toThrow('Message input requires "content" or "text".')
    expect(() => parseCliInputControlEvent({ type: 'unknown' })).toThrow('Unsupported input event type: unknown')
  })

  it('prints the last assistant text for text output mode on stop', () => {
    const log = vi.fn()
    const errorLog = vi.fn()
    const requestExit = vi.fn()

    const stateAfterMessage = handlePrintEvent({
      event: {
        type: 'message',
        data: {
          id: 'msg-3',
          role: 'assistant',
          content: 'partial answer',
          createdAt: Date.now()
        }
      },
      outputFormat: 'text',
      lastAssistantText: undefined,
      didExitAfterError: false,
      log,
      errorLog,
      requestExit
    })

    expect(stateAfterMessage.lastAssistantText).toBe('partial answer')
    expect(log).not.toHaveBeenCalled()

    const stateAfterStop = handlePrintEvent({
      event: { type: 'stop' },
      outputFormat: 'text',
      lastAssistantText: stateAfterMessage.lastAssistantText,
      didExitAfterError: stateAfterMessage.didExitAfterError,
      log,
      errorLog,
      requestExit
    })

    expect(stateAfterStop.lastAssistantText).toBe('partial answer')
    expect(log).toHaveBeenCalledWith('partial answer')
    expect(requestExit).toHaveBeenCalledWith(0)
  })

  it('prints adapter errors for fatal text-mode failures', () => {
    const log = vi.fn()
    const errorLog = vi.fn()
    const requestExit = vi.fn()

    const nextState = handlePrintEvent({
      event: {
        type: 'error',
        data: {
          message: 'fatal failure',
          details: { reason: 'network' },
          fatal: true
        }
      },
      outputFormat: 'text',
      lastAssistantText: 'previous answer',
      didExitAfterError: false,
      log,
      errorLog,
      requestExit
    })

    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('fatal failure'))
    expect(requestExit).toHaveBeenCalledWith(1)
    expect(nextState.didExitAfterError).toBe(true)
  })

  it('prints the stop payload as JSON for json output mode', () => {
    const log = vi.fn()
    const errorLog = vi.fn()
    const requestExit = vi.fn()

    const stateAfterMessage = handlePrintEvent({
      event: {
        type: 'message',
        data: {
          id: 'msg-4',
          role: 'assistant',
          content: 'ignored before stop',
          createdAt: Date.now()
        }
      },
      outputFormat: 'json',
      lastAssistantText: undefined,
      didExitAfterError: false,
      log,
      errorLog,
      requestExit
    })

    expect(stateAfterMessage.lastAssistantText).toBe('ignored before stop')
    expect(log).not.toHaveBeenCalled()

    handlePrintEvent({
      event: {
        type: 'stop',
        data: {
          id: 'msg-5',
          role: 'assistant',
          content: 'final answer',
          createdAt: Date.now()
        }
      },
      outputFormat: 'json',
      lastAssistantText: stateAfterMessage.lastAssistantText,
      didExitAfterError: stateAfterMessage.didExitAfterError,
      log,
      errorLog,
      requestExit
    })

    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]?.[0]).toContain('"type": "stop"')
    expect(log.mock.calls[0]?.[0]).toContain('"final answer"')
    expect(requestExit).toHaveBeenCalledWith(0)
  })

  it('streams every event as JSON for stream-json output mode without suppressing stop', () => {
    const log = vi.fn()
    const errorLog = vi.fn()
    const requestExit = vi.fn()

    const stateAfterInit = handlePrintEvent({
      event: {
        type: 'init',
        data: {
          uuid: 'session-1',
          model: 'mock-model',
          version: 'test',
          tools: [],
          slashCommands: [],
          cwd: '/tmp/project',
          agents: []
        }
      },
      outputFormat: 'stream-json',
      lastAssistantText: undefined,
      didExitAfterError: false,
      log,
      errorLog,
      requestExit
    })

    expect(stateAfterInit.lastAssistantText).toBeUndefined()

    const stateAfterMessage = handlePrintEvent({
      event: {
        type: 'message',
        data: {
          id: 'msg-6',
          role: 'assistant',
          content: 'stream body',
          createdAt: Date.now()
        }
      },
      outputFormat: 'stream-json',
      lastAssistantText: stateAfterInit.lastAssistantText,
      didExitAfterError: stateAfterInit.didExitAfterError,
      log,
      errorLog,
      requestExit
    })

    handlePrintEvent({
      event: { type: 'stop' },
      outputFormat: 'stream-json',
      lastAssistantText: stateAfterMessage.lastAssistantText,
      didExitAfterError: stateAfterMessage.didExitAfterError,
      log,
      errorLog,
      requestExit
    })

    expect(stateAfterMessage.lastAssistantText).toBe('stream body')
    expect(log).toHaveBeenCalledTimes(3)
    expect(log.mock.calls[0]?.[0]).toContain('"type": "init"')
    expect(log.mock.calls[1]?.[0]).toContain('"type": "message"')
    expect(log.mock.calls[2]?.[0]).toContain('"type": "stop"')
    expect(requestExit).not.toHaveBeenCalled()
  })

  it('exits on stop in stream-json mode after stdin has been exhausted', () => {
    const log = vi.fn()
    const errorLog = vi.fn()
    const requestExit = vi.fn()

    handlePrintEvent({
      event: { type: 'stop' },
      outputFormat: 'stream-json',
      lastAssistantText: 'stream body',
      didExitAfterError: false,
      stopExitsStreamJson: true,
      log,
      errorLog,
      requestExit
    })

    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]?.[0]).toContain('"type": "stop"')
    expect(requestExit).toHaveBeenCalledWith(0)
  })

  it('suppresses the resume hint for successful print sessions', () => {
    expect(shouldPrintResumeHint({
      shouldPrintOutput: true,
      status: 'completed'
    })).toBe(false)
    expect(shouldPrintResumeHint({
      shouldPrintOutput: true,
      status: 'failed'
    })).toBe(true)
    expect(shouldPrintResumeHint({
      shouldPrintOutput: false,
      status: 'completed'
    })).toBe(true)
  })

  it('rejects unsupported output format values at parse time', async () => {
    const program = new Command()
    program.exitOverride()
    program.configureOutput({
      writeErr: () => {}
    })
    registerRunCommand(program)

    await expect(program.parseAsync([
      '__run',
      '--output-format',
      'invalid-format'
    ], { from: 'user' })).rejects.toMatchObject({
      code: 'commander.invalidArgument'
    })
  })
})
