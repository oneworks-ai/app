import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { resolveAdapterRuntimeTarget } from '../src/adapter-package'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

describe('configured adapter package paths', () => {
  it('preserves a whitespace-bearing filesystem packageId through runtime target resolution', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'oneworks-adapter-package-'))
    directories.push(workspace)
    const exactPackage = join(workspace, 'configured-adapter ')
    await mkdir(exactPackage)
    await writeFile(join(exactPackage, 'package.json'), JSON.stringify({ name: '@oneworks/adapter-codex' }))

    expect(
      resolveAdapterRuntimeTarget('codex', {
        config: { adapters: { codex: { packageId: './configured-adapter ' } } },
        cwd: workspace
      }).loadSpecifier
    ).toBe(exactPackage)
  })
})
