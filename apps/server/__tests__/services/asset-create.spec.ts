import { fork } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { DefinitionLoader } from '@oneworks/definition-loader'

import { createProjectAsset } from '#~/services/ai/asset-create.js'

const loader = { loadDefaultRules: async () => [] } as unknown as DefinitionLoader
const nodeRequire = createRequire(__filename)

const waitForMessage = <T>(child: ReturnType<typeof fork>, predicate: (message: unknown) => message is T) =>
  new Promise<T>((resolve, reject) => {
    const onMessage = (message: unknown) => {
      if (!predicate(message)) return
      cleanup()
      resolve(message)
    }
    const onExit = (code: number | null) => {
      cleanup()
      reject(new Error(`Asset semantic worker exited before response: ${code}`))
    }
    const cleanup = () => {
      child.off('message', onMessage)
      child.off('exit', onExit)
    }
    child.on('message', onMessage)
    child.once('exit', onExit)
  })

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
    await writeFile(join(workspace, '.oo.config.json'), JSON.stringify({ plugins: [] }), 'utf8')
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

  it('holds the cross-process broker claim while a real loader revalidates x/index.md', async () => {
    const native = await import('@oneworks/fs-authority-native/testing')
    root = await mkdtemp(join(tmpdir(), 'ow-server-asset-semantic-'))
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    await writeFile(join(workspace, '.oo.config.json'), JSON.stringify({ plugins: [] }), 'utf8')
    const prepared = native.prepareFilesystemAuthorityTestControlRoot(join(root, 'control'))
    const broker = await native.startFilesystemAuthorityBroker(prepared)
    const child = fork(join(__dirname, '../fixtures/asset-create-semantic-worker.ts'), [], {
      env: {
        ...process.env,
        ASSET_TEST_CONTROL_ROOT: prepared.controlRoot,
        ASSET_TEST_SECRET: prepared.secret,
        ASSET_TEST_WORKSPACE: workspace,
        __ONEWORKS_PROJECT_CONFIG_DIR__: workspace,
        __ONEWORKS_PROJECT_DISABLE_DEV_CONFIG__: '1',
        __ONEWORKS_PROJECT_DISABLE_GLOBAL_CONFIG__: '1',
        __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: workspace,
        WORKSPACE_FOLDER: workspace
      },
      execArgv: [
        '--conditions=__oneworks__',
        '--loader',
        nodeRequire.resolve('@oneworks/register/esm-loader'),
        '-r',
        nodeRequire.resolve('@oneworks/register/preload')
      ],
      silent: true
    })
    try {
      await waitForMessage(
        child,
        (message): message is { type: 'loader-ready' } =>
          typeof message === 'object' && message != null && (message as { type?: unknown }).type === 'loader-ready'
      )
      const contender = await native.openFilesystemAuthorityForTest(workspace, {
        autoStart: false,
        controlRoot: prepared.controlRoot,
        secret: prepared.secret
      })
      await expect(contender.claim('spec', 'x')).rejects.toMatchObject({ code: 'asset_create_in_progress' })
      contender.close()
      await mkdir(join(workspace, '.oo/specs/x'), { recursive: true })
      await writeFile(join(workspace, '.oo/specs/x/index.md'), '# x\n', 'utf8')
      child.send('continue')
      const result = await waitForMessage(child, (message): message is {
        code?: string
        cause?: string
        details?: { committed?: boolean }
        message?: string
        ok: boolean
        type: 'result'
      } => typeof message === 'object' && message != null && (message as { type?: unknown }).type === 'result')
      expect(result.code, JSON.stringify(result)).toBe('asset_name_exists')
      expect(result).toMatchObject({
        type: 'result',
        ok: false,
        code: 'asset_name_exists',
        details: { committed: false }
      })
      await expect(readFile(join(workspace, '.oo/specs/x.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      child.kill('SIGKILL')
      await broker.close()
    }
  })

  it('uses real loader directory, plugin raw, attribute, and display candidates', async () => {
    const native = await import('@oneworks/fs-authority-native/testing')
    root = await mkdtemp(join(tmpdir(), 'ow-server-asset-loader-'))
    const workspace = join(root, 'workspace')
    const pluginRoot = join(workspace, 'node_modules/@oneworks/plugin-demo')
    await mkdir(join(workspace, '.oo/entities/directory-name'), { recursive: true })
    await writeFile(join(workspace, '.oo/entities/directory-name/README.md'), '# Directory Name\n', 'utf8')
    await mkdir(join(pluginRoot, 'rules'), { recursive: true })
    await writeFile(
      join(workspace, '.oo.config.json'),
      JSON.stringify({
        plugins: [{ id: 'demo', scope: 'review-scope' }]
      }),
      'utf8'
    )
    await writeFile(
      join(pluginRoot, 'package.json'),
      JSON.stringify({
        name: '@oneworks/plugin-demo',
        version: '1.0.0'
      }),
      'utf8'
    )
    await writeFile(
      join(pluginRoot, 'rules/raw-file.md'),
      '---\nname: Attribute Name\ndescription: plugin rule\n---\nPlugin rule\n',
      'utf8'
    )
    const realLoader = new DefinitionLoader(workspace)
    const definitions = await realLoader.loadDefaultRules()
    expect(definitions).toEqual(expect.arrayContaining([
      expect.objectContaining({ resolvedName: 'review-scope/Attribute Name' })
    ]))
    const prepared = native.prepareFilesystemAuthorityTestControlRoot(join(root, 'control'))
    const broker = await native.startFilesystemAuthorityBroker(prepared)
    const openAuthority = (workspaceRoot: string) =>
      native.openFilesystemAuthorityForTest(workspaceRoot, {
        autoStart: false,
        controlRoot: prepared.controlRoot,
        secret: prepared.secret
      })
    try {
      for (
        const input of [
          { kind: 'entity' as const, name: 'Directory Name' },
          { kind: 'rule' as const, name: 'Raw File' },
          { kind: 'rule' as const, name: 'Attribute Name' },
          { kind: 'rule' as const, name: 'Review Scope Attribute Name' }
        ]
      ) {
        await expect(createProjectAsset({
          input,
          loader: new DefinitionLoader(workspace),
          openAuthority,
          workspaceRoot: workspace
        })).rejects.toMatchObject({ code: 'asset_name_exists', details: { committed: false } })
      }
    } finally {
      await broker.close()
    }
  })

  it.each([
    Object.assign(Object.create(null) as Record<string, unknown>, { kind: 'rule', name: 'Null Prototype' }),
    { kind: 'rule', name: 'Extra Field', unexpected: true },
    { kind: 'rule', name: 'Rule Params', params: [{ name: 'forbidden' }] },
    { kind: 'spec', name: 'Nested Extra', params: [{ name: 'ok', unexpected: true }] },
    {
      kind: 'spec',
      name: 'Nested Prototype',
      params: [Object.assign(Object.create(null) as Record<string, unknown>, { name: 'unsafe' })]
    }
  ])('rejects non-plain, non-allowlisted, and kind-invalid input before authority access', async (input) => {
    const openAuthority = vi.fn()
    await expect(createProjectAsset({
      input,
      loader,
      openAuthority,
      workspaceRoot: '/unused'
    })).rejects.toMatchObject({ details: { committed: false } })
    expect(openAuthority).not.toHaveBeenCalled()
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
        claimMutation: async () => {
          throw new Error('unexpected managed-tree claim')
        },
        close,
        prepareManagedTree: async () => {
          throw new Error('unexpected managed-tree preparation')
        },
        publish: async () => ({ state: 'committed' as const }),
        removeManagedTree: async () => {
          throw new Error('unexpected managed-tree removal')
        },
        release: async () => false,
        restoreManagedTree: async () => {
          throw new Error('unexpected managed-tree restore')
        },
        stageManagedTree: async () => {
          throw new Error('unexpected managed-tree stage')
        }
      }),
      workspaceRoot: root
    })).rejects.toMatchObject({ code: 'asset_claim_indeterminate' })
    expect(close).toHaveBeenCalledOnce()
  })

  it('preserves post-visible indeterminate truth and treats unknown publish failure as indeterminate', async () => {
    root = await mkdtemp(join(tmpdir(), 'ow-server-asset-authority-'))
    const authority = (publish: () => Promise<any>) => ({
      capability: 'test',
      id: 'test',
      claim: async () => 1,
      claimMutation: async () => {
        throw new Error('unexpected managed-tree claim')
      },
      close: vi.fn(),
      prepareManagedTree: async () => {
        throw new Error('unexpected managed-tree preparation')
      },
      publish,
      release: async () => true,
      removeManagedTree: async () => {
        throw new Error('unexpected managed-tree removal')
      },
      restoreManagedTree: async () => {
        throw new Error('unexpected managed-tree restore')
      },
      stageManagedTree: async () => {
        throw new Error('unexpected managed-tree stage')
      }
    })
    const input = { kind: 'rule', name: 'Commit Truth' }
    const indeterminate = await createProjectAsset({
      input,
      loader,
      openAuthority: async () =>
        authority(async () => ({
          state: 'committed-indeterminate',
          warnings: ['asset_target_identity_unconfirmed']
        })),
      workspaceRoot: root
    })
    expect(indeterminate).toMatchObject({
      commitState: 'committed-indeterminate',
      warnings: ['asset_target_identity_unconfirmed']
    })

    await expect(createProjectAsset({
      input: { kind: 'rule', name: 'Unknown Publish' },
      loader,
      openAuthority: async () =>
        authority(async () => {
          throw new Error('response lost')
        }),
      workspaceRoot: root
    })).rejects.toMatchObject({
      code: 'asset_publish_indeterminate',
      details: { committed: 'indeterminate' }
    })
  })

  it('marks semantic loader failure as explicit committed false', async () => {
    root = await mkdtemp(join(tmpdir(), 'ow-server-asset-authority-'))
    await expect(createProjectAsset({
      input: { kind: 'rule', name: 'Semantic Fault' },
      loader: {
        loadDefaultRules: async () => {
          throw new Error('loader failed')
        }
      } as unknown as DefinitionLoader,
      openAuthority: async () => ({
        capability: 'test',
        id: 'test',
        claim: async () => 1,
        claimMutation: async () => {
          throw new Error('unexpected')
        },
        close: vi.fn(),
        prepareManagedTree: async () => {
          throw new Error('unexpected')
        },
        publish: async () => ({ state: 'committed' as const }),
        release: async () => true,
        removeManagedTree: async () => {
          throw new Error('unexpected')
        },
        restoreManagedTree: async () => {
          throw new Error('unexpected')
        },
        stageManagedTree: async () => {
          throw new Error('unexpected')
        }
      }),
      workspaceRoot: root
    })).rejects.toMatchObject({ details: { committed: false } })
  })
})
