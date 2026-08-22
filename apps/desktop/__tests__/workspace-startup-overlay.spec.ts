import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { normalizeDesktopFirstActionMilestone, normalizeDesktopWorkspaceStartupReadiness } from '@oneworks/types'
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
    expect(completeSource).toContain('ipcRenderer.invoke(workspaceStartupReadyChannel, { readiness })')
    expect(completeSource).toContain("dismissWorkspaceStartupOverlay('complete')")
    expect(preload).toContain('revealWorkspaceStartupSurface,')
  })

  it('keeps only the omitted legacy payload editable and fails explicit malformed IPC input closed', async () => {
    const [preload, ipcHandlers] = await Promise.all([
      readFile(path.join(desktopRoot, 'src/preload/index.ts'), 'utf8'),
      readFile(path.join(desktopRoot, 'src/main/ipc-handlers.ts'), 'utf8')
    ])

    expect(normalizeDesktopWorkspaceStartupReadiness()).toBe('editable')
    expect(normalizeDesktopWorkspaceStartupReadiness(null)).toBe('degraded')
    expect(normalizeDesktopWorkspaceStartupReadiness({})).toBe('degraded')
    expect(preload).toContain('normalizeDesktopWorkspaceStartupReadiness(input)')
    expect(ipcHandlers).toContain(
      'markWorkspaceStartupWindowReady(windowRecord, normalizeDesktopWorkspaceStartupReadiness(input))'
    )
  })

  it('keeps first-action IPC closed, non-blocking, and scoped to workspace windows', async () => {
    const [preload, ipcHandlers] = await Promise.all([
      readFile(path.join(desktopRoot, 'src/preload/index.ts'), 'utf8'),
      readFile(path.join(desktopRoot, 'src/main/ipc-handlers.ts'), 'utf8')
    ])

    expect(normalizeDesktopFirstActionMilestone({ milestone: 'first.response.received' }))
      .toBe('first.response.received')
    expect(normalizeDesktopFirstActionMilestone({ milestone: 'first.token' })).toBeUndefined()
    expect(preload).toContain('normalizeDesktopFirstActionMilestone(input)')
    expect(preload).toContain(
      'void ipcRenderer.invoke(desktopFirstActionMilestoneChannel, { milestone }).catch(() => undefined)'
    )
    expect(ipcHandlers).toContain('normalizeDesktopFirstActionMilestone(input)')
    expect(ipcHandlers).toContain("windowRecord.kind !== 'workspace'")
    expect(ipcHandlers).toContain('markDesktopFirstActionMilestone(')
    expect(ipcHandlers).toContain('senderFrame.processId')
    expect(ipcHandlers).toContain('senderFrame.frameToken')
  })
})
