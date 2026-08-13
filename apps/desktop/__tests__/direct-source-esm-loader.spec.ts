import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getAppPath: () => path.resolve(__dirname, '..'),
    getPath: () => path.join(tmpdir(), 'oneworks-desktop-test'),
    getVersion: () => '0.0.0',
    isPackaged: false
  }
}))

afterEach(() => {
  vi.resetModules()
})

describe('desktop direct-source ESM loader', () => {
  it('installs the ESM source resolver before marking direct source loading active', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'oneworks-desktop-direct-source-loader-'))
    try {
      const entryPath = path.join(tempDir, 'entry.mjs')
      await writeFile(
        entryPath,
        "void import('./lazy.js').then(({ value }) => process.stdout.write(value))\n"
      )
      await writeFile(path.join(tempDir, 'lazy.ts'), "export const value: string = 'desktop-source-ready'\n")
      const { resolveDirectSourceLoaderEnv } = await import('../src/main/workspace-service-manager')
      const loaderEnv = resolveDirectSourceLoaderEnv(process.execPath)

      const result = spawnSync(process.execPath, [entryPath], {
        cwd: tempDir,
        encoding: 'utf8',
        env: {
          ...process.env,
          ...loaderEnv
        }
      })

      expect(loaderEnv.__ONEWORKS_CLI_HELPER_LOADER_ACTIVE__).toBe('true')
      expect(result.status).toBe(0)
      expect(result.signal).toBeNull()
      expect(result.stderr).toBe('')
      expect(result.stdout).toBe('desktop-source-ready')
    } finally {
      await rm(tempDir, { force: true, recursive: true })
    }
  })
})
