import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..'
)

const redirectPackages = ['onework', 'oneork', 'oneorks']

const readJson = (filePath: string) => JSON.parse(readFileSync(filePath, 'utf8'))

describe('bootstrap publish aliases', () => {
  it('declares typo packages as same-source publish aliases', () => {
    const bootstrapPackageJson = readJson(path.join(repoRoot, 'apps/bootstrap/package.json'))

    expect(bootstrapPackageJson.oneworks.publishAliases).toEqual(redirectPackages)
    expect(bootstrapPackageJson.bin).toEqual({
      oneworks: './cli.js',
      ow: './cli.js',
      owo: './cli.js'
    })
  })
})
