import { mkdir, mkdtemp, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DefinitionLoader } from '@oneworks/definition-loader'

import { safelyPublishFile } from '#~/services/ai/asset-create-filesystem.js'

describe('asset create commit state machine', () => {
  let workspace = ''

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(os.tmpdir(), 'ow-asset-commit-'))
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('retains private staging when the parent moves before visibility', async () => {
    const rulesDir = path.join(workspace, '.oo/rules')
    const outside = await mkdtemp(path.join(os.tmpdir(), 'ow-ai-mid-publish-'))
    const movedRules = path.join(outside, 'moved-rules')
    await mkdir(rulesDir, { recursive: true })

    await expect(safelyPublishFile({
      content: 'never outside',
      targetPath: path.join(rulesDir, 'mid-publish.md'),
      workspaceRoot: workspace
    }, {
      afterTempSync: async () => rename(rulesDir, movedRules)
    })).rejects.toMatchObject({
      code: 'asset_publish_failed',
      details: { committed: false, privateStaging: 'retained' },
      status: 500
    })

    expect(await readdir(movedRules)).toEqual([])
    const retained = (await readdir(workspace)).filter(name => name.startsWith('.asset-create-'))
    expect(retained).toHaveLength(1)
    await expect(readFile(path.join(workspace, retained[0]), 'utf8')).resolves.toBe('never outside')
    await rm(outside, { recursive: true, force: true })
  })

  it('never rolls back a visible target after a parent fsync failure', async () => {
    const targetPath = path.join(workspace, '.oo/rules/durability-unknown.md')
    await expect(safelyPublishFile({
      content: 'visible content',
      targetPath,
      workspaceRoot: workspace
    }, { fault: 'publish-sync' })).resolves.toEqual({
      state: 'committed-indeterminate',
      warnings: ['asset_parent_fsync_failed', 'asset_private_staging_retained']
    })
    await expect(readFile(targetPath, 'utf8')).resolves.toBe('visible content')
  })

  it('preserves a replacement installed before the post-visible identity probe', async () => {
    const targetPath = path.join(workspace, '.oo/rules/visible-replacement.md')
    await expect(safelyPublishFile({
      content: 'original publish',
      targetPath,
      workspaceRoot: workspace
    }, {
      afterVisible: async () => {
        await unlink(targetPath)
        await writeFile(targetPath, 'replacement-must-survive', { flag: 'wx' })
      }
    })).resolves.toEqual({
      state: 'committed-indeterminate',
      warnings: ['asset_target_identity_unconfirmed', 'asset_private_staging_retained']
    })
    await expect(readFile(targetPath, 'utf8')).resolves.toBe('replacement-must-survive')
  })

  it('preserves a replacement installed after the target identity probe', async () => {
    const targetPath = path.join(workspace, '.oo/rules/post-probe-replacement.md')
    await expect(safelyPublishFile({
      content: 'committed publish',
      targetPath,
      workspaceRoot: workspace
    }, {
      afterTargetProbe: async () => {
        await unlink(targetPath)
        await writeFile(targetPath, 'replacement-after-probe', { flag: 'wx' })
      }
    })).resolves.toEqual({
      state: 'committed-degraded',
      warnings: ['asset_private_staging_retained']
    })
    await expect(readFile(targetPath, 'utf8')).resolves.toBe('replacement-after-probe')
  })

  it('preserves a replacement that wins after the target-absent probe', async () => {
    const targetPath = path.join(workspace, '.oo/rules/no-overwrite.md')
    await expect(safelyPublishFile({
      content: 'must not overwrite',
      targetPath,
      workspaceRoot: workspace
    }, {
      afterTargetAbsent: async () => writeFile(targetPath, 'concurrent winner', { flag: 'wx' })
    })).rejects.toMatchObject({
      code: 'asset_exists',
      details: { committed: false, privateStaging: 'retained' },
      status: 409
    })
    await expect(readFile(targetPath, 'utf8')).resolves.toBe('concurrent winner')
  })

  it('never path-deletes a replacement of private staging', async () => {
    const targetPath = path.join(workspace, '.oo/rules/staging-replacement.md')
    let replacedStaging = ''
    await expect(safelyPublishFile({
      content: 'original staging',
      targetPath,
      workspaceRoot: workspace
    }, {
      afterTempSync: async ({ stagingName }) => {
        replacedStaging = path.join(workspace, stagingName!)
        await unlink(replacedStaging)
        await writeFile(replacedStaging, 'private replacement', { flag: 'wx' })
      }
    })).rejects.toMatchObject({
      code: 'asset_publish_failed',
      details: { committed: false, privateStaging: 'retained' }
    })
    await expect(readFile(replacedStaging, 'utf8')).resolves.toBe('private replacement')
    await expect(readFile(targetPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('returns indeterminate when target identity cannot be confirmed', async () => {
    const targetPath = path.join(workspace, '.oo/rules/indeterminate.md')
    await expect(safelyPublishFile({
      content: 'possibly committed',
      targetPath,
      workspaceRoot: workspace
    }, { fault: 'identity-probe' })).resolves.toEqual({
      state: 'committed-indeterminate',
      warnings: ['asset_target_identity_unconfirmed', 'asset_private_staging_retained']
    })
    await expect(readFile(targetPath, 'utf8')).resolves.toBe('possibly committed')
  })

  it('maps a post-visible crash to indeterminate and keeps status recoverable', async () => {
    const targetPath = path.join(workspace, '.oo/rules/response-lost.md')
    await expect(safelyPublishFile({
      content: '---\nname: Response Lost\n---\n# response-lost\n',
      targetPath,
      workspaceRoot: workspace
    }, { fault: 'response-after-visible' })).resolves.toEqual({
      state: 'committed-indeterminate',
      warnings: ['asset_publisher_response_lost', 'asset_private_staging_retained']
    })
    await expect(readFile(targetPath, 'utf8')).resolves.toContain('# response-lost')
    const loaded = await new DefinitionLoader(workspace).loadDefaultRules()
    expect(loaded.some(rule => rule.path.endsWith('/response-lost.md'))).toBe(true)
  })

  it('maps a pre-visible crash to committed false and retains private staging', async () => {
    const targetPath = path.join(workspace, '.oo/rules/pre-visible-crash.md')
    await expect(safelyPublishFile({
      content: 'private residue',
      targetPath,
      workspaceRoot: workspace
    }, { fault: 'crash-after-staging' })).rejects.toMatchObject({
      code: 'asset_publish_failed',
      details: { committed: false, privateStaging: 'retained' },
      status: 500
    })
    await expect(readFile(targetPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    const staging = (await readdir(workspace)).filter(name => name.startsWith('.asset-create-'))
    expect(staging).toHaveLength(1)
    await expect(readFile(path.join(workspace, staging[0]), 'utf8')).resolves.toBe('private residue')
  })
})
