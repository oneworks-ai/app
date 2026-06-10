import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({
  userDataDir: ''
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => electronMock.userDataDir
  }
}))

const { saveDesktopState } = await import('../src/main/desktop-state-store')

let tempDir = ''

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'oneworks-desktop-state-store-'))
  electronMock.userDataDir = tempDir
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
  tempDir = ''
})

const desktopStatePath = () => path.join(tempDir, 'desktop-state.json')

describe('desktop state store', () => {
  it('preserves legacy desktop settings when requested', async () => {
    await mkdir(tempDir, { recursive: true })
    await writeFile(
      desktopStatePath(),
      JSON.stringify({
        launcherShortcut: 'option+space',
        openLastWorkspaceOnStartup: true,
        iconTheme: 'matrix',
        updateChannel: 'beta',
        recentWorkspaces: ['/old']
      })
    )

    saveDesktopState({
      iconAppearance: 'system',
      iconBackground: 'solid',
      syncAppIcon: true,
      iconTheme: 'industrial',
      launcherShortcut: 'cmd+space',
      autoUpdate: true,
      openLastWorkspaceOnStartup: false,
      updateChannel: 'stable',
      recentWorkspaces: ['/new']
    }, { preserveLegacySettings: true })

    await expect(readFile(desktopStatePath(), 'utf8')).resolves.toBe(
      `${
        JSON.stringify(
          {
            launcherShortcut: 'option+space',
            openLastWorkspaceOnStartup: true,
            iconTheme: 'matrix',
            recentWorkspaces: ['/new']
          },
          null,
          2
        )
      }\n`
    )
  })
})
