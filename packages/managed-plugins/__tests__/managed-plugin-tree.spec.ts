import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { inspectManagedPluginTree } from '#~/managed-plugin-tree.js'
import type { ManagedPluginTreeBoundary } from '#~/managed-plugin-tree.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

const createTree = async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ow-managed-tree-'))
  tempDirs.push(root)
  const owned = path.join(root, 'install')
  const unrelated = path.join(root, 'unrelated')
  await mkdir(path.join(owned, 'native', 'nested'), { recursive: true })
  await mkdir(unrelated)
  await writeFile(path.join(owned, 'native', 'nested', 'asset.txt'), 'owned')
  await writeFile(path.join(unrelated, 'private.txt'), 'unrelated')
  return { owned, root, unrelated }
}

describe('managed plugin tree identity boundaries', () => {
  it.each(
    [
      ['directory-read', 'native'],
      ['directory-sync', 'native'],
      ['file-open', 'asset.txt']
    ] as const
  )('fails closed when an entry is swapped at the %s boundary', async (boundary, basename) => {
    const scenario = await createTree()
    let swapped = false

    await expect(inspectManagedPluginTree(scenario.owned, {
      beforeBoundary: async (actualBoundary: ManagedPluginTreeBoundary, target) => {
        if (swapped || actualBoundary !== boundary || path.basename(target) !== basename) return
        swapped = true
        const preserved = `${target}.preserved`
        await rename(target, preserved)
        if (boundary === 'file-open') {
          await writeFile(target, 'unrelated replacement')
        } else {
          await rename(scenario.unrelated, target)
        }
      },
      sync: true
    })).rejects.toThrow(/changed|escaped/i)

    expect(swapped).toBe(true)
    if (boundary === 'file-open') {
      await expect(readFile(
        path.join(scenario.owned, 'native', 'nested', 'asset.txt'),
        'utf8'
      )).resolves.toBe('unrelated replacement')
    } else {
      await expect(readFile(
        path.join(scenario.owned, 'native', 'private.txt'),
        'utf8'
      )).resolves.toBe('unrelated')
    }
  })
})
