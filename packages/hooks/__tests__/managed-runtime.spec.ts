import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { getManagedPluginInstallDir } from '@oneworks/utils/managed-plugin'

import { callHook } from '#~/call.js'

const tempDirs: string[] = []

const writeDocument = async (filePath: string, content: string) => {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, content)
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('managed hook runtime', () => {
  it('loads declared project-home managed Claude hook plugins', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-hook-managed-'))
    tempDirs.push(workspace)
    const env = {
      ...process.env,
      __ONEWORKS_PROJECT_HOME_PROJECTS_DIR__: join(workspace, '.oneworks-projects')
    }
    const installDir = getManagedPluginInstallDir(workspace, 'claude', 'demo', env)
    const oneworksDir = join(installDir, 'oneworks')

    await writeDocument(
      join(workspace, '.oo.config.json'),
      JSON.stringify(
        {
          plugins: [
            {
              id: oneworksDir,
              scope: 'demo'
            }
          ]
        },
        null,
        2
      )
    )
    await writeDocument(
      join(installDir, '.oneworks-plugin.json'),
      JSON.stringify(
        {
          version: 1,
          adapter: 'claude',
          name: 'demo',
          scope: 'demo',
          installedAt: new Date().toISOString(),
          source: {
            type: 'path',
            path: './demo'
          },
          nativePluginPath: 'native',
          oneworksPluginPath: 'oneworks'
        },
        null,
        2
      )
    )
    await writeDocument(
      join(oneworksDir, 'hooks.js'),
      'module.exports = { SessionStart: async (_ctx, _input, next) => ({ ...(await next()), systemMessage: "managed-hook" }) }\n'
    )

    const result = await callHook(
      'SessionStart',
      {
        cwd: workspace,
        sessionId: 'managed-session',
        source: 'startup'
      },
      {
        ...env,
        __ONEWORKS_PROJECT_CTX_ID__: 'ctx-managed-hook',
        __ONEWORKS_PROJECT_SERVER_HOST__: '127.0.0.1',
        __ONEWORKS_PROJECT_SERVER_PORT__: '1'
      }
    )

    expect(result).toEqual(expect.objectContaining({
      continue: true,
      systemMessage: 'managed-hook'
    }))
  })

  it('bootstraps NODE_PATH for package hook plugins from __ONEWORKS_PROJECT_PACKAGE_DIR__', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-hook-node-path-'))
    tempDirs.push(workspace)

    const packageDir = join(workspace, 'vendor/fake-hooks-package')
    await writeDocument(
      join(packageDir, 'package.json'),
      JSON.stringify(
        {
          name: 'fake-hooks-package',
          version: '1.0.0'
        },
        null,
        2
      )
    )
    await writeDocument(
      join(workspace, '.oo.config.json'),
      JSON.stringify(
        {
          plugins: [
            {
              id: 'demo'
            }
          ]
        },
        null,
        2
      )
    )
    await writeDocument(
      join(workspace, 'vendor/node_modules/@oneworks/plugin-demo/package.json'),
      JSON.stringify(
        {
          name: '@oneworks/plugin-demo',
          version: '1.0.0'
        },
        null,
        2
      )
    )
    await writeDocument(
      join(workspace, 'vendor/node_modules/@oneworks/plugin-demo/hooks.js'),
      'module.exports = { SessionStart: async (_ctx, _input, next) => ({ ...(await next()), systemMessage: "package-hook" }) }\n'
    )

    const result = await callHook(
      'SessionStart',
      {
        cwd: workspace,
        sessionId: 'package-hook-session',
        source: 'startup'
      },
      {
        ...process.env,
        NODE_PATH: '',
        __ONEWORKS_PROJECT_PACKAGE_DIR__: packageDir,
        __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: workspace,
        __ONEWORKS_PROJECT_CTX_ID__: 'ctx-package-hook',
        __ONEWORKS_PROJECT_SERVER_HOST__: '127.0.0.1',
        __ONEWORKS_PROJECT_SERVER_PORT__: '1'
      }
    )

    expect(result).toEqual(expect.objectContaining({
      continue: true,
      systemMessage: 'package-hook'
    }))
  })
})
