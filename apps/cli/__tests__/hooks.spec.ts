import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  listInstalledAdapterPackages,
  readInstalledAdapterScopeEntries,
  resolveActiveNativeHookBridge,
  runManagedHookEntrypoint
} from '@oneworks/hooks'

const tempDirs: string[] = []

afterEach(async () => {
  delete process.env.__ONEWORKS_HOOK_BRIDGE_ADAPTER__
  delete process.env.__ONEWORKS_HOOK_EVENT_NAME__
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('hook bridge loader', () => {
  it('treats pnpm symlinked adapter entries as installed packages', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-hook-loader-'))
    tempDirs.push(root)
    const scopeDir = join(root, '@oneworks')
    const targetDir = join(root, 'targets', 'adapter-codex')

    await mkdir(targetDir, { recursive: true })
    await mkdir(scopeDir, { recursive: true })
    await symlink(targetDir, join(scopeDir, 'adapter-codex'))

    expect(readInstalledAdapterScopeEntries(scopeDir)).toEqual(['adapter-codex'])
  })

  it('discovers installed adapter packages from available search paths', () => {
    expect(
      listInstalledAdapterPackages({
        resolveSearchPaths: () => ['/node_modules', '/other/node_modules'],
        readAdapterScopeEntries: (scopeDir) => {
          if (scopeDir === '/node_modules/@oneworks') return ['adapter-codex', 'adapter-claude-code']
          if (scopeDir === '/other/node_modules/@oneworks') return ['adapter-codex', 'adapter-opencode']
          return []
        },
        hasHookBridgeExport: () => false,
        loadHookBridge: () => undefined
      })
    ).toEqual([
      '@oneworks/adapter-claude-code',
      '@oneworks/adapter-codex',
      '@oneworks/adapter-opencode'
    ])
  })

  it('loads the active native hook bridge from installed adapters only', () => {
    const activeBridge = {
      isNativeHookEnv: () => true,
      runHookBridge: vi.fn()
    }

    const result = resolveActiveNativeHookBridge({
      resolveSearchPaths: () => ['/node_modules'],
      readAdapterScopeEntries: () => ['adapter-codex', 'adapter-opencode'],
      hasHookBridgeExport: (packageName) => packageName !== '@oneworks/adapter-opencode',
      loadHookBridge: (packageName) => (
        packageName === '@oneworks/adapter-codex'
          ? activeBridge
          : { invalid: true }
      )
    })

    expect(result).toBe(activeBridge)
  })

  it('prefers the adapter declared by the shared hook bridge env', () => {
    process.env.__ONEWORKS_HOOK_BRIDGE_ADAPTER__ = 'codex'
    const activeBridge = {
      isNativeHookEnv: () => true,
      runHookBridge: vi.fn()
    }
    const resolveSearchPaths = vi.fn(() => ['/node_modules'])

    const result = resolveActiveNativeHookBridge({
      resolveSearchPaths,
      readAdapterScopeEntries: () => ['adapter-codex'],
      hasHookBridgeExport: (packageName) => packageName === '@oneworks/adapter-codex',
      loadHookBridge: (packageName) => (
        packageName === '@oneworks/adapter-codex'
          ? activeBridge
          : undefined
      )
    })

    expect(result).toBe(activeBridge)
    expect(resolveSearchPaths).not.toHaveBeenCalled()
  })

  it('falls back to scanning installed adapters when the preferred bridge fails to load', () => {
    process.env.__ONEWORKS_HOOK_BRIDGE_ADAPTER__ = 'codex'
    const fallbackBridge = {
      isNativeHookEnv: () => true,
      runHookBridge: vi.fn()
    }

    const result = resolveActiveNativeHookBridge({
      resolveSearchPaths: () => ['/node_modules'],
      readAdapterScopeEntries: () => ['adapter-codex', 'adapter-claude-code'],
      hasHookBridgeExport: () => true,
      loadHookBridge: (packageName) => {
        if (packageName === '@oneworks/adapter-codex') {
          throw Object.assign(new Error('boom'), { code: 'ERR_MODULE_NOT_FOUND' })
        }
        return packageName === '@oneworks/adapter-claude-code' ? fallbackBridge : undefined
      }
    })

    expect(result).toBe(fallbackBridge)
  })

  it('skips native bridges that do not support the requested hook event', () => {
    process.env.__ONEWORKS_HOOK_EVENT_NAME__ = 'StartTasks'
    const unsupportedPreferredBridge = {
      isNativeHookEnv: () => true,
      runHookBridge: vi.fn(),
      supportsHookEvent: () => false
    }
    const fallbackBridge = {
      isNativeHookEnv: () => true,
      runHookBridge: vi.fn()
    }

    const result = resolveActiveNativeHookBridge({
      resolveSearchPaths: () => ['/node_modules'],
      readAdapterScopeEntries: () => ['adapter-claude-code', 'adapter-codex'],
      hasHookBridgeExport: () => true,
      loadHookBridge: (packageName) => (
        packageName === '@oneworks/adapter-claude-code'
          ? unsupportedPreferredBridge
          : fallbackBridge
      )
    })

    expect(result).toBe(fallbackBridge)
  })
})

describe('hook entrypoint', () => {
  it('runs the active native adapter bridge when one is available', async () => {
    const runHookBridge = vi.fn()
    const runHookCli = vi.fn()

    await runManagedHookEntrypoint({
      resolveActiveNativeHookBridge: () => ({
        isNativeHookEnv: () => true,
        runHookBridge
      }),
      runHookCli
    })

    expect(runHookBridge).toHaveBeenCalledTimes(1)
    expect(runHookCli).not.toHaveBeenCalled()
  })

  it('falls back to the default hook cli when no native bridge is active', async () => {
    const runHookCli = vi.fn()

    await runManagedHookEntrypoint({
      resolveActiveNativeHookBridge: () => undefined,
      runHookCli
    })

    expect(runHookCli).toHaveBeenCalledTimes(1)
  })

  it('falls back to the default hook cli when native bridge resolution throws', async () => {
    const runHookCli = vi.fn()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await runManagedHookEntrypoint({
      resolveActiveNativeHookBridge: () => {
        throw new Error('load failed')
      },
      runHookCli
    })

    expect(runHookCli).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalledTimes(1)

    errorSpy.mockRestore()
  })
})
