import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const desktopRoot = path.resolve(__dirname, '..')
const clientRoot = path.resolve(desktopRoot, '../client')

describe('desktop launcher manager connection', () => {
  it('starts the manager with the launcher client and injects its exact URL through preload', async () => {
    const [appRuntime, clientManagerRuntime, constants, managerService, preload, windowManager] = await Promise.all([
      readFile(path.join(desktopRoot, 'src/main/app-runtime.ts'), 'utf8'),
      readFile(path.join(clientRoot, 'src/desktop/manager-runtime.ts'), 'utf8'),
      readFile(path.join(desktopRoot, 'src/main/constants.ts'), 'utf8'),
      readFile(path.join(desktopRoot, 'src/main/manager-service-manager.ts'), 'utf8'),
      readFile(path.join(desktopRoot, 'src/preload/index.ts'), 'utf8'),
      readFile(path.join(desktopRoot, 'src/main/window-manager.ts'), 'utf8')
    ])
    const launcherLoadSource = windowManager.slice(
      windowManager.indexOf('const loadLauncherWindow'),
      windowManager.indexOf('const loadWorkspaceInWindow')
    )

    expect(windowManager).toContain('Promise.all([clientServicePromise, managerServicePromise])')
    expect(launcherLoadSource).toContain(
      "console.error('[oneworks-desktop] failed to load launcher runtimes', error)"
    )
    expect(launcherLoadSource).not.toContain('loadWorkspaceSelectorWindow')
    expect(appRuntime).toContain('getManagerConnection')
    expect(preload).toContain('getManagerConnection: () => ipcRenderer.invoke(managerConnectionChannel)')
    expect(constants).toContain('MANAGER_READY_TIMEOUT_MS = 120000')
    expect(managerService).toContain('waitForServerStartup(child, MANAGER_READY_TIMEOUT_MS)')
    expect(clientManagerRuntime).toContain('getClientBase()')
    expect(clientManagerRuntime).toContain('__ONEWORKS_PROJECT_MANAGER_SERVER_BASE_URL__: managerServerBaseUrl')
    expect(clientManagerRuntime).not.toContain(
      "__ONEWORKS_PROJECT_MANAGER_SERVER_BASE_URL__: 'http://localhost:8787'"
    )
  })
})
