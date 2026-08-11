import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const packagerEntry = require.resolve('@electron/packager')
const osxSignEntry = require.resolve('@electron/osx-sign', {
  paths: [path.dirname(packagerEntry)]
})
const osxSignUtil = path.join(path.dirname(osxSignEntry), 'util.js')

const walkProbe = String.raw`
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

const originalLstat = fs.promises.lstat.bind(fs.promises)
let activeLstats = 0
let maxActiveLstats = 0

fs.promises.lstat = async (...args) => {
  activeLstats += 1
  maxActiveLstats = Math.max(maxActiveLstats, activeLstats)
  await new Promise(resolve => setTimeout(resolve, 2))
  try {
    return await originalLstat(...args)
  } finally {
    activeLstats -= 1
  }
}

const { walk } = await import(pathToFileURL(process.env.OSX_SIGN_UTIL).href)
const paths = await walk(process.env.OSX_SIGN_FIXTURE)
process.stdout.write(JSON.stringify({ maxActiveLstats, paths }))
`

describe('@electron/osx-sign traversal', () => {
  it('walks unpacked apps without unbounded file-descriptor concurrency', () => {
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'oneworks-osx-sign-walk-'))
    const nestedFramework = path.join(
      fixtureRoot,
      'Child.app',
      'Contents',
      'Frameworks',
      'Inner.framework'
    )
    const nestedBinary = path.join(nestedFramework, 'Versions', 'A', 'inner')
    const staleSignature = path.join(fixtureRoot, 'stale.cstemp')

    try {
      mkdirSync(path.dirname(nestedBinary), { recursive: true })
      writeFileSync(nestedBinary, Buffer.from([207, 250, 237, 254, 0, 0, 0, 0]))
      writeFileSync(staleSignature, 'stale')
      for (let index = 0; index < 96; index += 1) {
        writeFileSync(path.join(fixtureRoot, `resource-${index}.txt`), 'resource')
      }

      const result = spawnSync(
        process.execPath,
        ['--input-type=module', '--eval', walkProbe],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            OSX_SIGN_FIXTURE: fixtureRoot,
            OSX_SIGN_UTIL: osxSignUtil
          }
        }
      )

      expect(result.status, result.stderr).toBe(0)
      const output = JSON.parse(result.stdout) as {
        maxActiveLstats: number
        paths: string[]
      }
      expect(output.maxActiveLstats).toBe(1)
      expect(output.paths).toEqual([
        nestedBinary,
        nestedFramework,
        path.join(fixtureRoot, 'Child.app')
      ])
      expect(existsSync(staleSignature)).toBe(false)
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true })
    }
  })
})
