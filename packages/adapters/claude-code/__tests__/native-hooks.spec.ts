import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { ensureClaudeNativeHooksInstalled } from '../src/hooks/native'

const tempDirs: string[] = []

const createWorkspace = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'claude-hooks-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('ensureClaudeNativeHooksInstalled', () => {
  it('writes managed hooks into the isolated mock home settings file', async () => {
    const workspace = await createWorkspace()
    const mockHome = join(workspace, '.oo', '.mock')
    const ctx = {
      cwd: workspace,
      env: {
        HOME: mockHome
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      },
      assets: {
        hookPlugins: [
          {
            id: 'hookPlugin:project:logger'
          }
        ]
      }
    } as any

    const installed = await ensureClaudeNativeHooksInstalled(ctx)
    const settings = JSON.parse(
      await readFile(join(mockHome, '.claude', 'settings.json'), 'utf8')
    ) as {
      hooks?: Record<string, Array<{ matcher?: string }>>
    }

    expect(installed).toBe(true)
    expect(ctx.env.__ONEWORKS_PROJECT_CLAUDE_NATIVE_HOOKS_AVAILABLE__).toBe('1')
    expect(settings.hooks?.SessionStart).toHaveLength(1)
    expect(settings.hooks?.PreToolUse?.[0]?.matcher).toBe('.*')
    expect(settings.hooks?.PostToolUse?.[0]?.matcher).toBe('.*')
    expect(JSON.stringify(settings)).toContain('call-hook.js')
    expect(JSON.stringify(settings)).not.toContain('claude-hook.js')
  })

  it('does not duplicate native hooks already provided by project-level oneworks-call-hook settings', async () => {
    const workspace = await createWorkspace()
    const mockHome = join(workspace, '.oo', '.mock')
    await mkdir(join(workspace, '.claude'), { recursive: true })
    await writeFile(
      join(workspace, '.claude', 'settings.json'),
      JSON.stringify(
        {
          hooks: {
            SessionStart: [{
              matcher: '*',
              hooks: [{ type: 'command', command: '$CLAUDE_PROJECT_DIR/node_modules/.bin/oneworks-call-hook' }]
            }],
            UserPromptSubmit: [{
              matcher: '*',
              hooks: [{ type: 'command', command: '$CLAUDE_PROJECT_DIR/node_modules/.bin/oneworks-call-hook' }]
            }],
            PreToolUse: [{
              matcher: '*',
              hooks: [{ type: 'command', command: '$CLAUDE_PROJECT_DIR/node_modules/.bin/oneworks-call-hook' }]
            }],
            PostToolUse: [{
              matcher: '*',
              hooks: [{ type: 'command', command: '$CLAUDE_PROJECT_DIR/node_modules/.bin/oneworks-call-hook' }]
            }],
            Stop: [{
              matcher: '*',
              hooks: [{ type: 'command', command: '$CLAUDE_PROJECT_DIR/node_modules/.bin/oneworks-call-hook' }]
            }]
          }
        },
        null,
        2
      )
    )

    const ctx = {
      cwd: workspace,
      env: {
        HOME: mockHome
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      },
      assets: {
        hookPlugins: [
          {
            id: 'hookPlugin:project:logger'
          }
        ]
      }
    } as any

    const installed = await ensureClaudeNativeHooksInstalled(ctx)
    const settings = JSON.parse(
      await readFile(join(mockHome, '.claude', 'settings.json'), 'utf8')
    ) as {
      hooks?: Record<string, Array<{ matcher?: string }>>
    }

    expect(installed).toBe(true)
    expect(ctx.env.__ONEWORKS_PROJECT_CLAUDE_NATIVE_HOOKS_AVAILABLE__).toBe('1')
    expect(settings.hooks?.SessionStart ?? []).toEqual([])
    expect(settings.hooks?.UserPromptSubmit ?? []).toEqual([])
    expect(settings.hooks?.PreToolUse ?? []).toEqual([])
    expect(settings.hooks?.PostToolUse ?? []).toEqual([])
    expect(settings.hooks?.Stop ?? []).toEqual([])
    expect(settings.hooks?.Notification).toHaveLength(1)
    expect(JSON.stringify(settings)).toContain('call-hook.js')
  })
})
