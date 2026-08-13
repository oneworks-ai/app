import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const desktopRoot = path.resolve(__dirname, '..')

describe('workspace startup background work', () => {
  it('starts the required workspace server while the shared renderer is navigating', async () => {
    const source = await readFile(path.join(desktopRoot, 'src/main/window-manager.ts'), 'utf8')
    const workspaceLoad = source.slice(
      source.indexOf('const loadWorkspaceInWindow'),
      source.indexOf('const openWorkspaceWindow')
    )
    const rendererLoadStart = workspaceLoad.indexOf('const rendererLoadPromise = windowRecord.window.loadURL')
    const serverStart = workspaceLoad.indexOf('workspaceServicePromise = ensureWorkspaceService')
    const rendererLoadWait = workspaceLoad.indexOf('await rendererLoadPromise')
    const serverWait = workspaceLoad.indexOf('workspaceService = await workspaceServicePromise')

    expect(rendererLoadStart).toBeGreaterThanOrEqual(0)
    expect(serverStart).toBeGreaterThan(rendererLoadStart)
    expect(rendererLoadWait).toBeGreaterThan(serverStart)
    expect(serverWait).toBeGreaterThan(rendererLoadWait)
  })

  it('does not preload the hidden launcher until the real workspace surface is ready', async () => {
    const source = await readFile(path.join(desktopRoot, 'src/main/app-runtime.ts'), 'utf8')
    const workspaceStartupBranch = source.slice(
      source.indexOf('if (startupWorkspaceFolder != null && !hasPendingLaunchRequest)'),
      source.indexOf('} else if (!hasPendingLaunchRequest)')
    )

    expect(source).toContain('const scheduleLauncherPreloadAfterStartupReady = () =>')
    expect(source).toContain('onStartupWindowReady: (readiness) => {')
    expect(source).toContain("if (readiness === 'editable')")
    expect(source).toContain("code: 'workspace.renderer_surface_degraded'")
    const startupReadyHandler = source.slice(
      source.indexOf('onStartupWindowReady: (readiness) => {'),
      source.indexOf('onRendererGone:')
    )
    const editableBranch = startupReadyHandler.slice(0, startupReadyHandler.indexOf('} else {'))
    const degradedBranch = startupReadyHandler.slice(startupReadyHandler.indexOf('} else {'))
    expect(editableBranch).toContain('scheduleLauncherPreloadAfterStartupReady()')
    expect(degradedBranch).not.toContain('scheduleLauncherPreloadAfterStartupReady()')
    expect(workspaceStartupBranch).not.toContain('preloadLauncherWindow()')
  })

  it('does not let cache refresh compete with the gap between core and real interaction readiness', async () => {
    const source = await readFile(path.join(desktopRoot, 'src/main/app-runtime.ts'), 'utf8')
    const coreReadyHandler = source.slice(
      source.indexOf('markDesktopCoreReady:'),
      source.indexOf('markDesktopUiReady:')
    )

    expect(coreReadyHandler).not.toContain('workspaceRuntimeCacheManager.schedule')
    expect(source).toContain('workspaceRuntimeCacheManager.schedule(30_000)')
  })
})
