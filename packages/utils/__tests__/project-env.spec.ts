import { afterEach, describe, expect, it } from 'vitest'

import { mergeProcessEnvWithProjectEnv } from '#~/project-env.js'

const projectEnvKeys = [
  '__ONEWORKS_PROJECT_WORKSPACE_FOLDER__',
  '__ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__',
  '__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__',
  '__ONEWORKS_PROJECT_HOME_PROJECT_DIR__'
] as const

describe('project env merging', () => {
  const originalEnv = Object.fromEntries(projectEnvKeys.map(key => [key, process.env[key]]))

  afterEach(() => {
    for (const key of projectEnvKeys) {
      const originalValue = originalEnv[key]
      if (originalValue == null) {
        delete process.env[key]
      } else {
        process.env[key] = originalValue
      }
    }
  })

  it('drops inherited exact project-home values when the incoming workspace differs', () => {
    process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = '/workspace-a'
    process.env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__ = '/workspace-a'
    process.env.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__ = 'workspace-a-home'

    const env = mergeProcessEnvWithProjectEnv({
      __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: '/workspace-b'
    })

    expect(env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__).toBe('/workspace-b')
    expect(env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__).toBeUndefined()
    expect(env.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__).toBeUndefined()
  })

  it('scopes to the option workspace when the incoming env does not set one', () => {
    process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = '/workspace-a'
    process.env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__ = '/workspace-a'
    process.env.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__ = 'workspace-a-home'

    const env = mergeProcessEnvWithProjectEnv(undefined, {
      workspaceFolder: '/workspace-b'
    })

    expect(env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__).toBe('/workspace-b')
    expect(env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__).toBe('/workspace-b')
    expect(env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__).toBeUndefined()
    expect(env.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__).toBeUndefined()
  })

  it('treats unchanged copied project env keys as inherited when an option workspace is supplied', () => {
    process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = '/workspace-a'
    process.env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__ = '/workspace-a'
    process.env.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__ = 'workspace-a-home'

    const env = mergeProcessEnvWithProjectEnv({
      ...process.env,
      __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__
    }, {
      workspaceFolder: '/workspace-b'
    })

    expect(env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__).toBe('/workspace-b')
    expect(env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__).toBeUndefined()
    expect(env.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__).toBeUndefined()
  })

  it('keeps explicitly supplied project-home values even when the inherited workspace differs', () => {
    process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = '/workspace-a'
    process.env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__ = '/workspace-a'
    process.env.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__ = 'workspace-a-home'

    const env = mergeProcessEnvWithProjectEnv({
      __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: '/workspace-b',
      __ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__: '/workspace-b-primary',
      __ONEWORKS_PROJECT_HOME_PROJECT_DIR__: 'workspace-b-home'
    })

    expect(env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__).toBe('/workspace-b')
    expect(env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__).toBe('/workspace-b-primary')
    expect(env.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__).toBe('workspace-b-home')
  })

  it('keeps inherited exact project-home values for the same workspace', () => {
    process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = '/workspace-a'
    process.env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__ = '/workspace-primary'
    process.env.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__ = 'workspace-a-home'

    const env = mergeProcessEnvWithProjectEnv({
      __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: '/workspace-a'
    })

    expect(env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__).toBe('/workspace-primary')
    expect(env.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__).toBe('workspace-a-home')
  })
})
