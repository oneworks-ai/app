import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

describe('workspace dependency bootstrap', () => {
  const tempDirs: string[] = []
  const fakePnpmBody = `
    const fs = require('node:fs')
    const path = require('node:path')
    const args = process.argv.slice(2)
    const root = process.env.ONEWORKS_TEST_ROOT
    if (args[0] === 'install') {
      const countPath = path.join(root, 'install-count')
      const count = Number(fs.existsSync(countPath) ? fs.readFileSync(countPath, 'utf8') : '0') + 1
      fs.writeFileSync(countPath, String(count))
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
      const binDir = path.join(root, 'node_modules/.bin')
      fs.mkdirSync(binDir, { recursive: true })
      fs.writeFileSync(path.join(root, 'node_modules/.modules.yaml'), 'ready: true\\n')
      fs.writeFileSync(path.join(binDir, 'dprint'), '')
      fs.writeFileSync(path.join(binDir, 'vitest'), '')
      process.exit(0)
    }
    const check = args.includes('dprint') ? 'dprint' : args.includes('vitest') ? 'desktop' : 'unknown'
    fs.appendFileSync(path.join(root, 'executed-checks'), check + '\\n')
    process.exit(Number(process.env['FAKE_' + check.toUpperCase() + '_EXIT'] || '0'))
  `

  afterEach(() => {
    for (const path of tempDirs.splice(0)) rmSync(path, { force: true, recursive: true })
  })

  const createFixture = () => {
    const root = mkdtempSync(join(tmpdir(), 'oneworks-workspace-bootstrap-'))
    tempDirs.push(root)
    const pnpmCli = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['pnpm'], {
      encoding: 'utf8'
    }).split(/\r?\n/u)[0]
    const scriptsDir = join(root, 'scripts')
    const binDir = join(root, 'bin')
    const desktopDir = join(root, 'apps', 'desktop')
    mkdirSync(scriptsDir)
    mkdirSync(binDir)
    mkdirSync(desktopDir, { recursive: true })
    for (
      const name of [
        'fallback-bootstrap-lock.mjs',
        'run-workspace-check.mjs',
        'workspace-dependency-bootstrap.mjs',
        'workspace-submodule-bootstrap.mjs'
      ]
    ) {
      copyFileSync(join(process.cwd(), 'scripts', name), join(scriptsDir, name))
    }
    const rootPackage = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
    const desktopPackage = JSON.parse(
      readFileSync(join(process.cwd(), 'apps/desktop/package.json'), 'utf8')
    )
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ private: true, scripts: { dprint: rootPackage.scripts.dprint } })
    )
    writeFileSync(
      join(desktopDir, 'package.json'),
      JSON.stringify({
        private: true,
        scripts: { 'test:package-preflight': desktopPackage.scripts['test:package-preflight'] }
      })
    )
    const pnpmPath = join(binDir, 'pnpm')
    writeFileSync(pnpmPath, `#!/usr/bin/env node\n${fakePnpmBody}\n`)
    chmodSync(pnpmPath, 0o755)
    return {
      desktopDir,
      env: {
        ...process.env,
        ONEWORKS_TEST_ROOT: root,
        PATH: `${binDir}:${process.env.PATH}`
      },
      pnpmCli,
      root,
      runner: join(scriptsDir, 'run-workspace-check.mjs')
    }
  }

  const waitForExit = async (child: ReturnType<typeof spawn>) => (
    await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', resolve)
    })
  )

  const runParallelChecks = async (
    fixture: ReturnType<typeof createFixture>,
    env = fixture.env
  ) => {
    const dprint = spawn(fixture.pnpmCli, ['dprint', 'check'], {
      cwd: fixture.root,
      env,
      stdio: 'ignore'
    })
    const desktop = spawn(
      fixture.pnpmCli,
      ['-C', 'apps/desktop', 'test:package-preflight'],
      { cwd: fixture.root, env, stdio: 'ignore' }
    )
    return await Promise.all([waitForExit(dprint), waitForExit(desktop)])
  }

  it('repeatedly installs once and executes both parallel checks', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const fixture = createFixture()
      await expect(runParallelChecks(fixture)).resolves.toEqual([0, 0])
      expect(readFileSync(join(fixture.root, 'install-count'), 'utf8')).toBe('1')
      expect(
        readFileSync(join(fixture.root, 'executed-checks'), 'utf8').trim().split('\n').sort()
      ).toEqual(['desktop', 'dprint'])
    }
  }, 15_000)

  it('returns each executed check status instead of the install status', async () => {
    const fixture = createFixture()
    const env = { ...fixture.env, FAKE_DPRINT_EXIT: '19' }
    await expect(runParallelChecks(fixture, env)).resolves.toEqual([19, 0])
    expect(readFileSync(join(fixture.root, 'install-count'), 'utf8')).toBe('1')
    expect(
      readFileSync(join(fixture.root, 'executed-checks'), 'utf8').trim().split('\n').sort()
    ).toEqual(['desktop', 'dprint'])
  })
})
