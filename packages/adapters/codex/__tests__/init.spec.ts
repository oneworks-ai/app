/* eslint-disable max-lines */
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveProjectHomePath } from '@oneworks/utils/ai-path'

import { resolveCodexConfigOverrides } from '../src/runtime/config'
import { initCodexAdapter } from '../src/runtime/init'

const tempDirs: string[] = []

const createBarrier = (size: number) => {
  let pending = size
  let release: (() => void) | undefined
  const waitForAll = new Promise<void>((resolve) => {
    release = resolve
  })

  return async () => {
    pending -= 1
    if (pending === 0) {
      release?.()
    }
    await waitForAll
  }
}

const createWorkspace = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-init-'))
  tempDirs.push(dir)
  return dir
}

const resolveTestMockHome = (workspace: string, realHome: string) =>
  resolveProjectHomePath(workspace, { HOME: realHome, __ONEWORKS_PROJECT_REAL_HOME__: realHome }, '.mock')

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('initCodexAdapter', () => {
  it('symlinks workspace skills into both Codex skill locations while preserving system skills', async () => {
    const workspace = await createWorkspace()
    const realHome = join(workspace, 'real-home')
    const mockHome = resolveTestMockHome(workspace, realHome)

    await mkdir(join(workspace, '.oo', 'skills', 'research'), { recursive: true })
    await writeFile(join(workspace, '.oo', 'skills', 'research', 'SKILL.md'), '# Research\n')
    await mkdir(join(realHome, '.codex'), { recursive: true })
    await mkdir(join(mockHome, '.codex', 'skills', '.system'), { recursive: true })
    await writeFile(join(mockHome, '.codex', 'skills', '.system', '.codex-system-skills.marker'), '')

    await initCodexAdapter({
      cwd: workspace,
      env: {
        HOME: mockHome,
        __ONEWORKS_PROJECT_REAL_HOME__: realHome,
        __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: '/bin/codex'
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      },
      assets: {
        hookPlugins: []
      }
    } as any)

    const targetPath = join(mockHome, '.agents', 'skills')
    expect((await lstat(targetPath)).isSymbolicLink()).toBe(true)
    expect(resolve(dirname(targetPath), await readlink(targetPath))).toBe(resolve(workspace, '.oo', 'skills'))

    const nativeSkillPath = join(mockHome, '.codex', 'skills', 'research')
    expect((await lstat(nativeSkillPath)).isSymbolicLink()).toBe(true)
    expect(resolve(dirname(nativeSkillPath), await readlink(nativeSkillPath))).toBe(
      resolve(workspace, '.oo', 'skills', 'research')
    )
    expect((await lstat(join(mockHome, '.codex', 'skills', '.system'))).isDirectory()).toBe(true)
    expect(
      JSON.parse(
        await readFile(join(mockHome, '.codex', 'skills', '.oneworks-managed-skills.json'), 'utf8')
      )
    ).toEqual({
      skills: ['research']
    })
  })

  it('claims bridged Codex config before writing managed mock-home config', async () => {
    const workspace = await createWorkspace()
    const realHome = join(workspace, 'real-home')
    const mockHome = resolveTestMockHome(workspace, realHome)
    const realConfigPath = join(realHome, '.codex', 'config.toml')
    const mockConfigPath = join(mockHome, '.codex', 'config.toml')

    await mkdir(join(realHome, '.codex'), { recursive: true })
    await mkdir(join(mockHome, '.codex'), { recursive: true })
    const realConfigContent = [
      'model = "gpt-5.5"',
      'model_provider = "openai"',
      'check_for_update_on_startup = true',
      '',
      '[notice]',
      'hide_full_access_warning = true',
      ''
    ].join('\n')
    await writeFile(realConfigPath, realConfigContent)
    await symlink(realConfigPath, mockConfigPath)

    await initCodexAdapter({
      cwd: workspace,
      env: {
        HOME: mockHome,
        __ONEWORKS_PROJECT_REAL_HOME__: realHome,
        __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: '/bin/codex'
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      },
      assets: {
        hookPlugins: []
      }
    } as any)

    expect((await lstat(mockConfigPath)).isSymbolicLink()).toBe(false)
    expect(await readFile(realConfigPath, 'utf8')).toBe(realConfigContent)

    const mockConfigContent = await readFile(mockConfigPath, 'utf8')
    expect(mockConfigContent).toContain('model = "gpt-5.5"')
    expect(mockConfigContent).toContain('model_provider = "openai"')
    expect(mockConfigContent).toContain('[notice]')
    expect(mockConfigContent).toContain('hide_full_access_warning = true')
    expect(mockConfigContent.match(/check_for_update_on_startup/g) ?? []).toHaveLength(1)
    expect(mockConfigContent).toContain('check_for_update_on_startup = false')
  })

  it('normalizes inherited legacy Codex service tiers in the mock-home config only', async () => {
    const workspace = await createWorkspace()
    const realHome = join(workspace, 'real-home')
    const mockHome = resolveTestMockHome(workspace, realHome)
    const realConfigPath = join(realHome, '.codex', 'config.toml')
    const mockConfigPath = join(mockHome, '.codex', 'config.toml')

    await mkdir(join(realHome, '.codex'), { recursive: true })
    const realConfigContent = [
      'model = "gpt-5.5"',
      '',
      '# BEGIN VIBE FORGE MANAGED CODEX ROOT CONFIG',
      '# This root-level block is managed by Vibe Forge.',
      'service_tier = "priority"',
      '# END VIBE FORGE MANAGED CODEX ROOT CONFIG',
      '',
      '[notice]',
      'hide_full_access_warning = true',
      ''
    ].join('\n')
    await writeFile(realConfigPath, realConfigContent)

    await initCodexAdapter({
      cwd: workspace,
      env: {
        HOME: mockHome,
        __ONEWORKS_PROJECT_REAL_HOME__: realHome,
        __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: '/bin/codex'
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      },
      assets: {
        hookPlugins: []
      }
    } as any)

    expect(await readFile(realConfigPath, 'utf8')).toBe(realConfigContent)

    const mockConfigContent = await readFile(mockConfigPath, 'utf8')
    expect(mockConfigContent).toContain('# BEGIN VIBE FORGE MANAGED CODEX ROOT CONFIG')
    expect(mockConfigContent).toContain('service_tier = "fast"')
    expect(mockConfigContent).not.toContain('service_tier = "priority"')
    expect(mockConfigContent).toContain('[notice]')
    expect(mockConfigContent).toContain('hide_full_access_warning = true')
    expect(mockConfigContent).toContain('check_for_update_on_startup = false')
  })

  it('rehydrates a managed-only mock Codex config from the real user config', async () => {
    const workspace = await createWorkspace()
    const realHome = join(workspace, 'real-home')
    const mockHome = resolveTestMockHome(workspace, realHome)
    const realConfigPath = join(realHome, '.codex', 'config.toml')
    const mockConfigPath = join(mockHome, '.codex', 'config.toml')

    await mkdir(join(realHome, '.codex'), { recursive: true })
    await mkdir(join(mockHome, '.codex'), { recursive: true })
    await writeFile(
      realConfigPath,
      [
        'model = "gpt-5.5"',
        '',
        '[notice]',
        'hide_full_access_warning = true',
        ''
      ].join('\n')
    )
    await writeFile(
      mockConfigPath,
      [
        '# BEGIN ONE WORKS MANAGED CODEX ROOT CONFIG',
        '# This root-level block is managed by One Works.',
        'check_for_update_on_startup = false',
        '# END ONE WORKS MANAGED CODEX ROOT CONFIG',
        '',
        '# BEGIN ONE WORKS MANAGED CODEX PROJECT CONFIG',
        '# This project block is managed by One Works.',
        `[projects.${JSON.stringify(resolve(workspace))}]`,
        'trust_level = "trusted"',
        '# END ONE WORKS MANAGED CODEX PROJECT CONFIG',
        '',
        '# BEGIN ONE WORKS MANAGED CODEX HOOK TRUST',
        '# This block is managed by One Works to satisfy Codex native hook trust checks.',
        '',
        '[hooks.state."/tmp/hooks.json:pre_tool_use:0:0"]',
        'trusted_hash = "sha256:abc"',
        '# END ONE WORKS MANAGED CODEX HOOK TRUST',
        ''
      ].join('\n')
    )

    await initCodexAdapter({
      cwd: workspace,
      env: {
        HOME: mockHome,
        __ONEWORKS_PROJECT_REAL_HOME__: realHome,
        __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: '/bin/codex'
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      },
      assets: {
        hookPlugins: []
      }
    } as any)

    const mockConfigContent = await readFile(mockConfigPath, 'utf8')
    expect(mockConfigContent).toContain('model = "gpt-5.5"')
    expect(mockConfigContent).toContain('[notice]')
    expect(mockConfigContent).toContain('hide_full_access_warning = true')
    expect(mockConfigContent).toContain('check_for_update_on_startup = false')
    expect(mockConfigContent.match(/BEGIN ONE WORKS MANAGED CODEX PROJECT CONFIG/g)).toHaveLength(1)
  })

  it('preserves unmanaged mock Codex config content over real user config', async () => {
    const workspace = await createWorkspace()
    const realHome = join(workspace, 'real-home')
    const mockHome = resolveTestMockHome(workspace, realHome)
    const realConfigPath = join(realHome, '.codex', 'config.toml')
    const mockConfigPath = join(mockHome, '.codex', 'config.toml')

    await mkdir(join(realHome, '.codex'), { recursive: true })
    await mkdir(join(mockHome, '.codex'), { recursive: true })
    await writeFile(realConfigPath, 'model = "gpt-5.5"\n')
    await writeFile(
      mockConfigPath,
      [
        'model = "gpt-5.4"',
        '',
        '[notice]',
        'hide_full_access_warning = true',
        ''
      ].join('\n')
    )

    await initCodexAdapter({
      cwd: workspace,
      env: {
        HOME: mockHome,
        __ONEWORKS_PROJECT_REAL_HOME__: realHome,
        __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: '/bin/codex'
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      },
      assets: {
        hookPlugins: []
      }
    } as any)

    const mockConfigContent = await readFile(mockConfigPath, 'utf8')
    expect(mockConfigContent).toContain('model = "gpt-5.4"')
    expect(mockConfigContent).not.toContain('model = "gpt-5.5"')
    expect(mockConfigContent).toContain('[notice]')
    expect(mockConfigContent).toContain('hide_full_access_warning = true')
  })

  it('symlinks resolved asset skills into both Codex skill locations', async () => {
    const workspace = await createWorkspace()
    const realHome = join(workspace, 'real-home')
    const mockHome = resolveTestMockHome(workspace, realHome)
    const appSkillDir = join(workspace, '.oo', 'skills', 'app-builder')
    const dependencySkillDir = join(workspace, '.oo', 'caches', 'skill-dependencies', 'skills.sh', 'frontend-design')

    await mkdir(appSkillDir, { recursive: true })
    await mkdir(dependencySkillDir, { recursive: true })
    await writeFile(join(appSkillDir, 'SKILL.md'), '# App Builder\n')
    await writeFile(join(dependencySkillDir, 'SKILL.md'), '# Frontend Design\n')
    await mkdir(join(realHome, '.codex'), { recursive: true })

    await initCodexAdapter({
      cwd: workspace,
      env: {
        HOME: mockHome,
        __ONEWORKS_PROJECT_REAL_HOME__: realHome,
        __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: '/bin/codex'
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      },
      assets: {
        hookPlugins: [],
        skills: [
          {
            id: 'skill:workspace:app-builder',
            kind: 'skill',
            name: 'app-builder',
            displayName: 'app-builder',
            origin: 'workspace',
            sourcePath: join(appSkillDir, 'SKILL.md'),
            payload: {
              definition: {
                path: join(appSkillDir, 'SKILL.md'),
                body: '# App Builder\n',
                attributes: {}
              }
            }
          },
          {
            id: 'skill:workspace:frontend-design',
            kind: 'skill',
            name: 'frontend-design',
            displayName: 'frontend-design',
            origin: 'workspace',
            sourcePath: join(dependencySkillDir, 'SKILL.md'),
            payload: {
              definition: {
                path: join(dependencySkillDir, 'SKILL.md'),
                body: '# Frontend Design\n',
                attributes: {}
              }
            }
          }
        ]
      }
    } as any)

    const agentsAppSkillPath = join(mockHome, '.agents', 'skills', 'app-builder')
    const agentsDependencySkillPath = join(mockHome, '.agents', 'skills', 'frontend-design')
    const codexDependencySkillPath = join(mockHome, '.codex', 'skills', 'frontend-design')

    expect(resolve(dirname(agentsAppSkillPath), await readlink(agentsAppSkillPath))).toBe(resolve(appSkillDir))
    expect(resolve(dirname(agentsDependencySkillPath), await readlink(agentsDependencySkillPath))).toBe(
      resolve(dependencySkillDir)
    )
    expect(resolve(dirname(codexDependencySkillPath), await readlink(codexDependencySkillPath))).toBe(
      resolve(dependencySkillDir)
    )
  })

  it('removes stale managed Codex skill links before syncing the current workspace skills', async () => {
    const workspace = await createWorkspace()
    const realHome = join(workspace, 'real-home')
    const mockHome = resolveTestMockHome(workspace, realHome)

    await mkdir(join(workspace, '.oo', 'skills', 'report'), { recursive: true })
    await writeFile(join(workspace, '.oo', 'skills', 'report', 'SKILL.md'), '# Report\n')
    await mkdir(join(realHome, '.codex'), { recursive: true })
    await mkdir(join(mockHome, '.codex', 'skills', '.system'), { recursive: true })
    await mkdir(join(mockHome, '.codex', 'skills', 'stale'), { recursive: true })
    await writeFile(
      join(mockHome, '.codex', 'skills', '.oneworks-managed-skills.json'),
      JSON.stringify({ skills: ['stale'] }, null, 2)
    )

    await initCodexAdapter({
      cwd: workspace,
      env: {
        HOME: mockHome,
        __ONEWORKS_PROJECT_REAL_HOME__: realHome,
        __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: '/bin/codex'
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      },
      assets: {
        hookPlugins: []
      }
    } as any)

    await expect(lstat(join(mockHome, '.codex', 'skills', 'stale'))).rejects.toThrow()
    expect((await lstat(join(mockHome, '.codex', 'skills', '.system'))).isDirectory()).toBe(true)
    expect((await lstat(join(mockHome, '.codex', 'skills', 'report'))).isSymbolicLink()).toBe(true)
  })

  it('writes a managed config.toml that trusts the workspace and disables update checks by default', async () => {
    const workspace = await createWorkspace()
    const realHome = join(workspace, 'real-home')
    const mockHome = resolveTestMockHome(workspace, realHome)

    await mkdir(join(realHome, '.codex'), { recursive: true })

    await initCodexAdapter({
      cwd: workspace,
      env: {
        HOME: mockHome,
        __ONEWORKS_PROJECT_REAL_HOME__: realHome,
        __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: '/bin/codex'
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      },
      assets: {
        hookPlugins: []
      }
    } as any)

    const configContent = await readFile(join(mockHome, '.codex', 'config.toml'), 'utf8')
    expect(configContent).toContain('check_for_update_on_startup = false')
    expect(configContent).toContain('# BEGIN ONE WORKS MANAGED CODEX ROOT CONFIG')
    expect(configContent).toContain(`[projects.${JSON.stringify(resolve(workspace))}]`)
    expect(configContent).toContain('trust_level = "trusted"')
    expect(configContent).toContain('# BEGIN ONE WORKS MANAGED CODEX PROJECT CONFIG')
  })

  it('still writes the managed config into the workspace mock home when HOME points at the workspace root', async () => {
    const workspace = await createWorkspace()
    const realHome = join(workspace, 'real-home')
    const mockHome = resolveTestMockHome(workspace, realHome)

    await initCodexAdapter({
      cwd: workspace,
      env: {
        HOME: workspace,
        __ONEWORKS_PROJECT_REAL_HOME__: realHome,
        __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: '/bin/codex'
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      },
      assets: {
        hookPlugins: []
      }
    } as any)

    const configContent = await readFile(join(mockHome, '.codex', 'config.toml'), 'utf8')
    expect(configContent).toContain('check_for_update_on_startup = false')
    await expect(readFile(join(workspace, '.codex', 'config.toml'), 'utf8')).rejects.toThrow()
  })

  it('preserves unmanaged config content and replaces the managed block with user overrides', async () => {
    const workspace = await createWorkspace()
    const realHome = join(workspace, 'real-home')
    const mockHome = resolveTestMockHome(workspace, realHome)
    const configPath = join(mockHome, '.codex', 'config.toml')

    await mkdir(join(realHome, '.codex'), { recursive: true })
    await mkdir(dirname(configPath), { recursive: true })
    await writeFile(
      configPath,
      [
        'model = "gpt-5.4"',
        '',
        '# BEGIN ONE WORKS MANAGED CODEX CONFIG',
        'check_for_update_on_startup = false',
        '[projects."/tmp/old-workspace"]',
        'trust_level = "trusted"',
        '# END ONE WORKS MANAGED CODEX CONFIG',
        ''
      ].join('\n')
    )

    const ctx = {
      cwd: workspace,
      env: {
        HOME: mockHome,
        __ONEWORKS_PROJECT_REAL_HOME__: realHome,
        __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: '/bin/codex'
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      },
      configs: [{
        adapters: {
          codex: {
            configOverrides: {
              check_for_update_on_startup: true
            }
          }
        }
      }, undefined],
      assets: {
        hookPlugins: []
      }
    } as any

    await initCodexAdapter(ctx)
    await initCodexAdapter(ctx)

    const configContent = await readFile(configPath, 'utf8')
    expect(configContent).toContain('model = "gpt-5.4"')
    expect(configContent).toContain('check_for_update_on_startup = true')
    expect(configContent.match(/BEGIN ONE WORKS MANAGED CODEX ROOT CONFIG/g)).toHaveLength(1)
    expect(configContent.match(/BEGIN ONE WORKS MANAGED CODEX PROJECT CONFIG/g)).toHaveLength(1)
    expect(configContent).toContain(`[projects.${JSON.stringify(resolve(workspace))}]`)
    expect(configContent).not.toContain('/tmp/old-workspace')
  })

  it('removes a stale unmanaged update-check key before writing the managed root block', async () => {
    const workspace = await createWorkspace()
    const realHome = join(workspace, 'real-home')
    const mockHome = resolveTestMockHome(workspace, realHome)
    const configPath = join(mockHome, '.codex', 'config.toml')

    await mkdir(join(realHome, '.codex'), { recursive: true })
    await mkdir(dirname(configPath), { recursive: true })
    await writeFile(
      configPath,
      [
        'model = "gpt-5.4"',
        'check_for_update_on_startup = true',
        '',
        '[notice]',
        'hide_full_access_warning = true',
        ''
      ].join('\n')
    )

    await initCodexAdapter({
      cwd: workspace,
      env: {
        HOME: mockHome,
        __ONEWORKS_PROJECT_REAL_HOME__: realHome,
        __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: '/bin/codex'
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      },
      assets: {
        hookPlugins: []
      }
    } as any)

    const configContent = await readFile(configPath, 'utf8')
    expect(configContent).toContain('model = "gpt-5.4"')
    expect(configContent).toContain('[notice]')
    expect(configContent).toContain('hide_full_access_warning = true')
    expect(configContent).toContain('check_for_update_on_startup = false')
    expect(configContent.match(/^check_for_update_on_startup\s*=/gm)).toHaveLength(1)
  })

  it('does not remove managed-root-key-shaped text inside a root multiline string', async () => {
    const workspace = await createWorkspace()
    const realHome = join(workspace, 'real-home')
    const mockHome = resolveTestMockHome(workspace, realHome)
    const configPath = join(mockHome, '.codex', 'config.toml')
    const rootPromptBlock = [
      'developer_instructions = """',
      'check_for_update_on_startup = true',
      'keep this as prompt text',
      '"""'
    ].join('\n')

    await mkdir(join(realHome, '.codex'), { recursive: true })
    await mkdir(dirname(configPath), { recursive: true })
    await writeFile(
      configPath,
      [
        rootPromptBlock,
        '',
        '[notice]',
        'hide_full_access_warning = true',
        ''
      ].join('\n')
    )

    await initCodexAdapter({
      cwd: workspace,
      env: {
        HOME: mockHome,
        __ONEWORKS_PROJECT_REAL_HOME__: realHome,
        __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: '/bin/codex'
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      },
      assets: {
        hookPlugins: []
      }
    } as any)

    const configContent = await readFile(configPath, 'utf8')
    expect(configContent).toContain(rootPromptBlock)
    expect(configContent).toContain('check_for_update_on_startup = false')
  })

  it('does not remove managed root keys from TOML tables', async () => {
    const workspace = await createWorkspace()
    const realHome = join(workspace, 'real-home')
    const mockHome = resolveTestMockHome(workspace, realHome)
    const configPath = join(mockHome, '.codex', 'config.toml')
    const noticeBlock = [
      '[notice]',
      'check_for_update_on_startup = true',
      'hide_full_access_warning = true'
    ].join('\n')

    await mkdir(join(realHome, '.codex'), { recursive: true })
    await mkdir(dirname(configPath), { recursive: true })
    await writeFile(
      configPath,
      [
        'model = "gpt-5.4"',
        '',
        noticeBlock,
        ''
      ].join('\n')
    )

    await initCodexAdapter({
      cwd: workspace,
      env: {
        HOME: mockHome,
        __ONEWORKS_PROJECT_REAL_HOME__: realHome,
        __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: '/bin/codex'
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      },
      assets: {
        hookPlugins: []
      }
    } as any)

    const configContent = await readFile(configPath, 'utf8')
    expect(configContent).toContain('check_for_update_on_startup = false')
    expect(configContent).toContain(noticeBlock)
  })

  it('removes stale unmanaged workspace trust blocks before writing the managed block', async () => {
    const workspace = await createWorkspace()
    const realHome = join(workspace, 'real-home')
    const mockHome = resolveTestMockHome(workspace, realHome)
    const configPath = join(mockHome, '.codex', 'config.toml')
    const projectKey = `[projects.${JSON.stringify(resolve(workspace))}]`

    await mkdir(join(realHome, '.codex'), { recursive: true })
    await mkdir(dirname(configPath), { recursive: true })
    await writeFile(
      configPath,
      [
        'model = "gpt-5.4"',
        'model_reasoning_effort = "medium"',
        'approvals_reviewer = "user"',
        projectKey,
        'trust_level = "trusted"',
        '',
        '[notice]',
        'hide_full_access_warning = true',
        ''
      ].join('\n')
    )

    await initCodexAdapter({
      cwd: workspace,
      env: {
        HOME: mockHome,
        __ONEWORKS_PROJECT_REAL_HOME__: realHome,
        __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: '/bin/codex'
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      },
      assets: {
        hookPlugins: []
      }
    } as any)

    const configContent = await readFile(configPath, 'utf8')
    expect(configContent).toContain('[notice]')
    expect(configContent).toContain('hide_full_access_warning = true')
    expect(configContent).toContain('check_for_update_on_startup = false')
    expect(configContent.split(projectKey)).toHaveLength(2)
  })

  it('dedupes an existing workspace project table even when the config uses CRLF line endings', async () => {
    const workspace = await createWorkspace()
    const realHome = join(workspace, 'real-home')
    const mockHome = resolveTestMockHome(workspace, realHome)
    const configPath = join(mockHome, '.codex', 'config.toml')
    const projectKey = `[projects.${JSON.stringify(resolve(workspace))}]`

    await mkdir(join(realHome, '.codex'), { recursive: true })
    await mkdir(dirname(configPath), { recursive: true })
    await writeFile(
      configPath,
      [
        'model = "gpt-5.4"',
        'model_reasoning_effort = "xhigh"',
        projectKey,
        'trust_level = "trusted"',
        ''
      ].join('\r\n')
    )

    await initCodexAdapter({
      cwd: workspace,
      env: {
        HOME: mockHome,
        __ONEWORKS_PROJECT_REAL_HOME__: realHome,
        __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: '/bin/codex'
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      },
      assets: {
        hookPlugins: []
      }
    } as any)

    const configContent = await readFile(configPath, 'utf8')
    expect(configContent).toContain('# BEGIN ONE WORKS MANAGED CODEX PROJECT CONFIG')
    expect(configContent.split(projectKey)).toHaveLength(2)
  })

  it('preserves existing workspace project settings and subtables without writing a duplicate project table', async () => {
    const workspace = await createWorkspace()
    const realHome = join(workspace, 'real-home')
    const mockHome = resolveTestMockHome(workspace, realHome)
    const configPath = join(mockHome, '.codex', 'config.toml')
    const projectKey = `[projects.${JSON.stringify(resolve(workspace))}]`
    const nestedProjectKey = `[projects.${JSON.stringify(resolve(workspace))}.mcp_servers.local]`

    await mkdir(join(realHome, '.codex'), { recursive: true })
    await mkdir(dirname(configPath), { recursive: true })
    await writeFile(
      configPath,
      [
        'model = "gpt-5.4"',
        projectKey,
        'trust_level = "manual"',
        'workspace_write = true',
        '',
        nestedProjectKey,
        'command = "node"',
        ''
      ].join('\n')
    )

    await initCodexAdapter({
      cwd: workspace,
      env: {
        HOME: mockHome,
        __ONEWORKS_PROJECT_REAL_HOME__: realHome,
        __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: '/bin/codex'
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      },
      assets: {
        hookPlugins: []
      }
    } as any)

    const configContent = await readFile(configPath, 'utf8')
    expect(configContent.split(projectKey)).toHaveLength(2)
    expect(configContent).toContain('trust_level = "trusted"')
    expect(configContent).toContain('workspace_write = true')
    expect(configContent).toContain(nestedProjectKey)
    expect(configContent).toContain('command = "node"')
  })

  it('does not treat table-like lines inside a workspace multiline string as TOML sections', async () => {
    const workspace = await createWorkspace()
    const realHome = join(workspace, 'real-home')
    const mockHome = resolveTestMockHome(workspace, realHome)
    const configPath = join(mockHome, '.codex', 'config.toml')
    const projectKey = `[projects.${JSON.stringify(resolve(workspace))}]`
    const projectPromptBlock = [
      'project_prompt = """',
      '[not.a.table]',
      'keep me inside the string',
      '"""'
    ].join('\n')

    await mkdir(join(realHome, '.codex'), { recursive: true })
    await mkdir(dirname(configPath), { recursive: true })
    await writeFile(
      configPath,
      [
        'model = "gpt-5.4"',
        projectKey,
        'trust_level = "manual"',
        projectPromptBlock,
        ''
      ].join('\n')
    )

    const ctx = {
      cwd: workspace,
      env: {
        HOME: mockHome,
        __ONEWORKS_PROJECT_REAL_HOME__: realHome,
        __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: '/bin/codex'
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      },
      assets: {
        hookPlugins: []
      }
    } as any

    await initCodexAdapter(ctx)
    await initCodexAdapter(ctx)

    const configContent = await readFile(configPath, 'utf8')
    expect(configContent).toContain(projectPromptBlock)
    expect(configContent).toContain('trust_level = "trusted"')
    expect(configContent.split(projectKey)).toHaveLength(2)
  })

  it('does not strip managed marker-shaped lines when they appear inside a workspace multiline string', async () => {
    const workspace = await createWorkspace()
    const realHome = join(workspace, 'real-home')
    const mockHome = resolveTestMockHome(workspace, realHome)
    const configPath = join(mockHome, '.codex', 'config.toml')
    const projectKey = `[projects.${JSON.stringify(resolve(workspace))}]`
    const projectPromptBlock = [
      'project_prompt = """',
      '# BEGIN ONE WORKS MANAGED CODEX PROJECT CONFIG',
      '# This project block is managed by One Works.',
      '# END ONE WORKS MANAGED CODEX PROJECT CONFIG',
      '"""'
    ].join('\n')

    await mkdir(join(realHome, '.codex'), { recursive: true })
    await mkdir(dirname(configPath), { recursive: true })
    await writeFile(
      configPath,
      [
        projectKey,
        'trust_level = "manual"',
        projectPromptBlock,
        ''
      ].join('\n')
    )

    const ctx = {
      cwd: workspace,
      env: {
        HOME: mockHome,
        __ONEWORKS_PROJECT_REAL_HOME__: realHome,
        __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: '/bin/codex'
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      },
      assets: {
        hookPlugins: []
      }
    } as any

    await initCodexAdapter(ctx)
    await initCodexAdapter(ctx)

    const configContent = await readFile(configPath, 'utf8')
    expect(configContent).toContain(projectPromptBlock)
    expect(configContent).toContain('trust_level = "trusted"')
  })

  it('does not insert the managed root block into a root multiline string that contains a table-like line', async () => {
    const workspace = await createWorkspace()
    const realHome = join(workspace, 'real-home')
    const mockHome = resolveTestMockHome(workspace, realHome)
    const configPath = join(mockHome, '.codex', 'config.toml')
    const rootPromptBlock = [
      'developer_instructions = """',
      '[not.a.real.table]',
      'keep this preamble intact',
      '"""'
    ].join('\n')

    await mkdir(join(realHome, '.codex'), { recursive: true })
    await mkdir(dirname(configPath), { recursive: true })
    await writeFile(
      configPath,
      [
        rootPromptBlock,
        '',
        '[notice]',
        'hide_full_access_warning = true',
        ''
      ].join('\n')
    )

    const ctx = {
      cwd: workspace,
      env: {
        HOME: mockHome,
        __ONEWORKS_PROJECT_REAL_HOME__: realHome,
        __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: '/bin/codex'
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      },
      assets: {
        hookPlugins: []
      }
    } as any

    await initCodexAdapter(ctx)
    await initCodexAdapter(ctx)

    const configContent = await readFile(configPath, 'utf8')
    expect(configContent).toContain(rootPromptBlock)
    expect(configContent).toContain('# BEGIN ONE WORKS MANAGED CODEX ROOT CONFIG')
    expect(configContent).toContain('[notice]')
    expect(configContent).toContain('hide_full_access_warning = true')
  })

  it('preserves other workspaces managed project markers while rewriting the current workspace block', async () => {
    const workspace = await createWorkspace()
    const otherWorkspace = resolve(workspace, '..', 'other-workspace')
    const realHome = join(workspace, 'real-home')
    const mockHome = resolveTestMockHome(workspace, realHome)
    const configPath = join(mockHome, '.codex', 'config.toml')
    const currentProjectKey = `[projects.${JSON.stringify(resolve(workspace))}]`
    const otherProjectKey = `[projects.${JSON.stringify(otherWorkspace)}]`

    await mkdir(join(realHome, '.codex'), { recursive: true })
    await mkdir(dirname(configPath), { recursive: true })
    await writeFile(
      configPath,
      [
        'model = "gpt-5.4"',
        '',
        '# BEGIN ONE WORKS MANAGED CODEX PROJECT CONFIG',
        '# This project block is managed by One Works.',
        otherProjectKey,
        'trust_level = "trusted"',
        '# END ONE WORKS MANAGED CODEX PROJECT CONFIG',
        '',
        currentProjectKey,
        'trust_level = "manual"',
        ''
      ].join('\n')
    )

    await initCodexAdapter({
      cwd: workspace,
      env: {
        HOME: mockHome,
        __ONEWORKS_PROJECT_REAL_HOME__: realHome,
        __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: '/bin/codex'
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      },
      assets: {
        hookPlugins: []
      }
    } as any)

    const configContent = await readFile(configPath, 'utf8')
    expect(configContent).toContain(otherProjectKey)
    expect(configContent.match(/BEGIN ONE WORKS MANAGED CODEX PROJECT CONFIG/g)).toHaveLength(2)
    expect(configContent.split(currentProjectKey)).toHaveLength(2)
  })

  it('recognizes root table headers that carry inline comments', async () => {
    const workspace = await createWorkspace()
    const realHome = join(workspace, 'real-home')
    const mockHome = resolveTestMockHome(workspace, realHome)
    const configPath = join(mockHome, '.codex', 'config.toml')

    await mkdir(join(realHome, '.codex'), { recursive: true })
    await mkdir(dirname(configPath), { recursive: true })
    await writeFile(
      configPath,
      [
        'developer_instructions = "hi"',
        '',
        '[notice] # keep this comment',
        'hide_full_access_warning = true',
        ''
      ].join('\n')
    )

    await initCodexAdapter({
      cwd: workspace,
      env: {
        HOME: mockHome,
        __ONEWORKS_PROJECT_REAL_HOME__: realHome,
        __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: '/bin/codex'
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      },
      assets: {
        hookPlugins: []
      }
    } as any)

    const configContent = await readFile(configPath, 'utf8')
    expect(configContent).toContain('# BEGIN ONE WORKS MANAGED CODEX ROOT CONFIG')
    expect(configContent).toContain('[notice] # keep this comment')
  })

  it('recognizes workspace project headers that carry inline comments', async () => {
    const workspace = await createWorkspace()
    const realHome = join(workspace, 'real-home')
    const mockHome = resolveTestMockHome(workspace, realHome)
    const configPath = join(mockHome, '.codex', 'config.toml')
    const projectKey = `[projects.${JSON.stringify(resolve(workspace))}]`

    await mkdir(join(realHome, '.codex'), { recursive: true })
    await mkdir(dirname(configPath), { recursive: true })
    await writeFile(
      configPath,
      [
        `${projectKey} # keep this comment`,
        'trust_level = "manual"',
        'workspace_write = true',
        ''
      ].join('\n')
    )

    await initCodexAdapter({
      cwd: workspace,
      env: {
        HOME: mockHome,
        __ONEWORKS_PROJECT_REAL_HOME__: realHome,
        __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: '/bin/codex'
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      },
      assets: {
        hookPlugins: []
      }
    } as any)

    const configContent = await readFile(configPath, 'utf8')
    expect(configContent.split(projectKey)).toHaveLength(2)
    expect(configContent).toContain('workspace_write = true')
  })

  it('keeps concurrent skill sync idempotent when multiple ow processes initialize the same mock home', async () => {
    const workspace = await createWorkspace()
    const realHome = join(workspace, 'real-home')
    const mockHome = resolveTestMockHome(workspace, realHome)
    const barrier = createBarrier(2)

    await mkdir(join(workspace, '.oo', 'skills', 'research'), { recursive: true })
    await writeFile(join(workspace, '.oo', 'skills', 'research', 'SKILL.md'), '# Research\n')
    await mkdir(join(realHome, '.codex'), { recursive: true })

    vi.resetModules()
    vi.doMock('node:fs/promises', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs/promises')>()
      return {
        ...actual,
        symlink: vi.fn(async (...args: Parameters<typeof actual.symlink>) => {
          const [, targetPath] = args
          if (String(targetPath).endsWith(join('.agents', 'skills'))) {
            await barrier()
          }
          return actual.symlink(...args)
        })
      }
    })

    try {
      const { initCodexAdapter: initCodexAdapterWithMockedFs } = await import('../src/runtime/init')
      const ctx = {
        cwd: workspace,
        env: {
          HOME: mockHome,
          __ONEWORKS_PROJECT_REAL_HOME__: realHome,
          __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__: '/bin/codex'
        },
        logger: {
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn()
        },
        assets: {
          hookPlugins: []
        }
      } as any

      await expect(
        Promise.all([initCodexAdapterWithMockedFs(ctx), initCodexAdapterWithMockedFs(ctx)])
      ).resolves.toHaveLength(2)
      const targetPath = join(mockHome, '.agents', 'skills')
      expect((await lstat(targetPath)).isSymbolicLink()).toBe(true)
      expect(resolve(dirname(targetPath), await readlink(targetPath))).toBe(resolve(workspace, '.oo', 'skills'))
    } finally {
      vi.doUnmock('node:fs/promises')
      vi.resetModules()
    }
  })

  it('deep merges nested codex configOverrides across layered config files', async () => {
    const configOverrides = resolveCodexConfigOverrides({
      configs: [{
        adapters: {
          codex: {
            configOverrides: {
              model: 'gpt-5.4',
              approval_policy: 'unlessTrusted'
            }
          }
        }
      }, {
        adapters: {
          codex: {
            configOverrides: {
              check_for_update_on_startup: true
            }
          }
        }
      }]
    } as any)

    expect(configOverrides).toMatchObject({
      model: 'gpt-5.4',
      approval_policy: 'unlessTrusted',
      check_for_update_on_startup: true
    })
  })
})
