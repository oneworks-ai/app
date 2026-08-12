import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const desktopRoot = path.resolve(__dirname, '..')
const clientRoot = path.resolve(desktopRoot, '../client')

describe('desktop workspace startup overlay', () => {
  it('reveals a meaningful React loading surface without completing workspace startup diagnostics', async () => {
    const [clientHtml, preload] = await Promise.all([
      readFile(path.join(clientRoot, 'index.html'), 'utf8'),
      readFile(path.join(desktopRoot, 'src/preload/index.ts'), 'utf8')
    ])
    const revealSource = preload.slice(
      preload.indexOf('const revealWorkspaceStartupSurface'),
      preload.indexOf('const markWorkspaceStartupReady')
    )
    const completeSource = preload.slice(
      preload.indexOf('const markWorkspaceStartupReady'),
      preload.indexOf('applyInitialDesktopThemeMode()')
    )

    expect(clientHtml).toContain("html[data-oneworks-desktop-startup-surface-ready='true']")
    expect(revealSource).toContain("dismissWorkspaceStartupOverlay('surface')")
    expect(revealSource).toContain('workspaceStartupDismissPromise ?? Promise.resolve()')
    expect(revealSource).not.toContain('ipcRenderer.invoke')
    expect(completeSource).toContain('ipcRenderer.invoke(workspaceStartupReadyChannel)')
    expect(completeSource).toContain("dismissWorkspaceStartupOverlay('complete')")
    expect(preload).toContain('revealWorkspaceStartupSurface,')
  })
})
