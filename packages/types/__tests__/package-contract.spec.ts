import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const packageJson = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
  exports: Record<string, unknown>
}

describe('types package export contract', () => {
  it('keeps root and standalone-route baseline export shapes', () => {
    expect(packageJson.exports['.']).toEqual({
      __oneworks__: { default: './src/index.ts' },
      default: { import: './dist/index.mjs', require: './dist/index.js' }
    })
    expect(packageJson.exports['./standalone-route']).toEqual({
      __oneworks__: { default: './src/standalone-route.ts' },
      default: { import: './dist/standalone-route.mjs', require: './dist/standalone-route.js' }
    })
  })

  it('publishes the self-contained app-build-info runtime targets from source files', () => {
    expect(packageJson.exports['./app-build-info']).toEqual({
      types: './src/app-build-info-runtime.d.ts',
      __oneworks__: { default: './src/app-build-info.ts' },
      import: './src/app-build-info-runtime.js',
      require: './src/app-build-info-runtime.js',
      default: './src/app-build-info-runtime.js'
    })
    for (const file of [
      'src/app-build-info-runtime.d.ts',
      'src/app-build-info-runtime.js',
      'src/app-build-info.ts'
    ]) {
      expect(existsSync(resolve(packageRoot, file))).toBe(true)
    }
  })
})
