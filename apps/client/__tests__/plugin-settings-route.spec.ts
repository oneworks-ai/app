import { describe, expect, it } from 'vitest'

import { resolveSettingsTabKey } from '#~/components/plugins/plugin-settings-route'

describe('plugin settings route resolution', () => {
  it('preserves an asynchronous plugin page deep link while the snapshot loads', () => {
    expect(resolveSettingsTabKey({
      availableTabKeys: new Set(['general', 'plugins']),
      requestedTabKey: 'plugin:demo:page',
      snapshotStatus: 'loading'
    })).toBe('plugin:demo:page')
  })

  it('resolves the same deep link when its contribution arrives', () => {
    expect(resolveSettingsTabKey({
      availableTabKeys: new Set(['general', 'plugins', 'plugin:demo:page']),
      requestedTabKey: 'plugin:demo:page',
      snapshotStatus: 'ready'
    })).toBe('plugin:demo:page')
  })

  it('falls back to plugin management when the page is unavailable after loading', () => {
    expect(resolveSettingsTabKey({
      availableTabKeys: new Set(['general', 'plugins']),
      requestedTabKey: 'plugin:disabled:page',
      snapshotStatus: 'ready'
    })).toBe('plugins')
    expect(resolveSettingsTabKey({
      availableTabKeys: new Set(['general', 'plugins']),
      requestedTabKey: 'plugin:failed:page',
      snapshotStatus: 'error'
    })).toBe('plugins')
  })
})
