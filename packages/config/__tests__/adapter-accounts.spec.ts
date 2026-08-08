import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { updateGlobalAdapterAccounts } from '#~/adapter-accounts.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('updateGlobalAdapterAccounts', () => {
  it('updates only the selected global adapter account section', async () => {
    const realHome = await mkdtemp(join(tmpdir(), 'ow-global-adapter-accounts-'))
    tempDirs.push(realHome)
    const env = { __ONEWORKS_PROJECT_REAL_HOME__: realHome }
    const globalConfigDir = join(realHome, '.oneworks')
    const globalConfigPath = join(globalConfigDir, '.oo.config.json')
    await mkdir(globalConfigDir, { recursive: true })
    await writeFile(globalConfigPath, '{}\n')
    await chmod(globalConfigPath, 0o644)

    await updateGlobalAdapterAccounts({
      adapter: 'claude-code',
      cwd: realHome,
      env,
      update: (adapterConfig, accounts) => ({
        ...adapterConfig,
        defaultAccount: 'work',
        accounts: {
          ...accounts,
          work: { title: 'Work Claude' }
        }
      })
    })

    const config = JSON.parse(await readFile(globalConfigPath, 'utf8'))
    expect(config).toEqual({
      adapters: {
        'claude-code': {
          defaultAccount: 'work',
          accounts: {
            work: { title: 'Work Claude' }
          }
        }
      }
    })
    if (process.platform !== 'win32') {
      expect((await stat(globalConfigPath)).mode & 0o777).toBe(0o600)
    }
  })
})
