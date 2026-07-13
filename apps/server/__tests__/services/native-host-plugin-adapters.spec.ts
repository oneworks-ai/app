import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import claudeManager from '@oneworks/adapter-claude-code/native-plugins'
import codexManager from '@oneworks/adapter-codex/native-plugins'
import copilotManager from '@oneworks/adapter-copilot/native-plugins'
import geminiManager from '@oneworks/adapter-gemini/native-plugins'
import kimiManager from '@oneworks/adapter-kimi/native-plugins'
import opencodeManager from '@oneworks/adapter-opencode/native-plugins'
import { resolveManagedNpmCliPaths } from '@oneworks/utils/managed-npm-cli'

const writeJson = async (filePath: string, value: unknown) => {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

const writeFakeCodex = async (home: string, env: Record<string, string>, script: string) => {
  const binDir = path.join(home, 'bin')
  const executable = path.join(binDir, 'codex')
  await mkdir(binDir, { recursive: true })
  await writeFile(executable, `#!${process.execPath}\n${script}\n`, 'utf8')
  await chmod(executable, 0o755)
  env.__ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__ = executable
  env.PATH = binDir
}

describe('native Home plugin adapter discovery', () => {
  let home: string
  let env: Record<string, string>

  beforeEach(async () => {
    home = await mkdtemp(path.join(tmpdir(), 'oneworks-native-plugins-'))
    const emptyBin = path.join(home, 'empty-bin')
    await mkdir(emptyBin)
    env = { __ONEWORKS_PROJECT_REAL_HOME__: home, PATH: emptyBin }
  })

  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
  })

  it('falls back to Codex config state and ignores unconfigured cache and staging directories', async () => {
    await mkdir(path.join(home, '.codex'), { recursive: true })
    await writeFile(
      path.join(home, '.codex', 'config.toml'),
      '[plugins."docs@openai-bundled"]\nenabled = false\n',
      'utf8'
    )
    await writeJson(
      path.join(home, '.codex/plugins/cache/openai-bundled/docs/2.0.0/.codex-plugin/plugin.json'),
      {
        name: 'docs',
        version: '2.0.0',
        description: 'Docs',
        interface: {
          composerIcon: 'icon.svg',
          displayName: 'Documents',
          shortDescription: 'Create and edit documents'
        }
      }
    )
    await writeFile(
      path.join(home, '.codex/plugins/cache/openai-bundled/docs/2.0.0/icon.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M2 2h12v12H2z"/></svg>',
      'utf8'
    )
    await writeJson(
      path.join(home, '.codex/plugins/cache/openai-bundled/docs/.codex-remote-plugin-install.json'),
      { remote_plugin_id: 'docs-remote-id' }
    )
    await writeJson(
      path.join(home, '.codex/plugins/cache/openai-bundled/docs/1.0.0/.codex-plugin/plugin.json'),
      { name: 'docs', version: '1.0.0' }
    )
    await writeJson(
      path.join(home, '.codex/plugins/cache/other/orphan/1.0.0/.codex-plugin/plugin.json'),
      { name: 'orphan' }
    )
    await writeJson(
      path.join(home, '.codex/plugins/.remote-plugin-install-staging/bad/.codex-plugin/plugin.json'),
      { name: 'bad' }
    )

    const result = await codexManager.discover({ cwd: '/workspace', env })
    expect(result.plugins).toHaveLength(1)
    expect(result.plugins[0]).toMatchObject({
      description: 'Create and edit documents',
      displayName: 'Documents',
      name: 'docs',
      scope: 'builtin',
      state: 'disabled',
      version: '2.0.0'
    })
    expect(result.plugins[0]?.icon).toMatch(/^data:image\/svg\+xml/u)
    expect(result.plugins[0]?.source.internalRoot).toBe(
      path.join(home, '.codex/plugins/cache/openai-bundled/docs/2.0.0')
    )
    expect(result.plugins[0]?.diagnostics?.[0]?.code).toBe('native_plugin_old_cache_ignored')
    expect(result.diagnostics[0]?.code).toBe('native_plugin_cli_failed')
  })

  it('lets the Codex adapter report global and project skills and deduplicates shared physical roots', async () => {
    const project = path.join(home, 'project')
    const homeSkillRoot = path.join(home, '.codex/skills/review')
    const projectSkillRoot = path.join(project, '.codex/skills/build')
    await mkdir(homeSkillRoot, { recursive: true })
    await mkdir(projectSkillRoot, { recursive: true })
    await mkdir(path.join(home, '.agents'), { recursive: true })
    await symlink(path.join(home, '.codex/skills'), path.join(home, '.agents/skills'))
    await writeFile(path.join(homeSkillRoot, 'SKILL.md'), '---\nname: review\ndescription: Review changes\n---\n')
    await writeFile(path.join(projectSkillRoot, 'SKILL.md'), '---\nname: build\n---\n')

    const result = await codexManager.discoverSkills?.({ cwd: project, env })

    expect(result?.skills).toHaveLength(2)
    expect(result?.skills).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'review', scope: 'global' }),
      expect.objectContaining({ name: 'build', scope: 'project' })
    ]))
    expect(result?.skills.find(skill => skill.name === 'review')?.source).toMatchObject({
      id: 'codex:home-agents',
      type: 'adapter-home'
    })
  })

  it('uses Codex CLI installed state and source path instead of an unrelated cache', async () => {
    const sourceRoot = path.join(home, 'actual-install/docs')
    await writeJson(
      path.join(home, '.codex/plugins/cache/team/docs/99.0.0/.codex-plugin/plugin.json'),
      { name: 'docs', version: '99.0.0' }
    )
    await writeFakeCodex(
      home,
      env,
      `process.stdout.write(${
        JSON.stringify(JSON.stringify({
          installed: [{
            pluginId: 'docs@team',
            name: 'docs',
            marketplaceName: 'team',
            version: '2.1.0',
            installed: true,
            enabled: false,
            source: { source: 'local', path: sourceRoot }
          }],
          available: []
        }))
      })`
    )

    const result = await codexManager.discover({ cwd: path.join(home, 'project'), env })
    expect(result.diagnostics).toEqual([])
    expect(result.plugins).toHaveLength(1)
    expect(result.plugins[0]).toMatchObject({ name: 'docs', state: 'disabled', version: '2.1.0' })
    expect(result.plugins[0]?.source.displayPath).toBe('~/actual-install/docs')
  })

  it('prefers the workspace managed Codex binary over PATH during native discovery', async () => {
    const project = path.join(home, 'managed-project')
    await mkdir(project, { recursive: true })
    const managed = resolveManagedNpmCliPaths({
      adapterKey: 'codex',
      binaryName: 'codex',
      cwd: project,
      env,
      packageName: '@openai/codex',
      version: 'latest'
    })
    await mkdir(path.dirname(managed.binaryPath), { recursive: true })
    await writeFile(
      managed.binaryPath,
      `#!${process.execPath}\nprocess.stdout.write(${
        JSON.stringify(JSON.stringify({
          installed: [{
            pluginId: 'managed@team',
            name: 'managed',
            marketplaceName: 'team',
            version: '4.0.0',
            installed: true,
            enabled: true,
            source: { source: 'local', path: path.join(home, 'managed-plugin') }
          }],
          available: []
        }))
      })\n`,
      'utf8'
    )
    await chmod(managed.binaryPath, 0o755)
    const pathBin = path.join(home, 'path-bin')
    await mkdir(pathBin, { recursive: true })
    await writeFile(
      path.join(pathBin, 'codex'),
      `#!${process.execPath}\nprocess.stdout.write('${JSON.stringify({ installed: [], available: [] })}')\n`,
      'utf8'
    )
    await chmod(path.join(pathBin, 'codex'), 0o755)
    env.PATH = pathBin

    const result = await codexManager.discover({ cwd: project, env })

    expect(result.diagnostics).toEqual([])
    expect(result.plugins).toEqual([
      expect.objectContaining({ name: 'managed', state: 'enabled', version: '4.0.0' })
    ])
  })

  it('merges a Codex CLI entry with the same project physical path while retaining CLI truth', async () => {
    const project = path.join(home, 'project')
    const sourceRoot = path.join(project, '.codex/plugins/docs')
    await writeJson(path.join(sourceRoot, '.codex-plugin/plugin.json'), { name: 'docs', version: '1.0.0' })
    await writeFakeCodex(
      home,
      env,
      `process.stdout.write(${
        JSON.stringify(JSON.stringify({
          installed: [{
            pluginId: 'docs@team',
            name: 'docs',
            marketplaceName: 'team',
            version: '3.0.0',
            installed: true,
            enabled: false,
            source: { source: 'local', path: sourceRoot }
          }],
          available: []
        }))
      })`
    )

    const result = await codexManager.discover({ cwd: project, env })
    expect(result.plugins).toHaveLength(1)
    expect(result.plugins[0]).toMatchObject({ name: 'docs', scope: 'project', state: 'disabled', version: '3.0.0' })
  })

  it.each([
    ['malformed', `process.stdout.write('{')`],
    ['oversize', `process.stdout.write('x'.repeat(${1024 * 1024 + 1}))`]
  ])('falls back safely when Codex CLI output is %s', async (_caseName, script) => {
    await mkdir(path.join(home, '.codex'), { recursive: true })
    await writeFile(path.join(home, '.codex/config.toml'), '[plugins."fallback@team"]\nenabled = true\n')
    await writeJson(
      path.join(home, '.codex/plugins/cache/team/fallback/1.0.0/.codex-plugin/plugin.json'),
      { name: 'fallback', version: '1.0.0' }
    )
    await writeFakeCodex(home, env, script)

    const result = await codexManager.discover({ cwd: path.join(home, 'project'), env })
    expect(result.plugins[0]).toMatchObject({ name: 'fallback', state: 'enabled' })
    expect(result.diagnostics[0]?.code).toBe('native_plugin_cli_failed')
  })

  it('uses Claude enabledPlugins and does not surface orphaned cache or settings secrets', async () => {
    await writeJson(path.join(home, '.claude/settings.json'), {
      enabledPlugins: { 'formatter@team': true },
      env: { API_KEY: 'do-not-return' }
    })
    await writeJson(
      path.join(home, '.claude/plugins/cache/team/formatter/1.0.0/.claude-plugin/plugin.json'),
      { name: 'formatter', version: '1.0.0' }
    )
    await writeJson(
      path.join(home, '.claude/plugins/cache/team/orphan/9.0.0/.claude-plugin/plugin.json'),
      { name: 'orphan' }
    )

    const result = await claudeManager.discover({ cwd: '/workspace', env })
    expect(result.plugins).toHaveLength(1)
    expect(JSON.stringify(result)).not.toContain('do-not-return')
    expect(result.plugins[0]).toMatchObject({ marketplace: 'team', name: 'formatter', state: 'enabled' })
  })

  it('merges Claude project settings layers while keeping the user declaration separate', async () => {
    const project = path.join(home, 'claude-project')
    await writeJson(path.join(home, '.claude/settings.json'), {
      enabledPlugins: { 'formatter@team': true }
    })
    await writeJson(path.join(project, '.claude/settings.json'), {
      enabledPlugins: { 'base-only@team': true, 'formatter@team': true }
    })
    await writeJson(path.join(project, '.claude/settings.local.json'), {
      enabledPlugins: { 'formatter@team': false }
    })
    await writeJson(
      path.join(home, '.claude/plugins/cache/team/formatter/1.0.0/.claude-plugin/plugin.json'),
      { name: 'formatter', version: '1.0.0' }
    )
    await writeJson(
      path.join(home, '.claude/plugins/cache/team/base-only/1.0.0/.claude-plugin/plugin.json'),
      { name: 'base-only', version: '1.0.0' }
    )

    const result = await claudeManager.discover({ cwd: project, env })
    const formatter = result.plugins.filter(plugin => plugin.name === 'formatter')

    expect(formatter).toHaveLength(2)
    expect(formatter).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: 'user', state: 'enabled' }),
      expect.objectContaining({
        scope: 'project',
        state: 'disabled',
        source: expect.objectContaining({ displayPath: '~/claude-project/.claude/settings.local.json' })
      })
    ]))
    expect(result.plugins.filter(plugin => plugin.name === 'base-only')).toEqual([
      expect.objectContaining({ scope: 'project', state: 'enabled' })
    ])
  })

  it('reads Gemini extension manifests and workspace enablement without reading .env', async () => {
    const extensionRoot = path.join(home, '.gemini/extensions/database')
    await writeJson(path.join(extensionRoot, 'gemini-extension.json'), {
      name: 'database',
      version: '1.2.0',
      description: 'Database tools'
    })
    await writeFile(path.join(extensionRoot, '.env'), 'DATABASE_TOKEN=do-not-return\n', 'utf8')
    await writeJson(path.join(home, '.gemini/extensions/extension-enablement.json'), {
      database: { overrides: ['!/*'] }
    })

    const result = await geminiManager.discover({ cwd: '/workspace', env })
    expect(result.plugins[0]).toMatchObject({ name: 'database', state: 'disabled', version: '1.2.0' })
    expect(JSON.stringify(result)).not.toContain('do-not-return')
  })

  it('lists Copilot installed copies but ignores plugin-data and platform cache', async () => {
    await writeJson(path.join(home, '.copilot/settings.json'), {
      enabledPlugins: { 'review@team': false }
    })
    await writeJson(path.join(home, '.copilot/installed-plugins/team/review/plugin.json'), {
      name: 'review',
      version: '3.0.0'
    })
    await writeJson(path.join(home, '.copilot/plugin-data/team/hidden/plugin.json'), { name: 'hidden' })
    await writeJson(path.join(home, 'Library/Caches/copilot/marketplaces/team/plugin.json'), { name: 'cache' })

    const result = await copilotManager.discover({ cwd: '/workspace', env })
    expect(result.plugins).toHaveLength(1)
    expect(result.plugins[0]).toMatchObject({ marketplace: 'team', name: 'review', state: 'disabled' })
  })

  it('merges Copilot project settings in explicit precedence order', async () => {
    const project = path.join(home, 'copilot-project')
    await writeJson(path.join(home, '.copilot/installed-plugins/team/review/plugin.json'), {
      name: 'review',
      version: '3.0.0'
    })
    await writeJson(path.join(project, '.github/copilot/settings.json'), {
      enabledPlugins: { 'review@team': false }
    })
    await writeJson(path.join(project, '.github/copilot/settings.local.json'), {
      enabledPlugins: { 'review@team': true }
    })
    await writeJson(path.join(project, '.claude/settings.json'), {
      enabledPlugins: { 'review@team': true }
    })
    await writeJson(path.join(project, '.claude/settings.local.json'), {
      enabledPlugins: { 'review@team': false }
    })

    const result = await copilotManager.discover({ cwd: project, env })
    const review = result.plugins.filter(plugin => plugin.name === 'review')

    expect(review).toHaveLength(2)
    expect(review).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: 'user', state: 'enabled' }),
      expect.objectContaining({
        scope: 'project',
        state: 'disabled',
        source: expect.objectContaining({ displayPath: '~/copilot-project/.claude/settings.local.json' })
      })
    ]))
  })

  it('lists Kimi manifests without reading credential injection config', async () => {
    const pluginRoot = path.join(home, '.kimi/plugins/tools')
    await writeJson(path.join(pluginRoot, 'plugin.json'), {
      name: 'tools',
      version: '1.0.0',
      config_file: 'config.json'
    })
    await writeJson(path.join(pluginRoot, 'config.json'), { api_key: 'do-not-return' })

    const result = await kimiManager.discover({ cwd: '/workspace', env })
    expect(result.plugins[0]).toMatchObject({ name: 'tools', state: 'enabled' })
    expect(JSON.stringify(result)).not.toContain('do-not-return')
  })

  it('lists only direct OpenCode declarations and local files, not node_modules dependencies', async () => {
    await writeJson(path.join(home, '.config/opencode/opencode.json'), {
      plugin: ['opencode-wakatime', '@team/plugin']
    })
    await mkdir(path.join(home, '.config/opencode/plugins'), { recursive: true })
    await writeFile(path.join(home, '.config/opencode/plugins/local.ts'), 'export const plugin = true\n', 'utf8')
    await writeJson(path.join(home, '.cache/opencode/node_modules/transitive/package.json'), { name: 'transitive' })

    const result = await opencodeManager.discover({ cwd: '/workspace', env })
    expect(result.plugins.map(plugin => plugin.name)).toEqual(['opencode-wakatime', '@team/plugin', 'local'])
    expect(result.plugins.some(plugin => plugin.name === 'transitive')).toBe(false)
  })

  it('keeps same-name Home and project plugins distinct across all adapters', async () => {
    const project = path.join(home, 'project')
    await mkdir(path.join(home, '.codex'), { recursive: true })
    await writeFile(path.join(home, '.codex/config.toml'), '[plugins."same@team"]\nenabled = true\n')
    await writeJson(path.join(home, '.codex/plugins/cache/team/same/1/.codex-plugin/plugin.json'), { name: 'same' })
    await writeJson(path.join(project, '.codex/plugins/same/.codex-plugin/plugin.json'), { name: 'same' })

    await writeJson(path.join(home, '.claude/settings.json'), { enabledPlugins: { 'same@team': true } })
    await writeJson(path.join(home, '.claude/plugins/cache/team/same/1/.claude-plugin/plugin.json'), { name: 'same' })
    await writeJson(path.join(project, '.claude/plugins/same/.claude-plugin/plugin.json'), { name: 'same' })

    await writeJson(path.join(home, '.gemini/extensions/same/gemini-extension.json'), { name: 'same' })
    await writeJson(path.join(project, '.gemini/extensions/same/gemini-extension.json'), { name: 'same' })

    await writeJson(path.join(home, '.copilot/installed-plugins/team/same/plugin.json'), { name: 'same' })
    await writeJson(path.join(project, '.github/copilot/settings.json'), { enabledPlugins: { 'same@team': true } })

    await writeJson(path.join(home, '.kimi/plugins/same/kimi.plugin.json'), { name: 'same' })
    await writeJson(path.join(project, '.kimi/plugins/same/kimi.plugin.json'), { name: 'same' })

    await writeJson(path.join(home, '.config/opencode/opencode.json'), { plugin: ['same'] })
    await writeJson(path.join(project, 'opencode.json'), { plugin: ['same'] })

    for (const manager of [codexManager, claudeManager, geminiManager, copilotManager, kimiManager, opencodeManager]) {
      const samePlugins = (await manager.discover({ cwd: project, env })).plugins.filter(plugin =>
        plugin.name === 'same'
      )
      expect(samePlugins.map(plugin => plugin.scope)).toContain('project')
      expect(samePlugins.some(plugin => plugin.scope !== 'project')).toBe(true)
      expect(new Set(samePlugins.map(plugin => plugin.id)).size).toBe(samePlugins.length)
    }
  })

  it('ignores project plugin symlinks escaping their declared root and never reads secret files', async () => {
    const project = path.join(home, 'project')
    const outside = path.join(home, 'outside-extension')
    await writeJson(path.join(outside, 'gemini-extension.json'), {
      name: 'escaped',
      description: 'do-not-return'
    })
    const projectExtensions = path.join(project, '.gemini/extensions')
    await mkdir(projectExtensions, { recursive: true })
    await symlink(outside, path.join(projectExtensions, 'escaped'))
    await writeJson(path.join(projectExtensions, 'safe/gemini-extension.json'), { name: 'safe' })
    await writeFile(path.join(projectExtensions, 'safe/.env'), 'TOKEN=do-not-return\n')

    const result = await geminiManager.discover({ cwd: project, env })
    expect(result.plugins.filter(plugin => plugin.scope === 'project').map(plugin => plugin.name)).toEqual(['safe'])
    expect(JSON.stringify(result)).not.toContain('do-not-return')
  })
})
