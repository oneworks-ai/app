import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  isHostViteManagedClientChangeForTests,
  shouldIgnorePluginWatchPathForTests
} from '#~/services/plugins/runtime.js'

describe('plugin runtime host Vite watch classification', () => {
  const pluginRoot = path.resolve('/tmp/oneworks-plugin')
  const classify = (relativePath: string) =>
    isHostViteManagedClientChangeForTests({
      builtEntry: './client/dist/index.js',
      devEntry: './client/src/index.tsx',
      pluginRoot,
      relativePath,
      serverEntry: './server/src/index.ts'
    })

  it.each([
    'client/src/view.tsx',
    'client/src/styles.ts',
    'client/src/messages.json',
    'client/src/assets/icon.svg',
    'client/src/index.tsx'
  ])('leaves imported client source %s to the host Vite graph', (relativePath) => {
    expect(classify(relativePath)).toBe(true)
  })

  it.each([
    'client/dist/index.js',
    'client/dist/assets/control.js',
    'client/dist/style.css'
  ])('ignores generated client output %s while the source entry is active', (relativePath) => {
    expect(classify(relativePath)).toBe(true)
  })

  it.each([
    'client/assets/icon.svg',
    'plugin.json',
    'package.json',
    'server/src/index.ts',
    'server/dist/index.js',
    '../outside.ts'
  ])('keeps plugin or server change %s on the full reload path', (relativePath) => {
    expect(classify(relativePath)).toBe(false)
  })

  it('does not treat the entire plugin root as Vite-managed when entries live at the root', () => {
    const classifyRootEntry = (relativePath: string) =>
      isHostViteManagedClientChangeForTests({
        builtEntry: './index.js',
        devEntry: './index.tsx',
        pluginRoot,
        relativePath,
        serverEntry: './server/index.ts'
      })

    expect(classifyRootEntry('index.tsx')).toBe(false)
    expect(classifyRootEntry('view.ts')).toBe(false)
    expect(classifyRootEntry('plugin.json')).toBe(false)
    expect(classifyRootEntry('package.json')).toBe(false)
    expect(classifyRootEntry('server/helpers.ts')).toBe(false)
  })

  it('ignores Vite temporary config bundles created beside a plugin build config', () => {
    expect(
      shouldIgnorePluginWatchPathForTests(
        'client/vite.config.ts.timestamp-1784905693771-310ad46c759028.mjs'
      )
    ).toBe(true)
    expect(shouldIgnorePluginWatchPathForTests('client/vite.config.ts')).toBe(false)
  })

  it.runIf(path.sep === '/')('treats POSIX literal backslashes as filename bytes in watcher paths', () => {
    expect(shouldIgnorePluginWatchPathForTests(String.raw`src\node_modules\entry.ts`)).toBe(false)
    expect(shouldIgnorePluginWatchPathForTests('src/node_modules/entry.ts')).toBe(true)
    expect(classify(String.raw`client\src\view.tsx`)).toBe(false)
    expect(classify('client/src/view.tsx')).toBe(true)
  })
})
