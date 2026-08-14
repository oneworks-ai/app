import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { mapOneWorksHookOutputToQwen, mapQwenHookInputToOneWorks, runQwenHookBridge } from '../src/hook-bridge'
import { QWEN_NATIVE_HOOK_EVENTS, buildQwenNativeHooksSettings } from '../src/runtime/native-hooks'

const { executeHookInputMock, readHookInputMock } = vi.hoisted(() => ({
  executeHookInputMock: vi.fn(),
  readHookInputMock: vi.fn()
}))

const tempDirs: string[] = []

vi.mock('@oneworks/hooks', async (importOriginal) => ({
  ...await importOriginal<typeof import('@oneworks/hooks')>(),
  executeHookInput: executeHookInputMock,
  readHookInput: readHookInputMock
}))

describe('qwen Code native hook bridge', () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
  })

  it('maps native tool events into the unified blocking hook contract', () => {
    expect(mapQwenHookInputToOneWorks({
      cwd: '/workspace',
      hookEventName: 'PreToolUse',
      sessionId: 'qwen-session',
      toolName: 'run_shell_command',
      toolInput: { command: 'git status' }
    })).toEqual(expect.objectContaining({
      adapter: 'qwen-code',
      canBlock: true,
      hookEventName: 'PreToolUse',
      hookSource: 'native',
      sessionId: 'qwen-session',
      toolInput: { command: 'git status' },
      toolName: 'run_shell_command'
    }))
  })

  it('maps permission decisions and additional context back to Qwen fields', () => {
    expect(mapOneWorksHookOutputToQwen('PreToolUse', {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'blocked by fixture'
      }
    })).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'blocked by fixture'
      }
    })
    expect(mapOneWorksHookOutputToQwen('UserPromptSubmit', {
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: 'fixture context'
      }
    })).toEqual({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: 'fixture context'
      }
    })
  })

  it('installs every verified 0.21.11 native event with the long-running command timeout', () => {
    const settings = buildQwenNativeHooksSettings({
      __ONEWORKS_PROJECT_QWEN_CODE_NATIVE_HOOKS_AVAILABLE__: '1',
      __ONEWORKS_PROJECT_QWEN_CODE_HOOK_COMMAND__: 'node call-hook.js'
    })

    expect(Object.keys(settings.hooks ?? {})).toEqual(QWEN_NATIVE_HOOK_EVENTS)
    for (const groups of Object.values(settings.hooks ?? {})) {
      expect(groups).toEqual([
        expect.objectContaining({
          hooks: [{ type: 'command', command: 'node call-hook.js', timeout: 600_000 }]
        })
      ])
    }
    expect(settings.hooksConfig).toEqual({ enabled: true })
  })

  it('does not install ambient hooks when the isolated bridge is unavailable', () => {
    expect(buildQwenNativeHooksSettings({
      __ONEWORKS_PROJECT_QWEN_CODE_NATIVE_HOOKS_AVAILABLE__: '0',
      __ONEWORKS_PROJECT_QWEN_CODE_HOOK_COMMAND__: 'node call-hook.js'
    })).toEqual({})
  })

  it('redacts raw hook errors before writing a fail-open bridge response', async () => {
    const secret = 'hook-bridge-secret-12345'
    const githubSecret = 'hook-github-secret-12345'
    const awsSecret = 'hook-aws-secret-12345'
    const qwenHome = '/private/hook-qwen-home'
    const runtimeDir = '/private/hook-qwen-runtime'
    vi.stubEnv('OPENAI_API_KEY', secret)
    vi.stubEnv('GITHUB_TOKEN', githubSecret)
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', awsSecret)
    vi.stubEnv('QWEN_HOME', qwenHome)
    vi.stubEnv('QWEN_RUNTIME_DIR', runtimeDir)
    readHookInputMock.mockRejectedValueOnce(
      new Error(
        `apiKey=${secret} github=${Buffer.from(githubSecret).toString('base64url')} ` +
          `aws=${encodeURIComponent(awsSecret)} home=${qwenHome} runtime=${encodeURIComponent(runtimeDir)}`
      )
    )
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await runQwenHookBridge()

    const output = String(write.mock.calls[0]?.[0])
    expect(output).not.toContain(secret)
    expect(output).not.toContain(githubSecret)
    expect(output).not.toContain(Buffer.from(githubSecret).toString('base64url'))
    expect(output).not.toContain(awsSecret)
    expect(output).not.toContain(encodeURIComponent(awsSecret))
    expect(output).not.toContain(qwenHome)
    expect(output).not.toContain(runtimeDir)
    expect(output).not.toContain(encodeURIComponent(runtimeDir))
    expect(output).toContain('[REDACTED]')
    expect(output).toContain('[QWEN_HOME]')
    expect(output).toContain('[QWEN_RUNTIME_DIR]')
    expect(JSON.parse(output)).toEqual(expect.objectContaining({ continue: true }))
    expect(executeHookInputMock).not.toHaveBeenCalled()
  })

  it('redacts exact short opaque-header assignments from hook errors without global corruption', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-qwen-hook-redaction-'))
    tempDirs.push(root)
    const qwenHome = join(root, 'qwen-home')
    await mkdir(qwenHome, { recursive: true })
    await writeFile(
      join(qwenHome, 'settings.json'),
      JSON.stringify({
        mcpServers: {
          http: {
            headers: { 'X-Opaque': 'a' },
            type: 'http',
            url: 'https://mcp.example.test'
          }
        }
      }),
      'utf8'
    )
    vi.stubEnv('QWEN_HOME', qwenHome)
    readHookInputMock.mockRejectedValueOnce(
      new Error('cwd=/tmp/a-project X-Opaque=a | X-Opaque: a | {"X-Opaque":"a"} | Unrelated=a')
    )
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await runQwenHookBridge()

    const output = String(write.mock.calls[0]?.[0])
    expect(output).not.toContain('X-Opaque=a')
    expect(output).not.toContain('X-Opaque: a')
    expect(output).not.toContain('"X-Opaque":"a"')
    expect(output).toContain('cwd=/tmp/a-project')
    expect(output).toContain('Unrelated=a')
  })
})
