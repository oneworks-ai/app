import { describe, expect, it } from 'vitest'

import { createServerRuntimeEnv } from '../src/server-env'

describe('vscode server runtime environment', () => {
  it('removes host loader state before starting an independent web runtime', () => {
    const workspaceFolder = '/tmp/workspace'

    expect(createServerRuntimeEnv(workspaceFolder, {
      HOME: '/tmp/home',
      NODE_OPTIONS: '--require=/tmp/foreign-preload.cjs',
      NODE_PATH: '/tmp/foreign-node-modules',
      __IS_LOADER_CLI__: 'true',
      __ONEWORKS_CLI_HELPER_LOADER_ACTIVE__: 'true',
      __ONEWORKS_PROJECT_HOME_PROJECT_DIR__: 'parent',
      __ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__: '/tmp/parent'
    })).toEqual({
      HOME: '/tmp/home',
      __ONEWORKS_PROJECT_LAUNCH_CWD__: workspaceFolder,
      __ONEWORKS_PROJECT_WEB_AUTH_ENABLED__: 'false',
      __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: workspaceFolder,
      __ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__: workspaceFolder
    })
  })
})
