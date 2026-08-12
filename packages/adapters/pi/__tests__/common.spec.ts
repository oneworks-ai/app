import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { isPiNodeVersionSupported } from '#~/paths.js'
import { buildPiArgs, resolvePiTools } from '#~/runtime/common/args.js'
import { resolvePiModel } from '#~/runtime/common/model.js'
import {
  PI_PERMISSION_PREFIX,
  buildPiPermissionExtension,
  parsePiPermissionTitle,
  readPiPersistedSessionPermissionState
} from '#~/runtime/common/permission.js'
import type { AdapterCtx } from '@oneworks/types'
import { resolvePermissionMirrorPath } from '@oneworks/utils'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

describe('pi runtime mappings', () => {
  it('fails closed when its persisted permission mirror is corrupt', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'oneworks-pi-corrupt-mirror-'))
    tempDirs.push(cwd)
    const env = { __ONEWORKS_PROJECT_HOME_PROJECT_DIR__: cwd }
    const mirrorPath = resolvePermissionMirrorPath(cwd, 'pi', 'session-corrupt', env)
    await mkdir(dirname(mirrorPath), { recursive: true })
    await writeFile(mirrorPath, '{not-json', 'utf8')

    await expect(readPiPersistedSessionPermissionState({ cwd, env } as unknown as AdapterCtx, 'session-corrupt'))
      .rejects.toThrow()
  })

  it('fails closed when its persisted permission mirror cannot be read', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'oneworks-pi-unreadable-mirror-'))
    tempDirs.push(cwd)
    const env = { __ONEWORKS_PROJECT_HOME_PROJECT_DIR__: cwd }
    const mirrorPath = resolvePermissionMirrorPath(cwd, 'pi', 'session-eacces', env)
    const error = Object.assign(new Error('permission denied'), { code: 'EACCES' })
    const readMirror = vi.fn().mockRejectedValueOnce(error)

    await expect(readPiPersistedSessionPermissionState(
      { cwd, env } as unknown as AdapterCtx,
      'session-eacces',
      readMirror
    ))
      .rejects.toThrow('permission denied')
    expect(readMirror).toHaveBeenCalledWith(mirrorPath, 'utf8')
  })

  it.each([
    ['an empty object', {}],
    ['another adapter', {
      adapter: 'codex',
      sessionId: 'session-invalid',
      permissionState: { allow: [], deny: [], onceAllow: [], onceDeny: [] }
    }],
    ['another session', {
      adapter: 'pi',
      sessionId: 'other-session',
      permissionState: { allow: [], deny: [], onceAllow: [], onceDeny: [] }
    }],
    ['a missing state array', {
      adapter: 'pi',
      sessionId: 'session-invalid',
      permissionState: { allow: [], deny: [], onceAllow: [] }
    }]
  ])('fails closed when its persisted permission mirror has %s', async (_label, mirror) => {
    const cwd = await mkdtemp(join(tmpdir(), 'oneworks-pi-invalid-mirror-'))
    tempDirs.push(cwd)
    const env = { __ONEWORKS_PROJECT_HOME_PROJECT_DIR__: cwd }
    const mirrorPath = resolvePermissionMirrorPath(cwd, 'pi', 'session-invalid', env)
    await mkdir(dirname(mirrorPath), { recursive: true })
    await writeFile(mirrorPath, JSON.stringify(mirror), 'utf8')

    await expect(readPiPersistedSessionPermissionState(
      { cwd, env } as unknown as AdapterCtx,
      'session-invalid'
    )).rejects.toThrow('invalid identity or permission state')
  })
  it('rejects Node runtimes below the upstream minimum', () => {
    expect(isPiNodeVersionSupported('22.18.0')).toBe(false)
    expect(isPiNodeVersionSupported('22.19.0')).toBe(true)
    expect(isPiNodeVersionSupported('23.0.0')).toBe(true)
  })

  it('routes a Responses model service without writing its API key into models.json', () => {
    const resolved = resolvePiModel({
      model: 'team,gpt-5.6-terra',
      modelServices: {
        team: {
          apiBaseUrl: 'https://gateway.example.test/v1/responses',
          apiProtocol: 'openai-responses',
          apiKey: 'top-secret',
          maxOutputTokens: 32000,
          extra: {
            pi: { input: ['text', 'image'] }
          }
        }
      }
    })

    expect(resolved.cliModel).toMatch(/^oneworks-team-[a-f0-9]{8}\/gpt-5\.6-terra$/)
    expect(JSON.stringify(resolved.modelsConfig)).not.toContain('top-secret')
    expect(JSON.stringify(resolved.modelsConfig)).toContain('openai-responses')
    expect(JSON.stringify(resolved.modelsConfig)).toContain('"authHeader":false')
    expect(Object.values(resolved.env)).toContain('top-secret')
    expect(JSON.stringify(resolved.modelsConfig)).toContain('https://gateway.example.test/v1')
  })

  it('fails closed for a declared Gemini Interactions service', () => {
    expect(() =>
      resolvePiModel({
        model: 'gemini,gemini-3',
        modelServices: {
          gemini: {
            apiBaseUrl: 'https://example.test/v1beta',
            apiProtocol: 'gemini-interactions',
            apiKey: 'secret'
          }
        }
      })
    ).toThrow(/does not support Gemini Interactions/)
  })

  it('does not replace header-only authentication with a dummy bearer token', () => {
    const resolved = resolvePiModel({
      model: 'local,header-model',
      modelServices: {
        local: {
          apiBaseUrl: 'http://127.0.0.1:9876/v1',
          apiKey: '',
          models: ['header-model'],
          extra: { pi: { headers: { Authorization: 'Custom secret' } } }
        }
      }
    })

    expect(resolved.modelsConfig).toEqual(expect.objectContaining({
      providers: expect.objectContaining({
        'oneworks-local-25bf8e1a': expect.objectContaining({ authHeader: false })
      })
    }))
    expect(Object.values(resolved.env)).toContain('Custom secret')
  })

  it('normalizes the official Anthropic API root before the SDK appends /v1/messages', () => {
    const resolved = resolvePiModel({
      model: 'anthropic,claude-sonnet-4',
      modelServices: {
        anthropic: {
          apiBaseUrl: 'https://api.anthropic.com/v1',
          apiKey: 'secret',
          models: ['claude-sonnet-4'],
          provider: 'anthropic'
        }
      }
    })

    expect(resolved.modelsConfig).toEqual(expect.objectContaining({
      providers: expect.objectContaining({
        'oneworks-anthropic-c70eca6b': expect.objectContaining({
          api: 'anthropic-messages',
          authHeader: false,
          baseUrl: 'https://api.anthropic.com'
        })
      })
    }))
  })

  it('keeps the official Gemini OpenAI-compatible catalog route on the OpenAI transport', () => {
    const resolved = resolvePiModel({
      model: 'google-gemini,gemini-2.5-pro',
      modelServices: {
        'google-gemini': {
          apiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          apiKey: 'secret',
          models: ['gemini-2.5-pro'],
          provider: 'google-gemini'
        }
      }
    })

    expect(resolved.modelsConfig).toEqual(expect.objectContaining({
      providers: expect.objectContaining({
        'oneworks-google-gemini-5d02d3ed': expect.objectContaining({
          api: 'openai-completions',
          authHeader: false,
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai'
        })
      })
    }))
  })

  it('maps tools and reasoning while protecting One Works-owned flags', () => {
    const options = {
      type: 'create' as const,
      runtime: 'cli' as const,
      sessionId: 'session-1',
      permissionMode: 'acceptEdits' as const,
      effort: 'ultra' as const,
      tools: { include: ['ReadFile', 'Shell', 'Glob'], exclude: ['Shell'] },
      assetPlan: {
        adapter: 'pi' as const,
        diagnostics: [],
        mcpServers: {},
        overlays: [{
          assetId: 'skill:review',
          kind: 'skill' as const,
          sourcePath: '/skills/review',
          targetPath: 'skills/review'
        }]
      },
      onEvent: () => undefined
    }
    expect(resolvePiTools(options)).toEqual(['read', 'find'])
    expect(resolvePiTools({ ...options, tools: { include: ['mcp__unsupported'] } })).toEqual([])
    expect(resolvePiTools({ ...options, tools: { include: ['review_changes'] } }, true)).toEqual(['review_changes'])
    expect(resolvePiTools({ ...options, tools: { include: ['mcp__unsupported'] } }, true)).toEqual([])
    const args = buildPiArgs({
      adapterConfig: {},
      mode: 'stream',
      model: { env: {}, reportedModel: 'default' },
      options,
      permissionExtensionPath: '/managed/permissions.mjs',
      sessionDir: '/sessions'
    })
    expect(args).toContain('max')
    expect(args).toContain('/skills/review')
    expect(args).toContain('read,find')

    const nativeExtensionArgs = buildPiArgs({
      adapterConfig: { enableNativeExtensions: true },
      mode: 'stream',
      model: { env: {}, reportedModel: 'default' },
      nativeExtensionPaths: ['/real-pi-agent/extensions'],
      options,
      permissionExtensionPath: '/managed/permissions.mjs',
      sessionDir: '/sessions'
    })
    expect(nativeExtensionArgs).not.toContain('--no-extensions')
    expect(nativeExtensionArgs).toContain('/real-pi-agent/extensions')

    expect(() =>
      buildPiArgs({
        adapterConfig: {},
        mode: 'stream',
        model: { env: {}, reportedModel: 'default' },
        options: { ...options, extraOptions: ['--session-dir=/escape'] },
        permissionExtensionPath: '/managed/permissions.mjs',
        sessionDir: '/sessions'
      })
    ).toThrow('managed by One Works')

    for (const extraOption of ['--list-models', '-r', '--print', '--models=other/*', '--version']) {
      expect(() =>
        buildPiArgs({
          adapterConfig: {},
          mode: 'stream',
          model: { env: {}, reportedModel: 'default' },
          options: { ...options, extraOptions: [extraOption] },
          permissionExtensionPath: '/managed/permissions.mjs',
          sessionDir: '/sessions'
        })
      ).toThrow('managed by One Works')
    }
  })

  it('builds a fail-closed permission extension with machine-readable requests', () => {
    const extension = buildPiPermissionExtension({
      configuredPermissions: { bash: 'deny', review_changes: 'ask' },
      guardUnknownTools: true,
      permissionMode: 'dontAsk',
      sessionId: 'session-1'
    })
    expect(extension).toContain("new Set(['bash', 'edit', 'write'])")
    expect(extension).toContain('"bash":"deny"')
    expect(extension).toContain('GUARD_UNKNOWN_TOOLS = true')
    expect(extension).toContain("configured === 'deny'")
    expect(extension).toContain("MODE !== 'dontAsk'")
    expect(extension).toContain('/api/interact/permission-check')
    expect(extension).toContain('{ signal: ctx.signal }')
    expect(extension).toContain('Blocked by One Works permission policy')
    expect(parsePiPermissionTitle(`${PI_PERMISSION_PREFIX}${
      JSON.stringify({
        toolName: 'bash',
        input: { command: 'git status' }
      })
    }`)).toEqual({ toolName: 'bash', input: { command: 'git status' } })
  })
})
