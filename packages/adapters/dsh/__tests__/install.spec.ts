import '../src/adapter-config'

import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { ensureDshCli } from '../src/runtime/install'

describe('dsh managed installation', () => {
  it('rejects a custom managed package instead of creating a partial official composition', async () => {
    await expect(ensureDshCli({
      cwd: '/workspace',
      env: { HOME: '/tmp', __ONEWORKS_PROJECT_REAL_HOME__: '/tmp' },
      configs: [{
        adapters: {
          dsh: { cli: { source: 'managed', package: '@example/custom-dsh', version: '1.0.0' } }
        }
      }, undefined],
      logger: { info: () => undefined }
    } as any)).rejects.toThrow('requires the official @deepseek-ai/dsh-acp-demo package composition')
  })

  it('rejects unverified managed versions of the official composition', async () => {
    await expect(ensureDshCli({
      cwd: '/workspace',
      env: { HOME: '/tmp', __ONEWORKS_PROJECT_REAL_HOME__: '/tmp' },
      configs: [{
        adapters: {
          dsh: { cli: { version: '0.1.0-rc.3' } }
        }
      }, undefined],
      logger: { info: () => undefined }
    } as any)).rejects.toThrow('requires the verified official version 0.1.0-rc.6')
  })

  it('rejects path mode without an explicit binary path', async () => {
    await expect(ensureDshCli({
      cwd: '/workspace',
      env: { HOME: '/tmp', __ONEWORKS_PROJECT_REAL_HOME__: '/tmp' },
      configs: [{ adapters: { dsh: { cli: { source: 'path' } } } }, undefined],
      logger: { info: () => undefined }
    } as any)).rejects.toThrow('source is set to path')
  })

  it('honors env path source while resolving relative paths against the workspace', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-dsh-cli-path-'))
    const binaryPath = join(workspace, 'dsh-custom')
    await writeFile(binaryPath, '#!/bin/sh\nexit 0\n')
    await chmod(binaryPath, 0o755)
    try {
      await expect(ensureDshCli({
        cwd: workspace,
        env: {
          HOME: workspace,
          __ONEWORKS_PROJECT_ADAPTER_DSH_CLI_PATH__: './dsh-custom',
          __ONEWORKS_PROJECT_ADAPTER_DSH_CLI_SOURCE__: 'path',
          __ONEWORKS_PROJECT_REAL_HOME__: workspace
        },
        configs: [{ adapters: { dsh: {} } }, undefined],
        logger: { info: () => undefined }
      } as any)).resolves.toBe(binaryPath)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('rejects env path source without a binary path', async () => {
    await expect(ensureDshCli({
      cwd: '/workspace',
      env: {
        HOME: '/tmp',
        __ONEWORKS_PROJECT_ADAPTER_DSH_CLI_SOURCE__: 'path',
        __ONEWORKS_PROJECT_REAL_HOME__: '/tmp'
      },
      configs: [{ adapters: { dsh: {} } }, undefined],
      logger: { info: () => undefined }
    } as any)).rejects.toThrow('source is set to path')
  })
})
