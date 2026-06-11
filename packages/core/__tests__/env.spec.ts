import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

describe('env helpers', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('forces debug level when __ONEWORKS_PROJECT_SERVER_DEBUG__ is enabled', async () => {
    const { resolveServerLogLevel } = await import('../src/env')

    expect(resolveServerLogLevel({
      __ONEWORKS_PROJECT_SERVER_LOG_LEVEL__: 'error',
      __ONEWORKS_PROJECT_SERVER_DEBUG__: 'true'
    })).toBe('debug')
  })

  it('defaults to info when no debug config is provided', async () => {
    const { resolveServerLogLevel } = await import('../src/env')

    expect(resolveServerLogLevel({})).toBe('info')
  })

  it('parses __ONEWORKS_PROJECT_SERVER_DEBUG__ from process env', async () => {
    vi.stubEnv('__ONEWORKS_PROJECT_SERVER_DEBUG__', 'true')
    vi.stubEnv('__ONEWORKS_PROJECT_SERVER_LOG_LEVEL__', 'warn')
    vi.stubEnv('__ONEWORKS_PROJECT_PUBLIC_BASE_URL__', 'https://lan.example')
    vi.stubEnv('__ONEWORKS_PROJECT_SERVER_ACTION_SECRET__', 'action-secret')
    vi.stubEnv('__ONEWORKS_PROJECT_SERVER_CORS_ORIGIN__', 'http://127.0.0.1:53445')
    vi.stubEnv('__ONEWORKS_PROJECT_CLIENT_MODE__', 'none')

    const { loadEnv } = await import('../src/env')

    expect(loadEnv()).toEqual(expect.objectContaining({
      __ONEWORKS_PROJECT_SERVER_DEBUG__: true,
      __ONEWORKS_PROJECT_SERVER_LOG_LEVEL__: 'warn',
      __ONEWORKS_PROJECT_PUBLIC_BASE_URL__: 'https://lan.example',
      __ONEWORKS_PROJECT_SERVER_ACTION_SECRET__: 'action-secret',
      __ONEWORKS_PROJECT_SERVER_CORS_ORIGIN__: 'http://127.0.0.1:53445',
      __ONEWORKS_PROJECT_CLIENT_MODE__: 'none'
    }))
  })

  it('defaults server data and logs to project home', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'ow-core-env-workspace-'))
    const homeProjectsDir = mkdtempSync(join(tmpdir(), 'ow-core-env-home-'))
    vi.stubEnv('__ONEWORKS_PROJECT_WORKSPACE_FOLDER__', workspaceDir)
    vi.stubEnv('__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__', homeProjectsDir)

    const { loadEnv } = await import('../src/env')

    expect(loadEnv()).toEqual(expect.objectContaining({
      __ONEWORKS_PROJECT_SERVER_DATA_DIR__: expect.stringMatching(/server[/\\]data$/),
      __ONEWORKS_PROJECT_SERVER_LOG_DIR__: expect.stringMatching(/logs[/\\]server$/)
    }))
    expect(loadEnv().__ONEWORKS_PROJECT_SERVER_DATA_DIR__).toContain(homeProjectsDir)
    expect(loadEnv().__ONEWORKS_PROJECT_SERVER_LOG_DIR__).toContain(homeProjectsDir)
  })
})
