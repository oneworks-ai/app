import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

describe('typecheck script', () => {
  it('opts into a per-scope incremental cache only when CI provides a cache directory', () => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'oneworks-typecheck-'))
    const binDirectory = path.join(fixture, 'bin')
    const commandLog = path.join(fixture, 'commands.log')
    const cacheDirectory = path.join(fixture, 'cache')
    mkdirSync(binDirectory)
    const pnpmPath = path.join(binDirectory, 'pnpm')
    writeFileSync(pnpmPath, '#!/usr/bin/env bash\nprintf \'%s\\n\' "$*" >> "$COMMAND_LOG"\n')
    chmodSync(pnpmPath, 0o755)

    const result = spawnSync(process.execPath, ['scripts/typecheck.mjs', 'web'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        COMMAND_LOG: commandLog,
        ONEWORKS_TYPECHECK_CACHE_DIR: cacheDirectory,
        PATH: `${binDirectory}:${process.env.PATH}`
      }
    })

    expect(result.status).toBe(0)
    expect(readFileSync(commandLog, 'utf8')).toContain(
      `exec tsc -p packages/tsconfigs/tsconfig.typecheck.bundler.web.json --pretty false --incremental true --tsBuildInfoFile ${
        path.join(cacheDirectory, 'web.tsbuildinfo')
      }`
    )
  })
})
