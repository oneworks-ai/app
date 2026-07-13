import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { installAdapterPluginWithInstaller } from '../../../../apps/cli/src/commands/@core/plugin-install'
import { toCodexAppServerCatalogPlugin } from '../src/plugins/app-server-catalog'
import { parseCodexAppServerPluginList } from '../src/plugins/app-server-marketplace'
import {
  codexPluginInstaller,
  getEffectiveCodexMarketplace,
  loadCodexMarketplaceCatalogFromSource
} from '../src/plugins/index'

const tempDirs: string[] = []
const originalProjectHomeProjectsDir = process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__

const createTempDir = async () => {
  const cwd = await fs.mkdtemp(path.join(tmpdir(), 'ow-codex-plugin-'))
  tempDirs.push(cwd)
  process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = path.join(cwd, '.oneworks-projects')
  return cwd
}

afterEach(async () => {
  if (originalProjectHomeProjectsDir == null) {
    delete process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__
  } else {
    process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = originalProjectHomeProjectsDir
  }
  await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })))
})

describe('codex plugin manager', () => {
  it('normalizes the remote Codex catalog without losing featured, icon, version, or install state', () => {
    expect(parseCodexAppServerPluginList({
      featuredPluginIds: ['notion@openai-curated-remote'],
      marketplaces: [{
        name: 'openai-curated-remote',
        interface: { displayName: 'Codex curated' },
        plugins: [{
          enabled: false,
          id: 'notion@openai-curated-remote',
          installPolicy: 'ALLOWED',
          installed: false,
          interface: {
            displayName: 'Notion',
            logoUrl: 'https://example.test/notion.png',
            shortDescription: 'Notion workflows'
          },
          localVersion: null,
          name: 'notion',
          remotePluginId: 'remote-notion',
          shareContext: { remoteVersion: '1.2.3' },
          source: { type: 'remote' }
        }]
      }]
    })).toEqual({
      featuredPluginIds: ['notion@openai-curated-remote'],
      marketplaces: [{
        name: 'openai-curated-remote',
        title: 'Codex curated',
        plugins: [{
          enabled: false,
          id: 'notion@openai-curated-remote',
          installPolicy: 'ALLOWED',
          installed: false,
          interface: {
            displayName: 'Notion',
            logoUrl: 'https://example.test/notion.png',
            shortDescription: 'Notion workflows'
          },
          name: 'notion',
          remotePluginId: 'remote-notion',
          remoteVersion: '1.2.3',
          source: { type: 'remote' }
        }]
      }]
    })
  })

  it('rejects malformed Codex app-server catalog responses', () => {
    expect(() => parseCodexAppServerPluginList({ marketplaces: null })).toThrow(
      /invalid codex app-server plugin\/list response/i
    )
  })

  it('uses the remote marketplace version and blocks unavailable remote plugins', () => {
    expect(toCodexAppServerCatalogPlugin(
      {
        availability: 'DISABLED_BY_ADMIN',
        enabled: false,
        id: 'figma@openai-curated-remote',
        installed: true,
        interface: {
          displayName: 'Figma',
          logoUrl: 'https://example.test/figma.png',
          shortDescription: 'Design-to-code workflows'
        },
        localVersion: '1.0.0',
        name: 'figma',
        remoteVersion: '2.0.0',
        source: { type: 'remote' }
      },
      'openai-curated-remote',
      new Set(['figma@openai-curated-remote'])
    )).toEqual({
      description: 'Design-to-code workflows',
      displayName: 'Figma',
      featured: true,
      icon: { kind: 'url', url: 'https://example.test/figma.png' },
      installable: false,
      name: 'figma',
      nativeEnabled: false,
      nativeInstalled: true,
      source: {
        marketplace: 'openai-curated-remote',
        pluginId: 'figma@openai-curated-remote',
        source: 'app-server'
      },
      version: '2.0.0'
    })
  })

  it('keeps the adapter-owned remote marketplace source when config only declares a plugin', () => {
    expect(getEffectiveCodexMarketplace({
      marketplaces: {
        'openai-curated-remote': {
          type: 'codex',
          plugins: { notion: { enabled: true } }
        }
      }
    }, 'openai-curated-remote')).toEqual({
      type: 'codex',
      enabled: true,
      plugins: { notion: { enabled: true } },
      options: {
        source: {
          source: 'app-server',
          marketplace: 'openai-curated-remote',
          includeRemoteCatalog: true
        }
      }
    })
  })

  it('installs Codex skills, commands, agents, hooks, and MCP assets as a OneWorks plugin', async () => {
    const cwd = await createTempDir()
    const pluginRoot = path.join(cwd, 'codex-plugin')
    await fs.mkdir(path.join(pluginRoot, '.codex-plugin'), { recursive: true })
    await fs.mkdir(path.join(pluginRoot, 'skills', 'research'), { recursive: true })
    await fs.mkdir(path.join(pluginRoot, 'commands'), { recursive: true })
    await fs.mkdir(path.join(pluginRoot, 'agents'), { recursive: true })
    await fs.writeFile(
      path.join(pluginRoot, '.codex-plugin', 'plugin.json'),
      JSON.stringify({
        name: 'codex-demo',
        version: '1.0.0',
        description: 'Codex demo',
        hooks: './hooks.json',
        mcpServers: './.mcp.json'
      })
    )
    await fs.writeFile(path.join(pluginRoot, 'skills', 'research', 'SKILL.md'), 'Research carefully.\n')
    await fs.writeFile(path.join(pluginRoot, 'commands', 'review.md'), 'Review changes.\n')
    await fs.writeFile(path.join(pluginRoot, 'agents', 'reviewer.md'), 'Act as a reviewer.\n')
    await fs.writeFile(
      path.join(pluginRoot, 'hooks.json'),
      JSON.stringify({
        hooks: {
          SessionStart: [{ hooks: [{ type: 'command', command: 'echo ready' }] }]
        }
      })
    )
    await fs.writeFile(
      path.join(pluginRoot, '.mcp.json'),
      JSON.stringify({
        mcpServers: { docs: { command: 'docs-server' } }
      })
    )

    const result = await installAdapterPluginWithInstaller(codexPluginInstaller, {
      cwd,
      source: pluginRoot,
      silent: true
    })

    expect(result.config).toEqual(expect.objectContaining({
      adapter: 'codex',
      name: 'codex-demo'
    }))
    await expect(
      fs.readFile(path.join(result.installDir, 'oneworks', 'skills', 'research', 'SKILL.md'), 'utf8')
    ).resolves.toContain('Research carefully')
    await expect(
      fs.readFile(path.join(result.installDir, 'oneworks', 'skills', 'review', 'SKILL.md'), 'utf8')
    ).resolves.toContain('Review changes')
    await expect(
      fs.readFile(path.join(result.installDir, 'oneworks', 'entities', 'reviewer', 'README.md'), 'utf8')
    ).resolves.toContain('Act as a reviewer')
    await expect(
      fs.readFile(path.join(result.installDir, 'oneworks', 'mcp', 'docs.json'), 'utf8')
    ).resolves.toContain('docs-server')
    await expect(
      fs.readFile(path.join(result.installDir, 'oneworks', 'hooks', 'claude-hooks.json'), 'utf8')
    ).resolves.toContain('SessionStart')
  })

  it('reads a repository-backed Codex marketplace and enriches entries from plugin manifests', async () => {
    const cwd = await createTempDir()
    const marketplaceRoot = path.join(cwd, 'marketplace')
    const pluginRoot = path.join(marketplaceRoot, 'plugins', 'demo')
    await fs.mkdir(path.join(marketplaceRoot, '.agents', 'plugins'), { recursive: true })
    await fs.mkdir(path.join(pluginRoot, '.codex-plugin'), { recursive: true })
    await fs.writeFile(
      path.join(marketplaceRoot, '.agents', 'plugins', 'marketplace.json'),
      JSON.stringify({
        name: 'team-codex',
        interface: { displayName: 'Team Codex' },
        plugins: [{ name: 'demo', source: { source: 'local', path: './plugins/demo' } }]
      })
    )
    await fs.writeFile(
      path.join(pluginRoot, '.codex-plugin', 'plugin.json'),
      JSON.stringify({ name: 'demo', version: '2.0.0', description: 'Demo plugin' })
    )

    const result = await loadCodexMarketplaceCatalogFromSource(
      path.join(cwd, 'temp'),
      { source: 'directory', path: marketplaceRoot },
      'team-codex',
      async (_target, source) => {
        if (source.type !== 'path') throw new Error('Expected a path source')
        return source.path
      }
    )

    expect(result.catalog).toEqual({
      name: 'team-codex',
      title: 'Team Codex',
      plugins: [{
        name: 'demo',
        source: { source: 'local', path: './plugins/demo' },
        description: 'Demo plugin',
        version: '2.0.0'
      }]
    })
  })

  it('rejects Codex marketplace plugin symlinks outside the marketplace root', async () => {
    const cwd = await createTempDir()
    const marketplaceRoot = path.join(cwd, 'marketplace')
    const outsidePluginRoot = path.join(cwd, 'outside-plugin')
    await fs.mkdir(path.join(marketplaceRoot, '.agents', 'plugins'), { recursive: true })
    await fs.mkdir(path.join(marketplaceRoot, 'plugins'), { recursive: true })
    await fs.mkdir(path.join(outsidePluginRoot, '.codex-plugin'), { recursive: true })
    await fs.writeFile(
      path.join(marketplaceRoot, '.agents', 'plugins', 'marketplace.json'),
      JSON.stringify({
        name: 'team-codex',
        plugins: [{ name: 'demo', source: { source: 'local', path: './plugins/demo' } }]
      })
    )
    await fs.writeFile(
      path.join(outsidePluginRoot, '.codex-plugin', 'plugin.json'),
      JSON.stringify({ name: 'demo' })
    )
    await fs.symlink(outsidePluginRoot, path.join(marketplaceRoot, 'plugins', 'demo'))

    await expect(loadCodexMarketplaceCatalogFromSource(
      path.join(cwd, 'temp'),
      { source: 'directory', path: marketplaceRoot },
      'team-codex',
      async (_target, source) => {
        if (source.type !== 'path') throw new Error('Expected a path source')
        return source.path
      }
    )).rejects.toThrow(/outside the marketplace root through a symlink/i)
  })
})
