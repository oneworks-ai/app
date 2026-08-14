import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import qwenCodeCliPreparer from '../src/cli-prepare'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

const createVersionBinary = async (version: string) => {
  const root = await mkdtemp(join(tmpdir(), 'oneworks-qwen-version-'))
  tempDirs.push(root)
  const binaryPath = join(root, 'qwen')
  await writeFile(binaryPath, `#!${process.execPath}\nconsole.log('qwen ${version}')\n`)
  await chmod(binaryPath, 0o755)
  return { binaryPath, root }
}

const preparePathBinary = async (binaryPath: string, cwd: string) =>
  qwenCodeCliPreparer.prepare({
    configs: [{
      adapters: {
        'qwen-code': {
          cli: {
            source: 'path',
            path: binaryPath,
            autoInstall: false
          }
        }
      }
    }, undefined],
    cwd,
    env: {},
    logger: { info: vi.fn() }
  })

describe('qwen Code CLI version policy', () => {
  it('accepts an explicit path only when the executable is the verified version', async () => {
    const compatible = await createVersionBinary('0.21.11')
    await expect(preparePathBinary(compatible.binaryPath, compatible.root)).resolves.toEqual(
      expect.objectContaining({ binaryPath: compatible.binaryPath })
    )

    const incompatible = await createVersionBinary('0.20.9')
    await expect(preparePathBinary(incompatible.binaryPath, incompatible.root)).rejects.toThrow(
      'does not satisfy version requirement 0.21.11'
    )

    const unverifiedNewer = await createVersionBinary('0.22.0')
    await expect(preparePathBinary(unverifiedNewer.binaryPath, unverifiedNewer.root)).rejects.toThrow(
      'does not satisfy version requirement 0.21.11'
    )
  })
})
