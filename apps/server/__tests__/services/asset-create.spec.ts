import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DefinitionLoader } from '@oneworks/definition-loader'

import { createProjectAsset } from '#~/services/ai/asset-create.js'

const loader = { loadDefaultRules: async () => [] } as unknown as DefinitionLoader

describe('asset create native authority integration', () => {
  let root: string | undefined

  afterEach(async () => {
    if (root != null) await rm(root, { force: true, recursive: true })
    root = undefined
  })

  it('passes the current broker generation through a macOS-native publication', async () => {
    const native = await import('@oneworks/fs-authority-native/testing')
    root = await mkdtemp(join(tmpdir(), 'ow-server-asset-authority-'))
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    const prepared = native.prepareFilesystemAuthorityTestControlRoot(join(root, 'control'))
    const broker = await native.startFilesystemAuthorityBroker(prepared)
    try {
      const asset = await createProjectAsset({
        input: { kind: 'rule', name: 'Native Server Gate' },
        loader,
        openAuthority: workspaceRoot =>
          native.openFilesystemAuthorityForTest(workspaceRoot, {
            autoStart: false,
            controlRoot: prepared.controlRoot,
            secret: prepared.secret
          }),
        workspaceRoot: workspace
      })
      expect(asset).toEqual({ kind: 'rule', path: '.oo/rules/native-server-gate.md' })
      await expect(readFile(join(workspace, asset.path), 'utf8')).resolves.toContain('# Native Server Gate')
    } finally {
      await broker.close()
    }
  })

  it('closes the authority when pre-publication claim release is indeterminate', async () => {
    const close = vi.fn()
    root = await mkdtemp(join(tmpdir(), 'ow-server-asset-authority-'))
    await expect(createProjectAsset({
      input: { kind: 'rule', name: 'Claim Cleanup' },
      loader: {
        loadDefaultRules: async () => {
          throw new Error('semantic lookup failed')
        }
      } as unknown as DefinitionLoader,
      openAuthority: async () => ({
        capability: 'test',
        id: 'test',
        claim: async () => 1,
        close,
        publish: async () => ({ state: 'committed' as const }),
        release: async () => false
      }),
      workspaceRoot: root
    })).rejects.toMatchObject({ code: 'asset_claim_indeterminate' })
    expect(close).toHaveBeenCalledOnce()
  })
})
