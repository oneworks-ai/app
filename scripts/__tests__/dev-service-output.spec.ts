import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { isDevServiceLogPathAllowed, redactDevServiceLogLine, runDevServiceCommand } from '../dev-start/operations'

describe('dev service machine output', () => {
  const tempDirs: string[] = []
  const successfulInstallerBody = `
    const fs = require('node:fs')
    const path = require('node:path')
    const root = process.cwd()
    const countPath = path.join(root, 'install-count')
    const count = Number(fs.existsSync(countPath) ? fs.readFileSync(countPath, 'utf8') : '0') + 1
    fs.writeFileSync(countPath, String(count))
    const moduleDir = path.join(root, 'node_modules/esbuild-register/dist')
    fs.mkdirSync(moduleDir, { recursive: true })
    fs.writeFileSync(path.join(root, 'node_modules/esbuild-register/package.json'), JSON.stringify({
      name: 'esbuild-register',
      exports: { './dist/node': './dist/node.js' }
    }))
    fs.writeFileSync(path.join(moduleDir, 'node.js'), 'exports.register = () => {}\\n')
  `

  afterEach(() => {
    vi.restoreAllMocks()
    for (const path of tempDirs.splice(0)) rmSync(path, { force: true, recursive: true })
  })

  const createBootstrapFixture = (installerBody: string) => {
    const root = mkdtempSync(join(tmpdir(), 'oneworks-run-tools-bootstrap-'))
    tempDirs.push(root)
    const binDir = join(root, 'bin')
    mkdirSync(binDir)
    copyFileSync(join(process.cwd(), 'scripts/run-tools.mjs'), join(root, 'run-tools.mjs'))
    writeFileSync(join(root, 'cli.ts'), 'module.exports = { runScriptsCli: async () => {} }\n')
    const pnpmPath = join(binDir, 'pnpm')
    writeFileSync(pnpmPath, `#!/usr/bin/env node\n${installerBody}\n`)
    chmodSync(pnpmPath, 0o755)
    return { pnpmPath, root, script: join(root, 'run-tools.mjs') }
  }

  const waitForExit = async (child: ReturnType<typeof spawn>) => (
    await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', resolve)
    })
  )

  it('prints parseable JSON without status chatter', async () => {
    let stdout = ''
    vi.spyOn(process.stdout, 'write').mockImplementation((value) => {
      stdout += String(value)
      return true
    })
    await runDevServiceCommand({ action: 'status', json: true, target: 'desktop-control' })
    expect(JSON.parse(stdout)).toMatchObject({
      protocol: 'oneworks.dev-service',
      services: [{ target: 'desktop-control' }]
    })
  })

  it('keeps the real run-tools bootstrap path parseable', () => {
    const result = spawnSync(
      'pnpm',
      ['--silent', 'tools', 'dev-service', 'status', 'desktop-control', '--json'],
      { encoding: 'utf8' }
    )
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ protocol: 'oneworks.dev-service' })
  })

  it('serializes missing-register bootstrap and installs only once across sessions', async () => {
    const fixture = createBootstrapFixture(successfulInstallerBody)
    const env = { ...process.env, PATH: `${join(fixture.root, 'bin')}:${process.env.PATH}` }
    const args = [fixture.script, 'dev-service', 'status', 'desktop-control', '--json']
    const children = [
      spawn(process.execPath, args, { cwd: fixture.root, env, stdio: 'ignore' }),
      spawn(process.execPath, args, { cwd: fixture.root, env, stdio: 'ignore' })
    ]
    await expect(Promise.all(children.map(waitForExit))).resolves.toEqual([0, 0])
    expect(readFileSync(join(fixture.root, 'install-count'), 'utf8')).toBe('1')
  }, 10_000)

  it('rechecks dependencies under the owner-token fallback lock', async () => {
    const fixture = createBootstrapFixture(successfulInstallerBody)
    const preloader = join(fixture.root, 'fallback-platform.cjs')
    writeFileSync(preloader, "Object.defineProperty(process, 'platform', { value: 'win32' })\n")
    const env = {
      ...process.env,
      NODE_OPTIONS: `--require=${preloader}`,
      PATH: `${join(fixture.root, 'bin')}:${process.env.PATH}`
    }
    const args = [fixture.script, 'dev-service', 'status', 'desktop-control', '--json']
    const children = [
      spawn(process.execPath, args, { cwd: fixture.root, env, stdio: 'ignore' }),
      spawn(process.execPath, args, { cwd: fixture.root, env, stdio: 'ignore' })
    ]
    await expect(Promise.all(children.map(waitForExit))).resolves.toEqual([0, 0])
    expect(readFileSync(join(fixture.root, 'install-count'), 'utf8')).toBe('1')
  }, 10_000)

  it('suppresses bootstrap stderr and returns structured JSON when install fails', () => {
    const fixture = createBootstrapFixture(`
      process.stderr.write('registry token=bootstrap-secret\\n')
      process.exit(7)
    `)
    const result = spawnSync(
      process.execPath,
      [fixture.script, 'dev-service', 'status', 'desktop-control', '--json'],
      {
        cwd: fixture.root,
        encoding: 'utf8',
        env: { ...process.env, PATH: `${join(fixture.root, 'bin')}:${process.env.PATH}` }
      }
    )
    expect(result.status).toBe(7)
    expect(result.stderr).not.toContain('bootstrap-secret')
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      protocol: 'oneworks.dev-service-error'
    })
  })

  it('redacts common secrets before returning bounded logs', () => {
    const redacted = redactDevServiceLogLine(
      'Authorization: Bearer abc.def token=secret password="two word value" ' +
        'AWS_SECRET_ACCESS_KEY=aws-secret DATABASE_URL=postgres://user:password@host/db'
    )
    expect(redacted).not.toMatch(/abc\.def|two word value|aws-secret|user:password|token=secret/u)
  })

  it('keeps JSON failures machine-readable while preserving a failing exit path', async () => {
    let stdout = ''
    vi.spyOn(process.stdout, 'write').mockImplementation((value) => {
      stdout += String(value)
      return true
    })
    await expect(runDevServiceCommand({ action: 'events', json: true }))
      .rejects.toThrow('events requires a target')
    expect(JSON.parse(stdout)).toMatchObject({
      ok: false,
      protocol: 'oneworks.dev-service-error'
    })
  })

  it('rejects state-provided log paths outside the target directory', () => {
    expect(isDevServiceLogPathAllowed('desktop-control', '/etc/dev-start-desktop-control.log')).toBe(false)
  })
})
