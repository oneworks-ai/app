import { execFileSync, spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { afterEach, describe, expect, it, vi } from 'vitest'

describe('legacy machine service state migration', () => {
  let tempDir = ''

  afterEach(async () => {
    vi.doUnmock('../dev-start/paths')
    vi.resetModules()
    if (tempDir !== '') await rm(tempDir, { recursive: true, force: true })
  })

  it('discovers a live worktree-local Electron snapshot before machine-state adoption', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'oneworks-electron-legacy-'))
    execFileSync('git', ['init'], { cwd: tempDir, stdio: 'ignore' })
    await mkdir(join(tempDir, '.logs'))
    await writeFile(
      join(tempDir, '.logs/dev-start-electron.json'),
      `${
        JSON.stringify({
          desktopPid: process.pid,
          root: tempDir,
          target: 'electron'
        })
      }\n`
    )

    vi.doMock('../dev-start/paths', () => ({
      repoRoot: tempDir,
      statePath: (target: string) => join(tempDir, 'machine-state', `${target}.json`)
    }))
    const { readState } = await import('../dev-start/process.js')

    expect(readState('electron')).toMatchObject({
      desktopPid: process.pid,
      root: tempDir,
      target: 'electron'
    })
  })

  it('deduplicates repeated snapshots and combines distinct live owners for unified stop', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject)
      child.once('spawn', resolve)
    })
    try {
      const { resolveLegacyElectronState } = await import('../dev-start/process.js')
      const first = { desktopPid: process.pid, root: process.cwd(), target: 'electron' as const }
      const duplicate = { desktopPid: process.pid, root: process.cwd(), target: 'electron' as const }
      expect(resolveLegacyElectronState([first, duplicate], 'electron')).toBe(first)

      const combined = resolveLegacyElectronState([
        first,
        { desktopPid: child.pid, root: process.cwd(), target: 'electron' }
      ], 'electron')
      expect(combined).toMatchObject({
        components: [{ pid: process.pid }, { pid: child.pid }],
        phase: 'failed',
        target: 'electron'
      })
    } finally {
      child.kill('SIGKILL')
    }
  })
})
