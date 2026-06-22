import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { resetConfigCache } from '@oneworks/config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({
  homeDir: ''
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => electronMock.homeDir
  }
}))

const {
  loadGlobalDesktopSettings,
  loadGlobalDesktopSettingsState,
  loadProjectDesktopUpdateChannel,
  loadProjectDesktopUpdateSettings,
  saveGlobalDesktopSettings,
  saveGlobalDesktopSettingsPatch,
  saveProjectDesktopUpdateChannel,
  saveProjectDesktopUpdateSettingsPatch
} = await import('../src/main/desktop-settings-config')

const tempDirs: string[] = []
const initialCwd = process.cwd()
const initialRealHome = process.env.__ONEWORKS_PROJECT_REAL_HOME__

const createTempDir = async (prefix: string) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), prefix))
  tempDirs.push(tempDir)
  return tempDir
}

const readGlobalDesktopConfig = async (homeDir: string) => {
  const content = await readFile(path.join(homeDir, '.oneworks', '.oo.config.json'), 'utf8')
  return JSON.parse(content).desktop
}

beforeEach(async () => {
  resetConfigCache()
  const homeDir = await createTempDir('oneworks-desktop-settings-home-')
  const workspaceDir = await createTempDir('oneworks-desktop-settings-workspace-')
  electronMock.homeDir = homeDir
  delete process.env.__ONEWORKS_PROJECT_REAL_HOME__
  process.chdir(workspaceDir)
})

afterEach(async () => {
  resetConfigCache()
  process.chdir(initialCwd)
  if (initialRealHome == null) {
    delete process.env.__ONEWORKS_PROJECT_REAL_HOME__
  } else {
    process.env.__ONEWORKS_PROJECT_REAL_HOME__ = initialRealHome
  }
  await Promise.all(tempDirs.splice(0, tempDirs.length).map(tempDir => rm(tempDir, { recursive: true, force: true })))
})

