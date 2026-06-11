/* eslint-disable import/first -- hoisted vitest mocks must be declared before importing the bundle entrypoint */
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findSkillsCli: vi.fn(),
  installSkillsCliRefToTemp: vi.fn(),
  installSkillsCliSkillToTemp: vi.fn()
}))

vi.mock('@oneworks/utils/skills-cli', async () => {
  const actual = await vi.importActual<typeof import('@oneworks/utils/skills-cli')>('@oneworks/utils/skills-cli')
  return {
    ...actual,
    findSkillsCli: mocks.findSkillsCli,
    installSkillsCliRefToTemp: mocks.installSkillsCliRefToTemp,
    installSkillsCliSkillToTemp: mocks.installSkillsCliSkillToTemp
  }
})

import { buildAdapterAssetPlan, resolveWorkspaceAssetBundle } from '#~/index.js'

import { createWorkspace, installPluginPackage, writeDocument } from './test-helpers'

describe('materialized skill dependency resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fails missing dependencies without downloading during runtime preparation', async () => {
    const workspace = await createWorkspace()
    await writeDocument(
      join(workspace, '.oo/skills/app-builder/SKILL.md'),
      [
        '---',
        'name: app-builder',
        'description: Build apps',
        'dependencies:',
        '  - frontend-design',
        '---',
        'Build the app.'
      ].join('\n')
    )

    const bundle = await resolveWorkspaceAssetBundle({
      cwd: workspace,
      configs: [undefined, undefined],
      useDefaultOneworksMcpServer: false
    })

    await expect(buildAdapterAssetPlan({
      adapter: 'opencode',
      bundle,
      options: {
        skills: {
          include: ['app-builder']
        }
      }
    })).rejects.toThrow('Run oneworks skills install or oneworks skills update')

    expect(mocks.findSkillsCli).not.toHaveBeenCalled()
    expect(mocks.installSkillsCliRefToTemp).not.toHaveBeenCalled()
    expect(mocks.installSkillsCliSkillToTemp).not.toHaveBeenCalled()
  })

  it('prompts install command when an explicitly selected configured skill is missing', async () => {
    const workspace = await createWorkspace()
    const bundle = await resolveWorkspaceAssetBundle({
      cwd: workspace,
      configs: [{
        skills: [
          {
            name: 'design-review',
            source: 'example-source/default/public',
            rename: 'internal-review'
          }
        ]
      }, undefined],
      useDefaultOneworksMcpServer: false
    })

    await expect(buildAdapterAssetPlan({
      adapter: 'opencode',
      bundle,
      options: {
        skills: {
          include: ['internal-review']
        }
      }
    })).rejects.toThrow('Run `oneworks skills install internal-review` or `oneworks skills install`')

    expect(mocks.findSkillsCli).not.toHaveBeenCalled()
    expect(mocks.installSkillsCliRefToTemp).not.toHaveBeenCalled()
    expect(mocks.installSkillsCliSkillToTemp).not.toHaveBeenCalled()
  })

  it('uses project-materialized dependencies from .oo/skills', async () => {
    const workspace = await createWorkspace()
    await writeDocument(
      join(workspace, '.oo/skills/app-builder/SKILL.md'),
      [
        '---',
        'name: app-builder',
        'description: Build apps',
        'dependencies:',
        '  - frontend-design',
        '---',
        'Build the app.'
      ].join('\n')
    )
    await writeDocument(
      join(workspace, '.oo/skills/frontend-design/SKILL.md'),
      '---\nname: frontend-design\ndescription: UI design guidance\n---\nUse strong visual hierarchy.\n'
    )

    const bundle = await resolveWorkspaceAssetBundle({
      cwd: workspace,
      configs: [undefined, undefined],
      useDefaultOneworksMcpServer: false
    })
    const plan = await buildAdapterAssetPlan({
      adapter: 'opencode',
      bundle,
      options: {
        skills: {
          include: ['app-builder']
        }
      }
    })

    expect(plan.overlays.filter(entry => entry.kind === 'skill').map(entry => entry.targetPath).sort()).toEqual([
      'skills/app-builder',
      'skills/frontend-design'
    ])
    expect(mocks.findSkillsCli).not.toHaveBeenCalled()
  })

  it('loads plugin dependencies from .oo/skills/.plugins through the lockfile', async () => {
    const workspace = await createWorkspace()
    await installPluginPackage(workspace, '@oneworks/plugin-review', {
      'package.json': JSON.stringify({ name: '@oneworks/plugin-review', version: '1.0.0' }, null, 2),
      'skills/review-helper/SKILL.md': [
        '---',
        'name: review-helper',
        'description: Review helper',
        'dependencies:',
        '  - shared-runtime',
        '---',
        'Review code.'
      ].join('\n')
    })
    await writeDocument(
      join(workspace, '.oo/skills/.plugins/review/shared-runtime/SKILL.md'),
      '---\nname: shared-runtime\ndescription: Shared runtime\n---\nShared plugin dependency.\n'
    )
    await writeDocument(
      join(workspace, '.oo/skills.lock.yaml'),
      [
        'version: 1',
        'pluginSkills:',
        '  review/shared-runtime:',
        '    name: shared-runtime',
        '    requested: false',
        '    pluginInstance: review',
        '    pluginInstancePath: "0"',
        '    installPath: .oo/skills/.plugins/review/shared-runtime',
        '    dependencyOf:',
        '      - plugin:review/review-helper',
        '    source: vendor/shared-skills',
        '    version: 1.0.0',
        '    hash: sha256:test',
        '    installedAt: "2026-05-13T00:00:00.000Z"'
      ].join('\n')
    )

    const bundle = await resolveWorkspaceAssetBundle({
      cwd: workspace,
      configs: [{
        plugins: [{
          id: '@oneworks/plugin-review',
          scope: 'review'
        }]
      }, undefined],
      useDefaultOneworksMcpServer: false
    })
    const plan = await buildAdapterAssetPlan({
      adapter: 'opencode',
      bundle,
      options: {
        skills: {
          include: ['review/review-helper']
        }
      }
    })

    expect(bundle.skills.map(asset => asset.displayName).sort()).toEqual([
      'review/review-helper',
      'review/shared-runtime'
    ])
    expect(plan.overlays.filter(entry => entry.kind === 'skill').map(entry => entry.targetPath).sort()).toEqual([
      'skills/review__review-helper',
      'skills/review__shared-runtime'
    ])
    expect(mocks.installSkillsCliSkillToTemp).not.toHaveBeenCalled()
  })
})
