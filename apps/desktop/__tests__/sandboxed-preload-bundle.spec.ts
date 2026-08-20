import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  collectStaticRequires,
  verifySandboxedPreloadBundle,
  verifySandboxedPreloadSource
} = require('../scripts/verify-sandboxed-preload.cjs') as {
  collectStaticRequires: (source: string) => string[]
  verifySandboxedPreloadBundle: (preloadPath: string) => string[]
  verifySandboxedPreloadSource: (source: string) => string[]
}

describe('sandboxed preload bundle', () => {
  it('allows only modules provided by the Electron sandbox preload polyfill', () => {
    const source = `
      const electron = require('electron')
      const events = require('node:events')
    `

    expect(verifySandboxedPreloadSource(source)).toEqual(['electron', 'node:events'])
  })

  it('rejects workspace packages left as runtime requires', () => {
    const source = `
      const electron = require('electron')
      const types = require /* emitted comment */ ('@oneworks/types')
    `

    expect(() => verifySandboxedPreloadSource(source)).toThrow(
      'Sandboxed preload bundle contains unsupported external require(s): @oneworks/types'
    )
  })

  it('rejects unsupported template-literal requires in an emitted bundle file', () => {
    const artifactDirectory = mkdtempSync(join(tmpdir(), 'oneworks-preload-verifier-'))
    const artifactPath = join(artifactDirectory, 'index.js')

    try {
      writeFileSync(artifactPath, 'const types = require(`@oneworks/types`)')
      expect(() => verifySandboxedPreloadBundle(artifactPath)).toThrow(
        'Sandboxed preload bundle contains unsupported external require(s): @oneworks/types'
      )
    } finally {
      rmSync(artifactDirectory, { force: true, recursive: true })
    }
  })

  it('fails closed when a require target is dynamic', () => {
    const dynamicRequire = 'require(`@oneworks/$' + '{packageName}`)'
    expect(() => verifySandboxedPreloadSource(dynamicRequire)).toThrow(
      'Sandboxed preload bundle contains non-static require call(s)'
    )
  })

  it('collects each static require once in stable order', () => {
    expect(collectStaticRequires(`
      require ('url')
      require /* generated comment */ ("electron")
      require('url')
    `)).toEqual(['electron', 'url'])
  })
})