describe('desktop global settings config', () => {
  it('migrates legacy desktop settings into the real global config file', async () => {
    const settings = await loadGlobalDesktopSettings({
      launcherShortcut: 'option+space',
      iconBackground: 'transparent',
      iconTheme: 'matrix'
    })

    expect(settings).toMatchObject({
      launcherShortcut: 'option+space',
      openLastWorkspaceOnStartup: false,
      iconAppearance: 'system',
      iconBackground: 'transparent',
      syncAppIcon: true,
      iconTheme: 'matrix'
    })
    expect(await readGlobalDesktopConfig(electronMock.homeDir)).toEqual({
      launcherShortcut: 'option+space',
      iconBackground: 'transparent',
      iconTheme: 'matrix'
    })
  })

  it('prefers existing global settings over legacy state and ignores global update channel', async () => {
    await mkdir(path.join(electronMock.homeDir, '.oneworks'), { recursive: true })
    await writeFile(
      path.join(electronMock.homeDir, '.oneworks', '.oo.config.json'),
      JSON.stringify({
        defaultModel: 'gpt-5.4',
        desktop: {
          launcherShortcut: 'cmd+shift+p',
          iconTheme: 'metal',
          autoUpdate: false,
          updateChannel: 'beta'
        }
      })
    )

    const settings = await loadGlobalDesktopSettings({
      launcherShortcut: 'option+space',
      iconTheme: 'matrix'
    })

    expect(settings).toMatchObject({
      launcherShortcut: 'cmd+shift+p',
      iconTheme: 'metal',
      autoUpdate: true,
      updateChannel: 'stable'
    })

    await saveGlobalDesktopSettings({
      ...settings,
      syncAppIcon: false,
      iconBackground: 'transparent'
    })

    const config = JSON.parse(await readFile(path.join(electronMock.homeDir, '.oneworks', '.oo.config.json'), 'utf8'))
    expect(config.defaultModel).toBe('gpt-5.4')
    expect(config.desktop).toMatchObject({
      launcherShortcut: 'cmd+shift+p',
      iconTheme: 'metal',
      syncAppIcon: false,
      iconBackground: 'transparent',
      autoUpdate: false,
      updateChannel: 'beta'
    })
  })

  it('saves desktop setting patches without rewriting unrelated desktop prefs', async () => {
    await mkdir(path.join(electronMock.homeDir, '.oneworks'), { recursive: true })
    await writeFile(
      path.join(electronMock.homeDir, '.oneworks', '.oo.config.json'),
      JSON.stringify({
        desktop: {
          launcherShortcut: 'cmd+shift+p',
          iconTheme: 'metal'
        }
      })
    )

    await saveGlobalDesktopSettingsPatch({
      autoUpdate: false,
      contextCapture: {
        allowApplications: ['com.apple.Safari'],
        denyApplications: [],
        enabled: true,
        overlayPlacement: 'below'
      },
      syncAppIcon: false,
      updateChannel: 'rc'
    })

    const config = JSON.parse(await readFile(path.join(electronMock.homeDir, '.oneworks', '.oo.config.json'), 'utf8'))
    expect(config.desktop).toEqual({
      launcherShortcut: 'cmd+shift+p',
      iconTheme: 'metal',
      contextCapture: {
        allowApplications: ['com.apple.Safari'],
        denyApplications: [],
        enabled: true,
        overlayPlacement: 'below'
      },
      syncAppIcon: false
    })
  })

  it('loads and saves the project desktop update settings', async () => {
    const workspaceDir = process.cwd()
    await writeFile(
      path.join(workspaceDir, '.oo.config.json'),
      JSON.stringify({
        desktop: {
          autoUpdate: false,
          updateChannel: 'beta'
        }
      })
    )

    await expect(loadProjectDesktopUpdateChannel(workspaceDir)).resolves.toBe('beta')
    await expect(loadProjectDesktopUpdateSettings(workspaceDir)).resolves.toEqual({
      autoUpdate: false,
      updateChannel: 'beta'
    })
    await saveProjectDesktopUpdateChannel(workspaceDir, 'rc')
    await saveProjectDesktopUpdateSettingsPatch(workspaceDir, { autoUpdate: true })

    const config = JSON.parse(await readFile(path.join(workspaceDir, '.oo.config.json'), 'utf8'))
    expect(config.desktop).toEqual({
      autoUpdate: true,
      updateChannel: 'rc'
    })
  })

  it('uses resolved global desktop settings without materializing extended fields during migration', async () => {
    await mkdir(path.join(electronMock.homeDir, '.oneworks'), { recursive: true })
    await writeFile(
      path.join(electronMock.homeDir, '.oneworks', 'base.json'),
      JSON.stringify({
        desktop: {
          launcherShortcut: 'cmd+shift+p',
          iconTheme: 'metal'
        }
      })
    )
    await writeFile(
      path.join(electronMock.homeDir, '.oneworks', '.oo.config.json'),
      JSON.stringify({
        extend: './base.json',
        desktop: {
          syncAppIcon: false
        }
      })
    )

    const settings = await loadGlobalDesktopSettings({
      launcherShortcut: 'option+space',
      iconTheme: 'matrix',
      iconBackground: 'transparent'
    })

    expect(settings).toMatchObject({
      launcherShortcut: 'cmd+shift+p',
      iconTheme: 'metal',
      syncAppIcon: false,
      iconBackground: 'transparent'
    })
    const config = JSON.parse(await readFile(path.join(electronMock.homeDir, '.oneworks', '.oo.config.json'), 'utf8'))
    expect(config).toEqual({
      extend: './base.json',
      desktop: {
        syncAppIcon: false,
        iconBackground: 'transparent'
      }
    })
  })

  it('loads desktop prefs from the global source when global application is disabled', async () => {
    await mkdir(path.join(electronMock.homeDir, '.oneworks'), { recursive: true })
    await writeFile(
      path.join(electronMock.homeDir, '.oneworks', '.oo.config.json'),
      JSON.stringify({
        disableGlobalConfig: true,
        desktop: {
          launcherShortcut: 'cmd+shift+p',
          iconTheme: 'metal'
        }
      })
    )

    const settings = await loadGlobalDesktopSettings({
      launcherShortcut: 'option+space',
      iconTheme: 'matrix'
    })

    expect(settings).toMatchObject({
      launcherShortcut: 'cmd+shift+p',
      iconTheme: 'metal'
    })
  })

  it('reports failed legacy migration without dropping legacy settings from memory', async () => {
    await mkdir(path.join(electronMock.homeDir, '.oneworks'), { recursive: true })
    await writeFile(path.join(electronMock.homeDir, '.oneworks', '.oo.config.json'), '{')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      const result = await loadGlobalDesktopSettingsState({
        launcherShortcut: 'option+space',
        iconTheme: 'matrix'
      })

      expect(result.legacyMigrationSucceeded).toBe(false)
      expect(result.settings).toMatchObject({
        launcherShortcut: 'option+space',
        iconTheme: 'matrix'
      })
    } finally {
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    }
  })
})
