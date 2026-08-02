import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const waitForExit = async (child: ReturnType<typeof spawn>) => {
  if (child.exitCode != null || child.signalCode != null) return
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', () => resolve())
  })
}

const waitForValue = async <T>(read: () => T | undefined) => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const value = read()
    if (value != null) return value
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('Timed out waiting for a value.')
}

describe('worktree dev-service registry', () => {
  let child: ReturnType<typeof spawn> | undefined
  let ownerRoot: string
  let previousRealHome: string | undefined
  let tempHome: string

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), 'oneworks-dev-service-registry-'))
    ownerRoot = join(tempHome, 'deleted-worktree')
    await mkdir(ownerRoot, { recursive: true })
    previousRealHome = process.env.__ONEWORKS_PROJECT_REAL_HOME__
    process.env.__ONEWORKS_PROJECT_REAL_HOME__ = tempHome
    vi.resetModules()
  })

  afterEach(async () => {
    if (child?.pid != null && child.exitCode == null && child.signalCode == null) child.kill('SIGKILL')
    if (child != null) await waitForExit(child)
    if (previousRealHome == null) delete process.env.__ONEWORKS_PROJECT_REAL_HOME__
    else process.env.__ONEWORKS_PROJECT_REAL_HOME__ = previousRealHome
    await rm(tempHome, { force: true, recursive: true })
    vi.resetModules()
  })

  it('migrates the local snapshot and keeps the machine copy after its worktree disappears', async () => {
    const { legacyStatePath, statePath } = await import('../dev-start/paths.js')
    const { readRegisteredWorktreeStates, readState } = await import('../dev-start/process.js')
    const { updateDevServiceState, writeDevServiceState } = await import('../dev-start/state.js')
    await mkdir(join(ownerRoot, '.logs'), { recursive: true })

    writeDevServiceState('web', {
      phase: 'starting',
      root: ownerRoot,
      target: 'web'
    }, ownerRoot)

    expect(JSON.parse(await readFile(statePath('web', ownerRoot), 'utf8'))).toMatchObject({
      phase: 'starting',
      root: ownerRoot,
      schemaVersion: 2,
      scope: 'worktree'
    })
    expect(JSON.parse(await readFile(legacyStatePath('web', ownerRoot), 'utf8'))).toMatchObject({
      phase: 'starting'
    })

    await rm(ownerRoot, { force: true, recursive: true })
    updateDevServiceState('web', { phase: 'stopped' }, ownerRoot)

    expect(existsSync(ownerRoot)).toBe(false)
    expect(readState('web', ownerRoot)).toMatchObject({ phase: 'stopped', root: ownerRoot })
    expect(readRegisteredWorktreeStates('web')).toEqual([
      expect.objectContaining({ phase: 'stopped', root: ownerRoot, target: 'web' })
    ])
  })

  it('registers an existing schema-v2 local snapshot before reusing it', async () => {
    const { legacyStatePath, statePath } = await import('../dev-start/paths.js')
    const { getDevServiceStatus } = await import('../dev-start/operations.js')
    const { registerLegacyDevServiceState } = await import('../dev-start/state.js')
    await mkdir(join(ownerRoot, '.logs'), { recursive: true })
    await writeFile(
      legacyStatePath('web', ownerRoot),
      `${
        JSON.stringify({
          phase: 'ready',
          revision: 7,
          root: ownerRoot,
          schemaVersion: 2,
          scope: 'worktree',
          target: 'web'
        })
      }\n`
    )

    const readOnlyStatus = await getDevServiceStatus('web', ownerRoot)
    expect(readOnlyStatus.services[0]?.state).toMatchObject({ revision: 7, root: ownerRoot })
    expect(existsSync(statePath('web', ownerRoot))).toBe(false)

    expect(registerLegacyDevServiceState('web', ownerRoot)).toBe(true)
    expect(JSON.parse(await readFile(statePath('web', ownerRoot), 'utf8'))).toMatchObject({
      phase: 'ready',
      revision: 8,
      root: ownerRoot
    })
  })

  it('marks only missing worktrees with verified live ownership as orphaned', async () => {
    const { isOrphanedDevServiceState } = await import('../dev-start/operations.js')
    const state = {
      phase: 'ready' as const,
      root: ownerRoot,
      scope: 'worktree' as const,
      target: 'web' as const
    }

    expect(isOrphanedDevServiceState(state, {
      hasOwnedProcesses: () => true,
      rootExists: () => false
    })).toBe(true)
    expect(isOrphanedDevServiceState(state, {
      hasOwnedProcesses: () => false,
      rootExists: () => false
    })).toBe(false)
    expect(isOrphanedDevServiceState(state, {
      hasOwnedProcesses: () => true,
      rootExists: () => true
    })).toBe(false)
  })

  it('keeps explicit existing-owner events local and deleted-owner events in the registry', async () => {
    const { eventsPath, registryEventsPath } = await import('../dev-start/paths.js')
    const { resolveDevServiceEventsPath } = await import('../dev-start/operations.js')

    expect(resolveDevServiceEventsPath('web', ownerRoot)).toBe(eventsPath('web', ownerRoot))
    await rm(ownerRoot, { force: true, recursive: true })
    expect(resolveDevServiceEventsPath('web', ownerRoot)).toBe(registryEventsPath('web', ownerRoot))
  })

  it('precisely stops a registered process after the owner worktree was deleted', async () => {
    const { getDevServiceStatus, runDevServiceCommand, stopDevService } = await import('../dev-start/operations.js')
    const { processFingerprint } = await import('../dev-start/process-identity.js')
    const { readState } = await import('../dev-start/process.js')
    const { writeDevServiceState } = await import('../dev-start/state.js')

    child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])
    await new Promise<void>((resolveSpawn, reject) => {
      child?.once('error', reject)
      child?.once('spawn', resolveSpawn)
    })
    const fingerprint = await waitForValue(() => processFingerprint(child?.pid))
    writeDevServiceState('web', {
      components: [{ fingerprint, id: 'manager', kind: 'process', pid: child.pid }],
      phase: 'ready',
      root: ownerRoot,
      serviceFingerprint: fingerprint,
      servicePid: child.pid,
      target: 'web'
    }, ownerRoot)
    await rm(ownerRoot, { force: true, recursive: true })

    const document = await getDevServiceStatus('web')
    expect(document.orphanedServices).toEqual([
      expect.objectContaining({ orphaned: true, target: 'web' })
    ])

    await stopDevService('web', { ownerRoot })
    await waitForExit(child)
    const eventResult = await runDevServiceCommand({
      action: 'events',
      limit: 10,
      ownerRoot,
      target: 'web'
    }) as { events: Array<{ phase: string }>; path: string }
    expect(eventResult.events.map(event => event.phase)).toEqual(['started', 'completed'])
    expect(eventResult.path).toContain('.oneworks/dev-service/worktrees/')
    const stoppedState = readState('web', ownerRoot)
    expect(stoppedState).toMatchObject({
      phase: 'stopped',
      root: ownerRoot
    })
    expect(stoppedState?.servicePid).toBeUndefined()
    expect(existsSync(ownerRoot)).toBe(false)
  }, 15_000)
})
