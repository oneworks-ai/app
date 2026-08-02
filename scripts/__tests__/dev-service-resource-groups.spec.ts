import { dirname } from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveElectronLaunchIdentity } from '../dev-start/external-targets'
import {
  leasePath,
  legacyStatePath,
  machineServiceDir,
  repoRoot,
  statePath,
  worktreeServiceDir
} from '../dev-start/paths'

describe('dev service resource groups', () => {
  it('serializes the two Electron modes through one machine-level lease', () => {
    expect(leasePath('electron')).toBe(leasePath('electron-workspace'))
    expect(dirname(leasePath('electron'))).toBe(machineServiceDir)
    expect(dirname(statePath('electron'))).toBe(machineServiceDir)
    expect(dirname(statePath('electron-workspace'))).toBe(machineServiceDir)
  })

  it('serializes web and daemon manager ownership in one worktree', () => {
    expect(leasePath('web')).toBe(leasePath('daemon'))
    expect(dirname(statePath('web'))).toBe(worktreeServiceDir())
    expect(legacyStatePath('web')).toBe(`${repoRoot}/.logs/dev-start-web.json`)
  })

  it('includes the owning worktree in both Electron launch identities', () => {
    expect(resolveElectronLaunchIdentity({
      desktopWorkspace: false,
      kind: 'desktop',
      needsClient: false,
      needsServer: false,
      readiness: 'process'
    })).toBe(`empty:${repoRoot}`)
    expect(resolveElectronLaunchIdentity({
      desktopWorkspace: true,
      kind: 'desktop',
      needsClient: false,
      needsServer: false,
      readiness: 'process'
    })).toBe(`workspace:${repoRoot}`)
  })
})
