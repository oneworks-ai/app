import { afterEach, describe, expect, it, vi } from 'vitest'

import { getWorkspaceFolder } from '#~/services/config/index.js'

afterEach(() => vi.unstubAllEnvs())

describe('config workspace path boundary', () => {
  it('preserves leading and trailing whitespace in the runtime workspace identity', () => {
    const workspaceFolder = '/tmp/ workspace '
    vi.stubEnv('__ONEWORKS_PROJECT_WORKSPACE_FOLDER__', workspaceFolder)
    vi.stubEnv('__ONEWORKS_PROJECT_SERVER_ROLE__', 'workspace')

    expect(getWorkspaceFolder()).toBe(workspaceFolder)
  })
})
