import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(__filename)
const { buildServerRuntimeBundle } = require('../scripts/build-runtime.cjs') as {
  buildServerRuntimeBundle: (input: { outfile: string }) => Promise<{
    metafile: {
      outputs: Record<string, { bytes?: number; imports: Array<{ external?: boolean; path: string }> }>
    }
  }>
}

describe('server runtime bundle build', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
  })

  it('bundles One Works startup modules while preserving package-owned runtime dependencies', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'oneworks-server-runtime-bundle-'))
    tempDirs.push(tempDir)
    const outfile = path.join(tempDir, 'index.mjs')

    const result = await buildServerRuntimeBundle({ outfile })
    const output = await readFile(outfile, 'utf8')
    const outputs = Object.entries(result.metafile.outputs)
    const externalImports = outputs
      .flatMap(([, metadata]) => metadata.imports)
      .filter(entry => entry.external === true)
      .map(entry => entry.path)

    const entrySize = (await stat(outfile)).size
    const totalOutputSize = outputs.reduce((total, [, metadata]) => total + (metadata.bytes ?? 0), 0)
    expect(entrySize).toBeGreaterThan(20_000)
    expect(entrySize).toBeLessThan(500_000)
    expect(totalOutputSize).toBeGreaterThan(1_000_000)
    expect(output).toContain('[server-startup]')
    expect(outputs.length).toBeGreaterThan(10)
    expect(output).toContain('import(')
    expect(externalImports).toContain('koa')
    expect(externalImports).toContain('pino')
    expect(externalImports).toContain('vite')
    expect(externalImports).toContain('@oneworks/fs-authority-native')
    expect(
      [...new Set(externalImports.filter(entry => entry.startsWith('@oneworks/')))]
    ).toEqual(['@oneworks/fs-authority-native'])
    expect(output).not.toContain('Filesystem authority broker secret is unsafe')
  })
})
