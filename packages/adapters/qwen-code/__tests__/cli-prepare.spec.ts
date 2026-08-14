/* eslint-disable import/first -- the CLI resolver mock must be installed before loading the preparer. */
import { describe, expect, it, vi } from 'vitest'

const { ensureManagedNpmCli } = vi.hoisted(() => ({
  ensureManagedNpmCli: vi.fn(async () => '/managed/qwen')
}))

vi.mock('@oneworks/utils/managed-npm-cli', async (importOriginal) => ({
  ...await importOriginal<typeof import('@oneworks/utils/managed-npm-cli')>(),
  ensureManagedNpmCli
}))

import qwenCodeCliPreparer from '../src/cli-prepare'

describe('qwen Code CLI prepare', () => {
  it('applies the exact verified 0.21.11 version to system and path resolution', async () => {
    const result = await qwenCodeCliPreparer.prepare({
      configs: [{
        adapters: {
          'qwen-code': {
            cli: { source: 'system' }
          }
        }
      }, undefined],
      cwd: '/workspace',
      env: {},
      logger: {
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn()
      }
    } as any)

    expect(result).toEqual(expect.objectContaining({
      adapter: 'qwen-code',
      binaryPath: '/managed/qwen',
      target: 'cli'
    }))
    expect(ensureManagedNpmCli).toHaveBeenCalledWith(expect.objectContaining({
      adapterKey: 'qwen-code',
      binaryName: 'qwen',
      config: expect.objectContaining({ source: 'system' }),
      defaultPackageName: '@qwen-code/qwen-code',
      defaultVersion: '0.21.11',
      validateExplicitPathVersion: true,
      versionRange: '0.21.11'
    }))
  })
})
