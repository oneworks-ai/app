import { describe, expect, it } from 'vitest'

import type { PublicPluginClientManifest, PublicPluginDiagnostic, PublicPluginRuntimeInstance } from '../src/plugin'

describe('public plugin runtime types', () => {
  it('do not admit private discovery roots', () => {
    const runtime: PublicPluginRuntimeInstance = {
      requestId: 'docs',
      // @ts-expect-error Public plugin instances must never carry a resolver root.
      rootDir: '/private/root',
      scope: 'docs'
    }
    const diagnostic: PublicPluginDiagnostic = {
      level: 'warning',
      message: 'safe',
      // @ts-expect-error Public diagnostics must never carry a plugin root.
      pluginRoot: '/private/root'
    }
    const client: PublicPluginClientManifest = {
      entry: 'client/index.ts',
      // @ts-expect-error Public client metadata uses authorized URLs, not source roots.
      sourceRoot: '/private/root'
    }

    expect(runtime.scope).toBe('docs')
    expect(diagnostic.message).toBe('safe')
    expect(client.entry).toBe('client/index.ts')
  })
})
