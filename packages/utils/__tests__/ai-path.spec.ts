import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_PROJECT_OO_BASE_DIR,
  DEFAULT_PROJECT_OO_ENTITIES_DIR,
  PROJECT_PRIMARY_WORKSPACE_FOLDER_ENV,
  resolveGlobalOneWorksAssetsPath,
  resolveGlobalOneWorksDir,
  resolveGlobalOoConfigPath,
  resolvePrimaryWorkspaceFolder,
  resolveProjectConfigDir,
  resolveProjectHomeDir,
  resolveProjectHomePath,
  resolveProjectMockHome,
  resolveProjectOoBaseDirName,
  resolveProjectOoEntitiesDir,
  resolveProjectOoEntitiesDirName,
  resolveProjectOoPath,
  resolveProjectWorkspaceFolder
} from '#~/ai-path.js'

describe('ai path utils', () => {
  it('uses the default base dir and entities dir names', () => {
    expect(resolveProjectOoBaseDirName({})).toBe(DEFAULT_PROJECT_OO_BASE_DIR)
    expect(resolveProjectOoEntitiesDirName({})).toBe(DEFAULT_PROJECT_OO_ENTITIES_DIR)
  })

  it('resolves the entities dir under the env-configured ai base dir', () => {
    expect(resolveProjectOoEntitiesDir('/tmp/project', {
      __ONEWORKS_PROJECT_BASE_DIR__: '.oneworks',
      __ONEWORKS_PROJECT_ENTITIES_DIR__: 'agents'
    })).toBe('/tmp/project/.oneworks/agents')
  })

  it('supports nested entities dir paths', () => {
    expect(resolveProjectOoEntitiesDir('/tmp/project', {
      __ONEWORKS_PROJECT_ENTITIES_DIR__: 'knowledge/entities'
    })).toBe('/tmp/project/.oo/knowledge/entities')
  })

  it('resolves relative AI and config paths from the launch cwd', () => {
    expect(resolveProjectOoEntitiesDir('/tmp/project/c/d/e', {
      __ONEWORKS_PROJECT_LAUNCH_CWD__: '/tmp/project/c/d/e',
      __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: '../../..',
      __ONEWORKS_PROJECT_BASE_DIR__: '.iac/ai',
      __ONEWORKS_PROJECT_ENTITIES_DIR__: 'agents'
    })).toBe('/tmp/project/c/d/e/.iac/ai/agents')

    expect(resolveProjectConfigDir('/tmp/project/c/d/e', {
      __ONEWORKS_PROJECT_LAUNCH_CWD__: '/tmp/project/c/d/e',
      __ONEWORKS_PROJECT_CONFIG_DIR__: '.'
    })).toBe('/tmp/project/c/d/e')
  })

  it('resolves the configured AI base dir from the env file source cwd when present', () => {
    const env = {
      __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: '../..',
      __ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__: '/tmp/project/business_modules/Miniapp',
      __ONEWORKS_PROJECT_CONFIG_DIR__: '.',
      __ONEWORKS_PROJECT_CONFIG_DIR_RESOLVE_CWD__: '/tmp/project/business_modules/Miniapp',
      __ONEWORKS_PROJECT_BASE_DIR__: '.iac/ai',
      __ONEWORKS_PROJECT_BASE_DIR_RESOLVE_CWD__: '/tmp/project/business_modules/Miniapp',
      __ONEWORKS_PROJECT_REAL_HOME__: '/tmp/home',
      HOME: '/tmp/project'
    }

    expect(resolveProjectWorkspaceFolder('/tmp/project', env)).toBe('/tmp/project')
    expect(resolveProjectConfigDir('/tmp/project', env)).toBe('/tmp/project/business_modules/Miniapp')
    expect(resolveProjectMockHome('/tmp/project', env)).toBe(`${resolveProjectHomeDir('/tmp/project', env)}/.mock`)
  })

  it('resolves runtime data under the home project dir while keeping project assets under .oo', () => {
    const env = {
      HOME: '/tmp/home',
      __ONEWORKS_PROJECT_REAL_HOME__: '/tmp/home'
    }

    expect(resolveProjectHomeDir('/tmp/project', env)).toMatch(
      /^\/tmp\/home\/\.oneworks\/projects\/project-[a-f0-9]{10}$/
    )
    expect(resolveProjectHomePath('/tmp/project', env, 'logs')).toBe(
      `${resolveProjectHomeDir('/tmp/project', env)}/logs`
    )
    expect(resolveProjectHomePath('/tmp/project', env, 'caches')).toBe(
      `${resolveProjectHomeDir('/tmp/project', env)}/caches`
    )
    expect(resolveProjectHomePath('/tmp/project', env, '.mock')).toBe(
      `${resolveProjectHomeDir('/tmp/project', env)}/.mock`
    )
    expect(resolveProjectOoPath('/tmp/project', env, '.local')).toBe(
      `${resolveProjectHomeDir('/tmp/project', env)}/.local`
    )
    expect(resolveProjectOoPath('/tmp/project', env, 'skills')).toBe('/tmp/project/.oo/skills')
  })

  it('resolves global One Works config and assets under the real home .oneworks dir', () => {
    const env = {
      HOME: '/tmp/mock-home',
      __ONEWORKS_PROJECT_REAL_HOME__: '/tmp/real-home'
    }

    expect(resolveGlobalOneWorksDir(env)).toBe('/tmp/real-home/.oneworks')
    expect(resolveGlobalOoConfigPath(env)).toBe('/tmp/real-home/.oneworks/.oo.config.json')
    expect(resolveGlobalOneWorksAssetsPath(env, 'plugins')).toBe('/tmp/real-home/.oneworks/global/plugins')
  })

  it('uses the canonical workspace path for the home project key', () => {
    const root = mkdtempSync(join(tmpdir(), 'ow-ai-path-'))
    try {
      const workspace = join(root, 'workspace')
      const workspaceAlias = join(root, 'workspace-alias')
      mkdirSync(workspace)
      symlinkSync(workspace, workspaceAlias, 'dir')

      const env = {
        HOME: join(root, 'home'),
        __ONEWORKS_PROJECT_REAL_HOME__: join(root, 'home')
      }

      expect(resolveProjectHomeDir(workspaceAlias, env)).toBe(resolveProjectHomeDir(workspace, env))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('resolves the primary workspace from the explicit worktree override env', () => {
    expect(resolvePrimaryWorkspaceFolder('/tmp/worktrees/feature/project', {
      [PROJECT_PRIMARY_WORKSPACE_FOLDER_ENV]: '/tmp/project'
    })).toBe('/tmp/project')

    expect(resolvePrimaryWorkspaceFolder('/tmp/project', {
      [PROJECT_PRIMARY_WORKSPACE_FOLDER_ENV]: '/tmp/project'
    })).toBeUndefined()
  })

  it('resolves relative primary workspace overrides from the launch cwd', () => {
    expect(resolvePrimaryWorkspaceFolder('/tmp/project/worktrees/feature', {
      __ONEWORKS_PROJECT_LAUNCH_CWD__: '/tmp/project/worktrees/feature',
      [PROJECT_PRIMARY_WORKSPACE_FOLDER_ENV]: '../main'
    })).toBe('/tmp/project/worktrees/main')

    expect(resolvePrimaryWorkspaceFolder('/tmp/project', {
      __ONEWORKS_PROJECT_LAUNCH_CWD__: '/tmp/project/worktrees/feature',
      __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: '../..',
      [PROJECT_PRIMARY_WORKSPACE_FOLDER_ENV]: '../..'
    })).toBeUndefined()
  })

  it('falls back to the managed mock home when HOME points inside the workspace', () => {
    const env = {
      HOME: '/tmp/project',
      __ONEWORKS_PROJECT_REAL_HOME__: '/tmp/home'
    }
    expect(resolveProjectMockHome('/tmp/project', env)).toBe(resolveProjectHomePath('/tmp/project', env, '.mock'))

    const nestedHomeEnv = {
      HOME: '/tmp/project/.codex',
      __ONEWORKS_PROJECT_REAL_HOME__: '/tmp/home'
    }
    expect(resolveProjectMockHome('/tmp/project', nestedHomeEnv)).toBe(
      resolveProjectHomePath('/tmp/project', nestedHomeEnv, '.mock')
    )

    const dotDotPrefixedHomeEnv = {
      HOME: '/tmp/project/..cache-home',
      __ONEWORKS_PROJECT_REAL_HOME__: '/tmp/home'
    }
    expect(resolveProjectMockHome('/tmp/project', dotDotPrefixedHomeEnv)).toBe(
      resolveProjectHomePath('/tmp/project', dotDotPrefixedHomeEnv, '.mock')
    )
  })

  it('treats HOME as the real home when no explicit real home env is available', () => {
    const env = {
      HOME: '/tmp/home'
    }

    expect(resolveProjectMockHome('/tmp/project', env)).toBe(resolveProjectHomePath('/tmp/project', env, '.mock'))
  })

  it('keeps an explicit external HOME when it does not target the real home or workspace', () => {
    expect(resolveProjectMockHome('/tmp/project', {
      HOME: '/tmp/custom-home',
      __ONEWORKS_PROJECT_REAL_HOME__: '/tmp/home'
    })).toBe('/tmp/custom-home')
  })
})
