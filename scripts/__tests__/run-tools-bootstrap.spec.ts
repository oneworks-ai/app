import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

describe('run-tools cold workspace bootstrap', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const path of tempDirs.splice(0)) rmSync(path, { force: true, recursive: true })
  })

  const createFixture = () => {
    const root = mkdtempSync(join(tmpdir(), 'oneworks-run-tools-submodules-'))
    tempDirs.push(root)
    const binDir = join(root, 'bin')
    const scriptsDir = join(root, 'scripts')
    mkdirSync(binDir)
    mkdirSync(scriptsDir)
    for (
      const name of [
        'fallback-bootstrap-lock.mjs',
        'run-tools.mjs',
        'workspace-dependency-bootstrap.mjs',
        'workspace-submodule-bootstrap.mjs'
      ]
    ) copyFileSync(join(process.cwd(), 'scripts', name), join(scriptsDir, name))
    writeFileSync(
      join(scriptsDir, 'cli.ts'),
      `module.exports = { runScriptsCli: async () => {
        if (process.argv.includes('--json')) process.stdout.write('{"ok":true}\\n')
      } }\n`
    )
    writeFileSync(join(root, '.gitmodules'), '[submodule "assets/avatar"]\n')
    const gitPath = join(binDir, 'git')
    writeFileSync(
      gitPath,
      `#!/usr/bin/env node
        const fs = require('node:fs')
        const path = require('node:path')
        const root = process.cwd()
        fs.appendFileSync(path.join(root, 'git-invocations'), JSON.stringify(process.argv.slice(2)) + '\\n')
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150)
        fs.mkdirSync(path.join(root, 'assets/avatar/packages/avatar'), { recursive: true })
        fs.mkdirSync(path.join(root, 'assets/demo-video/src'), { recursive: true })
        fs.writeFileSync(path.join(root, 'assets/avatar/packages/avatar/package.json'), '{}')
        fs.writeFileSync(path.join(root, 'assets/demo-video/src/commands.ts'), '')
      `
    )
    chmodSync(gitPath, 0o755)
    const pnpmPath = join(binDir, 'pnpm')
    writeFileSync(
      pnpmPath,
      `#!/usr/bin/env node
        const fs = require('node:fs')
        const path = require('node:path')
        const root = process.cwd()
        const countPath = path.join(root, 'install-count')
        const count = Number(fs.existsSync(countPath) ? fs.readFileSync(countPath, 'utf8') : '0') + 1
        fs.writeFileSync(countPath, String(count))
        const moduleDir = path.join(root, 'node_modules/esbuild-register/dist')
        fs.mkdirSync(moduleDir, { recursive: true })
        fs.writeFileSync(path.join(root, 'node_modules/.modules.yaml'), 'ready: true\\n')
        fs.writeFileSync(path.join(root, 'node_modules/esbuild-register/package.json'), JSON.stringify({
          name: 'esbuild-register',
          exports: { './dist/node': './dist/node.js' }
        }))
        fs.writeFileSync(path.join(moduleDir, 'node.js'), 'exports.register = () => {}\\n')
      `
    )
    chmodSync(pnpmPath, 0o755)
    return {
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
      root,
      script: join(scriptsDir, 'run-tools.mjs')
    }
  }

  const waitForExit = async (child: ReturnType<typeof spawn>) => (
    await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', resolve)
    })
  )

  it('keeps generic JSON output clean during cold submodule initialization', () => {
    const fixture = createFixture()
    const result = spawnSync(
      process.execPath,
      [fixture.script, 'release-tags', 'plan', 'base', 'head', '--json'],
      { cwd: fixture.root, encoding: 'utf8', env: fixture.env }
    )

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ ok: true })
    expect(JSON.parse(readFileSync(join(fixture.root, 'git-invocations'), 'utf8'))).toEqual([
      'submodule',
      'update',
      '--init',
      '--depth',
      '1',
      '--',
      'assets/avatar',
      'assets/demo-video'
    ])
  })

  it('serializes required submodules and dependency install across sessions', async () => {
    const fixture = createFixture()
    const args = [fixture.script, 'dev-service', 'status', 'web', '--json']
    const children = [
      spawn(process.execPath, args, { cwd: fixture.root, env: fixture.env, stdio: 'ignore' }),
      spawn(process.execPath, args, { cwd: fixture.root, env: fixture.env, stdio: 'ignore' })
    ]

    await expect(Promise.all(children.map(waitForExit))).resolves.toEqual([0, 0])
    expect(readFileSync(join(fixture.root, 'git-invocations'), 'utf8').trim().split('\n'))
      .toHaveLength(1)
    expect(readFileSync(join(fixture.root, 'install-count'), 'utf8')).toBe('1')
  }, 10_000)
})
