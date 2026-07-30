import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resetConfigCache } from '@oneworks/config'
import { DefinitionLoader } from '@oneworks/definition-loader'

import { aiRouter } from '#~/routes/ai.js'
import { safelyPublishFile } from '#~/services/ai/asset-create-filesystem.js'
import { createProjectAsset } from '#~/services/ai/asset-create.js'

const findRouteHandler = (routePath: string, method: string) => {
  const router = aiRouter() as any
  const layer = router.stack.find((item: any) => item.path === routePath && item.methods.includes(method))
  if (layer == null) {
    throw new Error(`Route ${method} ${routePath} not found`)
  }
  return layer.stack[0] as (ctx: any) => Promise<void> | void
}

describe('aiRouter', () => {
  let workspaceFolder = ''
  const originalRealHome = process.env.__ONEWORKS_PROJECT_REAL_HOME__
  const originalServerRole = process.env.__ONEWORKS_PROJECT_SERVER_ROLE__
  const originalProjectWorkspaceFolder = process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__
  const originalWorkspaceFolder = process.env.WORKSPACE_FOLDER

  beforeEach(async () => {
    workspaceFolder = await mkdtemp(path.join(os.tmpdir(), 'ow-ai-routes-'))
    process.env.__ONEWORKS_PROJECT_REAL_HOME__ = path.join(workspaceFolder, '.test-home')
    process.env.__ONEWORKS_PROJECT_SERVER_ROLE__ = 'workspace'
    process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = workspaceFolder
    process.env.WORKSPACE_FOLDER = workspaceFolder
    resetConfigCache()
  })

  afterEach(async () => {
    await rm(workspaceFolder, { recursive: true, force: true })
    workspaceFolder = ''
    if (originalRealHome == null) {
      delete process.env.__ONEWORKS_PROJECT_REAL_HOME__
    } else {
      process.env.__ONEWORKS_PROJECT_REAL_HOME__ = originalRealHome
    }
    if (originalWorkspaceFolder == null) {
      delete process.env.WORKSPACE_FOLDER
    } else {
      process.env.WORKSPACE_FOLDER = originalWorkspaceFolder
    }
    if (originalServerRole == null) delete process.env.__ONEWORKS_PROJECT_SERVER_ROLE__
    else process.env.__ONEWORKS_PROJECT_SERVER_ROLE__ = originalServerRole
    if (originalProjectWorkspaceFolder == null) delete process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__
    else process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = originalProjectWorkspaceFolder
    resetConfigCache()
  })

  it('returns presenter-aligned skill detail payloads after creating a skill', async () => {
    const handleCreateSkill = findRouteHandler('/skills', 'POST')
    const ctx = {
      request: {
        body: {
          name: 'Research',
          description: 'Read docs',
          body: 'Use docs'
        }
      },
      status: undefined,
      body: undefined
    }

    await handleCreateSkill(ctx)

    expect(ctx.status).toBe(201)
    expect(ctx.body).toEqual({
      skill: {
        id: '.oo/skills/research/SKILL.md',
        name: 'research',
        description: 'Read docs',
        always: false,
        instancePath: undefined,
        source: 'project',
        sourceDetail: {
          kind: 'projectDefault'
        },
        body: 'Use docs'
      }
    })
    await expect(
      readFile(path.join(workspaceFolder, '.oo', 'skills', 'research', 'SKILL.md'), 'utf8')
    ).resolves.toBe('---\ndescription: "Read docs"\n---\n\nUse docs\n')
  })

  it('creates an entity template and rejects its semantic duplicate', async () => {
    const createAsset = findRouteHandler('/assets', 'POST')
    const ctx = {
      request: { body: { kind: 'entity', name: 'Customer Support', description: 'Handles questions' } },
      status: undefined,
      body: undefined
    }

    await createAsset(ctx)

    expect(ctx.status).toBe(201)
    expect(ctx.body).toEqual({
      asset: {
        commitState: 'committed-degraded',
        kind: 'entity',
        path: '.oo/entities/customer-support.md',
        warnings: ['asset_private_staging_retained']
      }
    })
    await expect(readFile(path.join(workspaceFolder, '.oo/entities/customer-support.md'), 'utf8')).resolves.toContain(
      'name: "Customer Support"'
    )
    await expect(createAsset({
      request: { body: { kind: 'entity', name: 'customer-support' } }
    })).rejects.toMatchObject({ code: 'asset_name_exists', status: 409 })
  })

  it('rejects a spec that collides with an existing directory entry semantic name', async () => {
    await mkdir(path.join(workspaceFolder, '.oo/specs/release'), { recursive: true })
    await writeFile(path.join(workspaceFolder, '.oo/specs/release/index.md'), '---\nname: release\n---\nExisting')
    const createAsset = findRouteHandler('/assets', 'POST')

    await expect(createAsset({
      request: { body: { kind: 'spec', name: 'Release', params: [{ name: 'version' }] } }
    })).rejects.toMatchObject({
      code: 'asset_name_exists',
      details: { committed: false },
      status: 409
    })
  })

  it('rejects a project entity that collides with a scoped plugin display or raw name', async () => {
    const pluginRoot = path.join(workspaceFolder, 'node_modules/@oneworks/plugin-review')
    await mkdir(path.join(pluginRoot, 'entities'), { recursive: true })
    await writeFile(
      path.join(pluginRoot, 'package.json'),
      JSON.stringify({
        name: '@oneworks/plugin-review',
        version: '1.0.0',
        exports: { '.': './index.js' }
      })
    )
    await writeFile(
      path.join(pluginRoot, 'index.js'),
      [
        'module.exports = {',
        '  __oneWorksPluginManifest: true,',
        '  assets: { entities: "./entities" }',
        '};',
        ''
      ].join('\n')
    )
    await writeFile(
      path.join(pluginRoot, 'entities/raw-reviewer.md'),
      '---\nname: Display Reviewer\ndescription: Plugin reviewer\n---\nReview'
    )
    await writeFile(
      path.join(workspaceFolder, '.oo.config.json'),
      JSON.stringify({
        plugins: [{ id: 'review', scope: 'team' }]
      })
    )
    const createAsset = findRouteHandler('/assets', 'POST')
    await expect(new DefinitionLoader(workspaceFolder).loadDefaultEntities()).resolves.toEqual([
      expect.objectContaining({
        attributes: expect.objectContaining({ name: 'Display Reviewer' }),
        resolvedName: 'team/Display Reviewer'
      })
    ])

    for (const name of ['Raw Reviewer', 'Display Reviewer', 'display-reviewer']) {
      await expect(createAsset({
        request: { body: { kind: 'entity', name } }
      })).rejects.toMatchObject({ code: 'asset_name_exists', status: 409 })
    }
  })

  it('lets only one concurrent semantic create acquire the lock', async () => {
    const createAsset = findRouteHandler('/assets', 'POST')
    const requests = await Promise.allSettled([
      createAsset({ request: { body: { kind: 'rule', name: 'Release Gate' } }, status: undefined }),
      createAsset({ request: { body: { kind: 'rule', name: 'release-gate' } }, status: undefined })
    ])

    expect(requests.filter(request => request.status === 'fulfilled')).toHaveLength(1)
    expect(requests.filter(request => request.status === 'rejected')).toHaveLength(1)
    await expect(readFile(path.join(workspaceFolder, '.oo/rules/release-gate.md'), 'utf8')).resolves.toMatch(
      /# (?:Release Gate|release-gate)\n/u
    )
  })

  it('does not follow an asset-parent symlink outside the workspace', async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), 'ow-ai-outside-'))
    await symlink(outside, path.join(workspaceFolder, '.oo'))
    const createAsset = findRouteHandler('/assets', 'POST')

    await expect(createAsset({ request: { body: { kind: 'rule', name: 'Review' } } })).rejects.toMatchObject({
      code: 'asset_destination_unsafe',
      status: 400
    })
    await expect(readFile(path.join(outside, 'rules/review.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await rm(outside, { recursive: true, force: true })
  })

  it('revalidates the parent after loader work when it is swapped for a symlink', async () => {
    const rulesDir = path.join(workspaceFolder, '.oo/rules')
    const outside = await mkdtemp(path.join(os.tmpdir(), 'ow-ai-swapped-parent-'))
    const loader = {
      loadDefaultRules: async () => {
        await rm(rulesDir, { recursive: true, force: true })
        await symlink(outside, rulesDir)
        return []
      }
    } as any

    await expect(createProjectAsset({
      input: { kind: 'rule', name: 'Swapped Parent' },
      loader,
      workspaceRoot: workspaceFolder
    })).rejects.toMatchObject({
      code: 'asset_destination_unsafe',
      details: { committed: false },
      status: 400
    })
    await expect(readFile(path.join(outside, 'swapped-parent.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await rm(outside, { recursive: true, force: true })
  })

  it('does not follow a final-file symlink during no-overwrite publish', async () => {
    const rulesDir = path.join(workspaceFolder, '.oo/rules')
    const outside = await mkdtemp(path.join(os.tmpdir(), 'ow-ai-final-symlink-'))
    const outsideFile = path.join(outside, 'outside.md')
    await writeFile(outsideFile, 'outside stays intact')
    await mkdir(rulesDir, { recursive: true })
    await symlink(outsideFile, path.join(rulesDir, 'review.md'))

    await expect(safelyPublishFile({
      content: 'replacement',
      targetPath: path.join(rulesDir, 'review.md'),
      workspaceRoot: workspaceFolder
    })).rejects.toMatchObject({ code: 'asset_exists', status: 409 })
    await expect(readFile(outsideFile, 'utf8')).resolves.toBe('outside stays intact')
    await rm(outside, { recursive: true, force: true })
  })

  it('accepts only the explicit create schema and never writes an invalid request', async () => {
    const createAsset = findRouteHandler('/assets', 'POST')

    await expect(createAsset({
      request: { body: { kind: 'rule', name: 'Review', path: '../../outside.md' } }
    })).rejects.toMatchObject({ code: 'invalid_asset_input', status: 400 })
    const inherited = Object.create({ kind: 'rule', name: 'Inherited Review' })
    await expect(createAsset({ request: { body: inherited } })).rejects.toMatchObject({
      code: 'invalid_asset_input',
      status: 400
    })
    await expect(createAsset({
      request: {
        body: {
          kind: 'spec',
          name: 'Symbol Review',
          params: [Object.assign({ name: 'value' }, { [Symbol('secret')]: 'hidden' })]
        }
      }
    })).rejects.toMatchObject({ code: 'invalid_asset_params', status: 400 })
    await expect(readFile(path.join(workspaceFolder, '.oo/rules/review.md'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it.each([
    'password hunter2',
    'Authorization: Bearer abcdefghijklmnopqrstuvwxyz',
    'github_token=ghp_abcdefghijklmnopqrstuvwxyz123456',
    'aws_access_key_id=AKIAIOSFODNN7EXAMPLE'
  ])('rejects credential-like content: %s', async (description) => {
    const createAsset = findRouteHandler('/assets', 'POST')

    await expect(createAsset({
      request: { body: { kind: 'rule', name: 'Sensitive Review', description } }
    })).rejects.toMatchObject({ code: 'asset_secret_rejected', status: 400 })
    await expect(readFile(path.join(workspaceFolder, '.oo/rules/sensitive-review.md'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects raw trailing spaces instead of silently changing the asset name', async () => {
    const createAsset = findRouteHandler('/assets', 'POST')

    await expect(createAsset({
      request: { body: { kind: 'rule', name: 'Review ' } }
    })).rejects.toMatchObject({ code: 'invalid_asset_name', status: 400 })
  })

  it('fails closed on manager and missing workspace authorities', async () => {
    const createAsset = findRouteHandler('/assets', 'POST')
    process.env.__ONEWORKS_PROJECT_SERVER_ROLE__ = 'manager'
    await expect(createAsset({
      request: { body: { kind: 'rule', name: 'Manager Review' } }
    })).rejects.toMatchObject({ code: 'asset_workspace_required', status: 400 })

    process.env.__ONEWORKS_PROJECT_SERVER_ROLE__ = 'workspace'
    delete process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__
    await expect(createAsset({
      request: { body: { kind: 'rule', name: 'Missing Review' } }
    })).rejects.toMatchObject({ code: 'asset_workspace_required', status: 400 })
  })

  it('canonicalizes a symlink workspace authority before creating', async () => {
    const alias = `${workspaceFolder}-alias`
    await symlink(workspaceFolder, alias)
    process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = alias
    const createAsset = findRouteHandler('/assets', 'POST')
    const ctx = {
      request: { body: { kind: 'rule', name: 'Canonical Root' } },
      status: undefined,
      body: undefined
    }

    await createAsset(ctx)
    expect(ctx.status).toBe(201)
    await expect(readFile(path.join(workspaceFolder, '.oo/rules/canonical-root.md'), 'utf8'))
      .resolves.toContain('# Canonical Root')
    await rm(alias)
  })

  it('previews the same validated destination without creating directories', async () => {
    const previewAsset = findRouteHandler('/assets/preview', 'GET')
    const ctx = {
      query: { kind: 'rule', name: 'Preview Review' },
      body: undefined
    }

    await previewAsset(ctx)

    expect(ctx.body).toEqual({ asset: { kind: 'rule', path: '.oo/rules/preview-review.md' } })
    await expect(readFile(path.join(workspaceFolder, '.oo/rules/preview-review.md'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps loader/revalidate/publish semantic locking across a directory move and crash', async () => {
    const baseDir = path.join(workspaceFolder, '.oo')
    const movedBaseDir = path.join(workspaceFolder, 'moved-oo')
    await mkdir(path.join(baseDir, 'rules'), { recursive: true })
    const moduleUrl = pathToFileURL(path.resolve('apps/server/src/services/ai/asset-create.ts')).href
    const definitionLoaderUrl = pathToFileURL(path.resolve('packages/definition-loader/src/index.ts')).href
    const registerLoaderUrl = pathToFileURL(path.resolve('packages/register/esm-loader.mjs')).href
    const script = `
      import { once } from 'node:events'
      import { DefinitionLoader } from ${JSON.stringify(definitionLoaderUrl)}
      const { createProjectAsset } = await import(${JSON.stringify(moduleUrl)})
      const realLoader = new DefinitionLoader(process.argv[1])
      const loader = {
        loadDefaultRules: async () => {
          process.stdout.write('LOCKED\\n')
          await once(process.stdin, 'data')
          return realLoader.loadDefaultRules()
        }
      }
      await createProjectAsset({
        input: { kind: 'rule', name: 'Release' },
        loader,
        workspaceRoot: process.argv[1]
      })
    `
    const child = spawn(process.execPath, [
      '--conditions=__oneworks__',
      '--loader',
      registerLoaderUrl,
      '--input-type=module',
      '--eval',
      script,
      workspaceFolder
    ], { cwd: path.resolve('.'), stdio: ['pipe', 'pipe', 'pipe'] })
    let childStderr = ''
    child.stderr.on('data', chunk => {
      childStderr += String(chunk)
    })
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject)
      const onExit = (code: number | null) =>
        reject(new Error(`lock child exited before claim: ${code}; ${childStderr}`))
      child.once('exit', onExit)
      child.stdout.once('data', chunk => {
        child.off('exit', onExit)
        expect(String(chunk)).toContain('LOCKED')
        resolve()
      })
    })

    await rename(baseDir, movedBaseDir)
    await mkdir(path.join(baseDir, 'rules'), { recursive: true })
    await expect(createProjectAsset({
      input: { kind: 'rule', name: 'release' },
      loader: new DefinitionLoader(workspaceFolder),
      workspaceRoot: workspaceFolder
    })).rejects.toMatchObject({
      code: 'asset_create_in_progress',
      details: { committed: false },
      status: 409
    })
    child.kill('SIGKILL')
    await new Promise<void>(resolve => child.once('exit', () => resolve()))

    await expect(createProjectAsset({
      input: { kind: 'rule', name: 'release' },
      loader: new DefinitionLoader(workspaceFolder),
      workspaceRoot: workspaceFolder
    })).resolves.toMatchObject({ kind: 'rule', path: '.oo/rules/release.md' })
    await expect(readFile(path.join(baseDir, 'rules/release.md'), 'utf8')).resolves.toContain('# release')
    await expect(readFile(path.join(movedBaseDir, 'rules/release.md'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a destination swapped after the publisher claims its directory authority', async () => {
    const rulesDir = path.join(workspaceFolder, '.oo/rules')
    const originalDir = path.join(workspaceFolder, '.oo/rules-original')
    const outside = await mkdtemp(path.join(os.tmpdir(), 'ow-ai-authority-swap-'))
    await mkdir(rulesDir, { recursive: true })

    await expect(safelyPublishFile({
      content: 'never redirected',
      targetPath: path.join(rulesDir, 'swapped.md'),
      workspaceRoot: workspaceFolder
    }, {
      afterAuthorityClaim: async () => {
        await rename(rulesDir, originalDir)
        await symlink(outside, rulesDir)
      }
    })).rejects.toMatchObject({
      code: 'asset_destination_changed',
      details: { committed: false },
      status: 400
    })

    await expect(readFile(path.join(outside, 'swapped.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(originalDir)).toEqual([])
    await rm(outside, { recursive: true, force: true })
  })

  it('never publishes through a destination moved outside after the last pathname check', async () => {
    const rulesDir = path.join(workspaceFolder, '.oo/rules')
    const outside = await mkdtemp(path.join(os.tmpdir(), 'ow-ai-moved-authority-'))
    const movedRules = path.join(outside, 'moved-rules')
    await mkdir(rulesDir, { recursive: true })

    await expect(safelyPublishFile({
      content: 'never outside',
      targetPath: path.join(rulesDir, 'escaped.md'),
      workspaceRoot: workspaceFolder
    }, {
      afterAuthorityClaim: async () => rename(rulesDir, movedRules)
    })).rejects.toMatchObject({
      code: 'asset_destination_changed',
      details: { committed: false },
      status: 400
    })

    expect(await readdir(movedRules)).toEqual([])
    await rm(outside, { recursive: true, force: true })
  })

  it('labels globally configured skills as global config sources', async () => {
    await mkdir(path.join(workspaceFolder, '.oo', 'skills', 'internal-review'), { recursive: true })
    await writeFile(
      path.join(workspaceFolder, '.oo', 'skills', 'internal-review', 'SKILL.md'),
      '---\nname: internal-review\ndescription: review skill\n---\nReview skill body\n'
    )
    const homeDir = process.env.__ONEWORKS_PROJECT_REAL_HOME__!
    await mkdir(path.join(homeDir, '.oneworks'), { recursive: true })
    await writeFile(
      path.join(homeDir, '.oneworks', '.oo.config.json'),
      JSON.stringify({
        skills: ['internal-review']
      })
    )
    resetConfigCache()

    const handleListSkills = findRouteHandler('/skills', 'GET')
    const ctx = {
      body: undefined
    }

    await handleListSkills(ctx)

    expect(ctx.body).toEqual({
      skills: [
        expect.objectContaining({
          name: 'internal-review',
          sourceDetail: {
            kind: 'globalConfig',
            configSource: 'global',
            configLabel: '~/.oneworks/.oo.config.json'
          }
        })
      ]
    })
  })
})
