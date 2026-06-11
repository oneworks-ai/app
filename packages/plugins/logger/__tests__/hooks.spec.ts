import { lstat, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import createLoggerPlugin from '#~/hooks.js'

describe('logger plugin', () => {
  const loggerPlugin = createLoggerPlugin()
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  })

  it('escapes markdown fence lines in bash tool logs', async () => {
    const info = vi.fn()
    const next = vi.fn().mockResolvedValue({ continue: true })
    const postToolUse = loggerPlugin.PostToolUse

    expect(postToolUse).toBeTypeOf('function')

    const result = await postToolUse?.(
      {
        logger: { info }
      } as never,
      {
        toolName: 'Bash',
        adapter: 'codex',
        toolInput: {
          description: 'Bash output\n```bash\ncat README.md\n```',
          command: 'printf "demo"\n```bash\ncat README.md\n```'
        },
        toolResponse: {
          stdout: 'stdout line\n```bash\necho "ok"\n```',
          stderr: '```bash\necho "err"\n```'
        }
      } as never,
      next
    )

    expect(result).toEqual({ continue: true })
    expect(next).toHaveBeenCalledOnce()
    expect(info).toHaveBeenCalledOnce()

    const [toolName, description, textBlock] = info.mock.calls[0] ?? []

    expect(toolName).toBe('Bash')
    expect(description).toBe('Bash output\n\\`\\`\\`bash\ncat README.md\n\\`\\`\\`')
    expect(textBlock).toContain('\n```text\n')
    expect(textBlock).toContain('> printf "demo"\n\\`\\`\\`bash\ncat README.md\n\\`\\`\\`')
    expect(textBlock).toContain('stdout: stdout line\n\\`\\`\\`bash\necho "ok"\n\\`\\`\\`')
    expect(textBlock).toContain('stderr: \\`\\`\\`bash\necho "err"\n\\`\\`\\`')
    expect(textBlock).toContain('\n```')
  })

  it('externalizes large structured input values into payload files', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ow-plugin-logger-'))
    tempDirs.push(cwd)
    const projectHome = join(cwd, '.oneworks-projects', 'demo-project')

    const info = vi.fn()
    const next = vi.fn().mockResolvedValue({ continue: true })
    const userPromptSubmit = loggerPlugin.UserPromptSubmit
    const prompt = 'x'.repeat(70 * 1024)

    expect(userPromptSubmit).toBeTypeOf('function')

    const result = await userPromptSubmit?.(
      {
        logger: {
          info,
          stream: {
            path: join(projectHome, 'logs/task-1/session-1.log.md')
          }
        }
      } as never,
      {
        cwd,
        sessionId: 'session-1',
        hookEventName: 'UserPromptSubmit',
        prompt
      } as never,
      next
    )

    expect(result).toEqual({ continue: true })
    expect(next).toHaveBeenCalledOnce()
    expect(info).toHaveBeenCalledOnce()

    const [payload] = info.mock.calls[0] ?? []
    const loggedInput = payload as {
      prompt?: {
        $loggerPayloadRef?: boolean
        path?: string
        hash?: string
        bytes?: number
        type?: string
      }
    }

    expect(loggedInput.prompt).toMatchObject({
      $loggerPayloadRef: true,
      type: 'string'
    })
    expect(loggedInput.prompt?.path).toContain(join(projectHome, 'logs/task-1/session-1.payloads'))
    expect(loggedInput.prompt?.hash).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(loggedInput.prompt?.bytes).toBeGreaterThan(prompt.length)
    expect(JSON.parse(await readFile(loggedInput.prompt?.path ?? '', 'utf8'))).toBe(prompt)
    expect((await lstat(loggedInput.prompt?.path ?? '')).isSymbolicLink()).toBe(true)
    expect(await realpath(loggedInput.prompt?.path ?? '')).toContain(
      join(projectHome, 'caches/.logger-payloads/sha256')
    )
  })

  it('uses logger path metadata when log directories also contain logs segments', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ow-plugin-logger-'))
    tempDirs.push(cwd)
    const projectHome = join(cwd, 'logs', 'demo-project')
    const logsRoot = join(projectHome, 'logs')
    const cachesRoot = join(projectHome, 'caches')

    const info = vi.fn()
    const next = vi.fn().mockResolvedValue({ continue: true })
    const prompt = 'x'.repeat(70 * 1024)

    await loggerPlugin.UserPromptSubmit?.(
      {
        logger: {
          info,
          paths: {
            logFilePath: join(logsRoot, 'logs', 'task-1', 'session-1.log.md'),
            logsRoot,
            cachesRoot
          },
          stream: {
            path: join(logsRoot, 'logs', 'task-1', 'session-1.log.md')
          }
        }
      } as never,
      {
        cwd,
        sessionId: 'session-1',
        hookEventName: 'UserPromptSubmit',
        prompt
      } as never,
      next
    )

    const [payload] = info.mock.calls[0] ?? []
    const loggedInput = payload as { prompt?: { path?: string } }

    expect(await realpath(loggedInput.prompt?.path ?? '')).toContain(
      join(cachesRoot, '.logger-payloads/sha256')
    )
  })

  it('externalizes large bash stdout before rendering the markdown block', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ow-plugin-logger-'))
    tempDirs.push(cwd)

    const info = vi.fn()
    const next = vi.fn().mockResolvedValue({ continue: true })
    const postToolUse = loggerPlugin.PostToolUse
    const stdout = 'stdout\n'.repeat(12 * 1024)

    expect(postToolUse).toBeTypeOf('function')

    await postToolUse?.(
      {
        logger: {
          info,
          stream: {
            path: join(cwd, 'logs/task-1/session-1.log.md')
          }
        }
      } as never,
      {
        toolName: 'Bash',
        adapter: 'codex',
        toolInput: {
          description: 'large command',
          command: 'printf stdout'
        },
        toolResponse: {
          stdout,
          stderr: ''
        }
      } as never,
      next
    )

    const [, , textBlock] = info.mock.calls[0] ?? []

    expect(String(textBlock)).toContain('stdout: [payload externalized:')
    expect(String(textBlock)).not.toContain(stdout)
    const payloadPath = String(textBlock).match(/payload externalized: ([^ ]+) /)?.[1]

    expect(payloadPath).toBeTruthy()
    expect(JSON.parse(await readFile(payloadPath ?? '', 'utf8'))).toBe(stdout)
  })

  it('deduplicates identical payload content through the cache store', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ow-plugin-logger-'))
    tempDirs.push(cwd)

    const info = vi.fn()
    const next = vi.fn().mockResolvedValue({ continue: true })
    const prompt = 'same payload\n'.repeat(8 * 1024)

    for (const sessionId of ['session-1', 'session-2']) {
      await loggerPlugin.UserPromptSubmit?.(
        {
          logger: {
            info,
            stream: {
              path: join(cwd, 'logs/task-1', `${sessionId}.log.md`)
            }
          }
        } as never,
        {
          cwd,
          sessionId,
          hookEventName: 'UserPromptSubmit',
          prompt
        } as never,
        next
      )
    }

    const firstPayload = info.mock.calls[0]?.[0] as { prompt?: { path?: string; hash?: string } }
    const secondPayload = info.mock.calls[1]?.[0] as { prompt?: { path?: string; hash?: string } }

    expect(firstPayload.prompt?.path).not.toBe(secondPayload.prompt?.path)
    expect(firstPayload.prompt?.hash).toBe(secondPayload.prompt?.hash)
    expect(await realpath(firstPayload.prompt?.path ?? '')).toBe(await realpath(secondPayload.prompt?.path ?? ''))
  })

  it('uses configured payload byte limit', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ow-plugin-logger-'))
    tempDirs.push(cwd)

    const configuredLoggerPlugin = createLoggerPlugin({
      largePayloadByteLimit: 16
    })
    const info = vi.fn()
    const next = vi.fn().mockResolvedValue({ continue: true })

    await configuredLoggerPlugin.UserPromptSubmit?.(
      {
        logger: {
          info,
          stream: {
            path: join(cwd, 'logs/task-1/session-1.log.md')
          }
        }
      } as never,
      {
        cwd,
        sessionId: 'session-1',
        hookEventName: 'UserPromptSubmit',
        prompt: 'small but above configured limit'
      } as never,
      next
    )

    const [payload] = info.mock.calls[0] ?? []
    expect(payload).toMatchObject({
      $loggerPayloadRef: true
    })
  })

  it('can disable payload externalization through config', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ow-plugin-logger-'))
    tempDirs.push(cwd)

    const configuredLoggerPlugin = createLoggerPlugin({
      externalizeLargePayloads: false,
      largePayloadByteLimit: 16
    })
    const info = vi.fn()
    const next = vi.fn().mockResolvedValue({ continue: true })
    const prompt = 'x'.repeat(70 * 1024)

    await configuredLoggerPlugin.UserPromptSubmit?.(
      {
        logger: {
          info,
          stream: {
            path: join(cwd, 'logs/task-1/session-1.log.md')
          }
        }
      } as never,
      {
        cwd,
        sessionId: 'session-1',
        hookEventName: 'UserPromptSubmit',
        prompt
      } as never,
      next
    )

    const [payload] = info.mock.calls[0] ?? []
    expect((payload as { prompt?: string }).prompt).toBe(prompt)
  })
})
