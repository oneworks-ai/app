import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { loadConfig, resetConfigCache } from '#~/load.js'

describe('marketplace config loading', () => {
  it('loads a Codex app-server marketplace source with the remote catalog capability', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-codex-app-server-marketplace-'))

    try {
      await writeFile(
        path.join(tempDir, '.oo.config.yaml'),
        [
          'marketplaces:',
          '  openai-curated-remote:',
          '    type: codex',
          '    options:',
          '      source:',
          '        source: app-server',
          '        marketplace: openai-curated-remote',
          '        includeRemoteCatalog: true'
        ].join('\n')
      )

      resetConfigCache()
      const [projectConfig] = await loadConfig({ cwd: tempDir, jsonVariables: {} })

      expect(projectConfig?.marketplaces).toEqual({
        'openai-curated-remote': {
          type: 'codex',
          options: {
            source: {
              source: 'app-server',
              marketplace: 'openai-curated-remote',
              includeRemoteCatalog: true
            }
          }
        }
      })
    } finally {
      resetConfigCache()
      await rm(tempDir, { force: true, recursive: true })
    }
  })

  it('loads Codex marketplace sources and declared plugins', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-codex-marketplace-'))

    try {
      await writeFile(
        path.join(tempDir, '.oo.config.yaml'),
        [
          'marketplaces:',
          '  openai-plugins:',
          '    type: codex',
          '    plugins:',
          '      github: true',
          '    options:',
          '      source:',
          '        source: github',
          '        repo: openai/plugins'
        ].join('\n')
      )

      resetConfigCache()
      const [projectConfig] = await loadConfig({ cwd: tempDir, jsonVariables: {} })

      expect(projectConfig?.marketplaces).toEqual({
        'openai-plugins': {
          type: 'codex',
          plugins: { github: { enabled: true } },
          options: { source: { source: 'github', repo: 'openai/plugins' } }
        }
      })
    } finally {
      resetConfigCache()
      await rm(tempDir, { force: true, recursive: true })
    }
  })

  it('rejects Claude-only source kinds for Codex marketplaces', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-invalid-codex-marketplace-'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      await writeFile(
        path.join(tempDir, '.oo.config.yaml'),
        [
          'marketplaces:',
          '  invalid-codex:',
          '    type: codex',
          '    options:',
          '      source:',
          '        source: url',
          '        url: https://example.com/marketplace.json'
        ].join('\n')
      )

      resetConfigCache()
      const [projectConfig] = await loadConfig({ cwd: tempDir, jsonVariables: {} })

      expect(projectConfig?.marketplaces).toBeUndefined()
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(
        'Unsupported Codex marketplace source "url"'
      ))
    } finally {
      errorSpy.mockRestore()
      resetConfigCache()
      await rm(tempDir, { force: true, recursive: true })
    }
  })

  it('loads declared marketplace plugins and syncOnRun config', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-marketplace-plugins-'))

    try {
      await writeFile(
        path.join(tempDir, '.oo.config.yaml'),
        [
          'marketplaces:',
          '  team-tools:',
          '    type: claude-code',
          '    syncOnRun: true',
          '    plugins:',
          '      reviewer:',
          '        scope: review',
          '      chrome: false',
          '    options:',
          '      source:',
          '        source: settings',
          '        plugins:',
          '          - name: reviewer',
          '            source:',
          '              source: npm',
          '              package: "@acme/reviewer"'
        ].join('\n')
      )

      resetConfigCache()
      const [projectConfig] = await loadConfig({
        cwd: tempDir,
        jsonVariables: {}
      })

      expect(projectConfig?.marketplaces).toEqual({
        'team-tools': {
          type: 'claude-code',
          syncOnRun: true,
          plugins: {
            reviewer: {
              scope: 'review'
            },
            chrome: {
              enabled: false
            }
          },
          options: {
            source: {
              source: 'settings',
              plugins: [
                {
                  name: 'reviewer',
                  source: {
                    source: 'npm',
                    package: '@acme/reviewer'
                  }
                }
              ]
            }
          }
        }
      })
    } finally {
      resetConfigCache()
      await rm(tempDir, { force: true, recursive: true })
    }
  })

  it('rejects inline Claude settings marketplaces that use relative plugin sources', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-marketplace-settings-'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      await writeFile(
        path.join(tempDir, '.oo.config.yaml'),
        [
          'marketplaces:',
          '  team-tools:',
          '    type: claude-code',
          '    options:',
          '      source:',
          '        source: settings',
          '        plugins:',
          '          - name: reviewer',
          '            source: reviewer'
        ].join('\n')
      )

      resetConfigCache()
      const [projectConfig, userConfig] = await loadConfig({
        cwd: tempDir,
        jsonVariables: {}
      })

      expect(projectConfig?.marketplaces).toBeUndefined()
      expect(userConfig?.marketplaces).toBeUndefined()
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(
        'Inline Claude settings marketplaces must use an explicit source object'
      ))
    } finally {
      errorSpy.mockRestore()
      resetConfigCache()
      await rm(tempDir, { force: true, recursive: true })
    }
  })
})
