import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  collectStaticRequires,
  verifySandboxedPreloadSource
} = require('../scripts/verify-sandboxed-preload.cjs') as {
  collectStaticRequires: (source: string) => string[]
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
      const types = require('@oneworks/types')
    `

    expect(() => verifySandboxedPreloadSource(source)).toThrow(
      'Sandboxed preload bundle contains unsupported external require(s): @oneworks/types'
    )
  })

  it('collects each static require once in stable order', () => {
    expect(collectStaticRequires(`
      require('url')
      require("electron")
      require('url')
    `)).toEqual(['electron', 'url'])
  })
})
