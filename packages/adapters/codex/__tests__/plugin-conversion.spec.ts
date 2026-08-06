/* eslint-disable max-lines -- conversion security boundaries stay covered in one end-to-end fixture */
import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { resolveManagedPluginScope } from '@oneworks/utils'

import { installAdapterPluginWithInstaller } from '../../../../apps/cli/src/commands/@core/plugin-install'
import { collectCodexAppMetadata } from '../src/plugins/app-metadata'
import { collectAppMetadataFiles } from '../src/plugins/app-metadata-files'
import { readBoundedAppManifest } from '../src/plugins/app-metadata-reader'
import { codexPluginInstaller } from '../src/plugins/index'
import { parseCodexPluginManifest } from '../src/plugins/source'
import { readBoundedRegularFileNoFollow } from '../src/runtime/bounded-regular-file-read'

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

describe('codex plugin conversion', () => {
  it('fails closed when a discovered app metadata leaf is replaced with a symlink', async () => {
    const cwd = await createTempDir()
    const pluginRoot = path.join(cwd, 'codex-plugin')
    const appsDir = path.join(pluginRoot, 'apps')
    const appPath = path.join(appsDir, 'docs.app.json')
    const outsidePath = path.join(cwd, 'outside.app.json')
    await fs.mkdir(appsDir, { recursive: true })
    await fs.writeFile(appPath, JSON.stringify({ apps: {} }))
    await fs.writeFile(outsidePath, JSON.stringify({ apps: { outside: {} } }))

    const collection = await collectAppMetadataFiles(pluginRoot, ['apps'])
    const discovered = collection.files[0]
    expect(discovered).toBeDefined()
    await fs.rename(appPath, `${appPath}.preserved`)
    await fs.symlink(outsidePath, appPath)

    await expect(readBoundedAppManifest(discovered!)).rejects.toThrow(/changed|symbolic|ELOOP/i)
    await expect(fs.readFile(outsidePath, 'utf8')).resolves.toContain('outside')
  })

  it('fails closed when an opened app metadata leaf is swapped for a same-inode symlink', async () => {
    const cwd = await createTempDir()
    const pluginRoot = path.join(cwd, 'codex-plugin')
    const appsDir = path.join(pluginRoot, 'apps')
    const appPath = path.join(appsDir, 'docs.app.json')
    const preservedPath = `${appPath}.preserved`
    await fs.mkdir(appsDir, { recursive: true })
    await fs.writeFile(appPath, JSON.stringify({ apps: { docs: {} } }))

    const collection = await collectAppMetadataFiles(pluginRoot, ['apps'])
    const discovered = collection.files[0]
    expect(discovered).toBeDefined()

    await expect(readBoundedAppManifest(discovered!, {
      beforePostOpenIdentityCheck: async () => {
        await fs.rename(appPath, preservedPath)
        await fs.symlink(preservedPath, appPath)
      }
    })).rejects.toThrow(/changed|symbolic/i)
    await expect(fs.readFile(preservedPath, 'utf8')).resolves.toContain('docs')
  })

  it('fails closed when an app metadata ancestor is replaced with an outside symlink', async () => {
    const cwd = await createTempDir()
    const pluginRoot = path.join(cwd, 'codex-plugin')
    const appsDir = path.join(pluginRoot, 'apps')
    const outsideDir = path.join(cwd, 'outside-apps')
    await fs.mkdir(appsDir, { recursive: true })
    await fs.mkdir(outsideDir, { recursive: true })
    await fs.writeFile(path.join(appsDir, 'docs.app.json'), JSON.stringify({ apps: { docs: {} } }))
    await fs.writeFile(path.join(outsideDir, 'docs.app.json'), JSON.stringify({ apps: { outside: {} } }))

    const collection = await collectAppMetadataFiles(pluginRoot, ['apps'])
    const discovered = collection.files[0]
    expect(discovered).toBeDefined()
    await fs.rename(appsDir, `${appsDir}.preserved`)
    await fs.symlink(outsideDir, appsDir)

    await expect(readBoundedAppManifest(discovered!)).rejects.toThrow(/changed/i)
    await expect(fs.readFile(path.join(outsideDir, 'docs.app.json'), 'utf8')).resolves.toContain('outside')
  })

  it('fails closed when the Codex manifest ancestor is replaced with an outside symlink', async () => {
    const cwd = await createTempDir()
    const pluginRoot = path.join(cwd, 'codex-plugin')
    const manifestDir = path.join(pluginRoot, '.codex-plugin')
    const preservedManifestDir = `${manifestDir}.preserved`
    const outsideDir = path.join(cwd, 'outside-plugin')
    await fs.mkdir(manifestDir, { recursive: true })
    await fs.mkdir(outsideDir, { recursive: true })
    await fs.writeFile(
      path.join(manifestDir, 'plugin.json'),
      JSON.stringify({ name: 'inside-plugin' })
    )
    await fs.writeFile(
      path.join(outsideDir, 'plugin.json'),
      JSON.stringify({ name: 'outside-plugin' })
    )

    await expect(parseCodexPluginManifest(pluginRoot, {
      beforeDirectoryOpen: async (relativePath) => {
        if (relativePath !== '.codex-plugin') return
        await fs.rename(manifestDir, preservedManifestDir)
        await fs.symlink(outsideDir, manifestDir)
      }
    })).rejects.toThrow(/read safely/i)
    await expect(fs.readFile(path.join(outsideDir, 'plugin.json'), 'utf8'))
      .resolves.toContain('outside-plugin')
  })

  it('binds ancestor opens to the approved root without a discovered leaf identity', async () => {
    const cwd = await createTempDir()
    const pluginRoot = path.join(cwd, 'codex-plugin')
    const appsDir = path.join(pluginRoot, 'apps')
    const preservedAppsDir = `${appsDir}.preserved`
    const outsideDir = path.join(cwd, 'outside-apps')
    const appPath = path.join(appsDir, 'docs.app.json')
    await fs.mkdir(appsDir, { recursive: true })
    await fs.mkdir(outsideDir, { recursive: true })
    await fs.writeFile(appPath, JSON.stringify({ apps: { inside: {} } }))
    await fs.writeFile(
      path.join(outsideDir, 'docs.app.json'),
      JSON.stringify({ apps: { outside: {} } })
    )

    const content = await readBoundedRegularFileNoFollow({
      afterDirectoryOpen: async (relativePath) => {
        if (relativePath !== 'apps') return
        await fs.unlink(appsDir)
        await fs.rename(preservedAppsDir, appsDir)
      },
      beforeDirectoryOpen: async (relativePath) => {
        if (relativePath !== 'apps') return
        await fs.rename(appsDir, preservedAppsDir)
        await fs.symlink(outsideDir, appsDir)
      },
      canonicalParent: await fs.realpath(pluginRoot),
      filePath: path.join(await fs.realpath(pluginRoot), 'apps', 'docs.app.json'),
      maxBytes: 256 * 1024
    })

    expect(content).toBeUndefined()
    await expect(fs.readFile(appPath, 'utf8')).resolves.toContain('inside')
    await expect(fs.readFile(path.join(outsideDir, 'docs.app.json'), 'utf8'))
      .resolves.toContain('outside')
  })

  it('preserves a safe npm spec as the generated package source identity', async () => {
    const cwd = await createTempDir()
    const pluginRoot = path.join(cwd, 'codex-plugin')
    const npmSource = {
      spec: '@scope/codex-demo@4.0.0',
      type: 'npm' as const
    }
    await fs.mkdir(path.join(pluginRoot, '.codex-plugin'), { recursive: true })
    await fs.writeFile(
      path.join(pluginRoot, '.codex-plugin', 'plugin.json'),
      JSON.stringify({ name: '@scope/codex-demo', version: '4.0.0' })
    )
    const npmInstaller = {
      ...codexPluginInstaller,
      resolveSource: async () => ({
        installSource: { path: pluginRoot, type: 'path' as const },
        managedSource: npmSource
      })
    }

    const result = await installAdapterPluginWithInstaller(npmInstaller, {
      cwd,
      silent: true,
      source: npmSource.spec
    })
    const generatedManifest = JSON.parse(
      await fs.readFile(path.join(result.installDir, 'oneworks', 'plugin.json'), 'utf8')
    ) as Record<string, unknown>

    expect(result.config.scope).toBe(resolveManagedPluginScope({
      adapter: 'codex',
      name: '@scope/codex-demo',
      source: npmSource
    }))
    expect(generatedManifest).toMatchObject({
      name: '@scope/codex-demo',
      source: {
        adapter: 'codex',
        kind: 'package',
        plugin: '@scope/codex-demo@4.0.0'
      },
      version: '4.0.0'
    })
    expect(JSON.stringify(generatedManifest)).not.toContain(pluginRoot)
  })

  it('fails closed for Codex app metadata symlinks outside the plugin root', async () => {
    const cwd = await createTempDir()
    const pluginRoot = path.join(cwd, 'codex-plugin')
    const outsideRoot = path.join(cwd, 'outside')
    await fs.mkdir(path.join(pluginRoot, '.codex-plugin'), { recursive: true })
    await fs.mkdir(path.join(pluginRoot, 'apps'), { recursive: true })
    await fs.mkdir(outsideRoot, { recursive: true })
    await fs.writeFile(
      path.join(pluginRoot, '.codex-plugin', 'plugin.json'),
      JSON.stringify({ apps: './apps', name: 'codex-demo', version: '1.0.0' })
    )
    const outsideApp = path.join(outsideRoot, 'outside.app.json')
    await fs.writeFile(outsideApp, JSON.stringify({ id: 'outside' }))
    await fs.symlink(outsideApp, path.join(pluginRoot, 'apps', 'outside.app.json'))

    await expect(
      collectCodexAppMetadata(pluginRoot, { apps: '../outside', name: 'codex-demo' })
    ).rejects.toThrow(/must stay within the plugin root/i)
    await expect(installAdapterPluginWithInstaller(codexPluginInstaller, {
      cwd,
      source: pluginRoot,
      silent: true
    })).rejects.toThrow(/symbolic links/i)
  })

  it('generates a stable fallback version and bounded diagnostic when Codex metadata omits version', async () => {
    const cwd = await createTempDir()
    const pluginRoot = path.join(cwd, 'codex-plugin')
    await fs.mkdir(path.join(pluginRoot, '.codex-plugin'), { recursive: true })
    await fs.writeFile(
      path.join(pluginRoot, '.codex-plugin', 'plugin.json'),
      JSON.stringify({ name: 'codex-demo' })
    )

    const result = await installAdapterPluginWithInstaller(codexPluginInstaller, {
      cwd,
      source: pluginRoot,
      silent: true
    })
    const generatedManifest = JSON.parse(
      await fs.readFile(path.join(result.installDir, 'oneworks', 'plugin.json'), 'utf8')
    ) as Record<string, unknown>

    expect(generatedManifest).toMatchObject({
      name: 'codex-demo',
      native: {
        diagnostics: [{
          code: 'codex_plugin_version_missing',
          level: 'warning',
          message: 'The Codex plugin does not declare a version.'
        }]
      },
      version: '0.0.0'
    })
    expect(JSON.stringify(generatedManifest)).not.toContain(pluginRoot)
  })

  it('bounds malformed Codex app diagnostics and rejects credential-like metadata without copying it', async () => {
    const cwd = await createTempDir()
    const pluginRoot = path.join(cwd, 'codex-plugin')
    await fs.mkdir(path.join(pluginRoot, 'apps'), { recursive: true })
    await fs.writeFile(
      path.join(pluginRoot, 'apps', 'client_secret.app.json'),
      JSON.stringify({ apps: { fileSafe: { id: 'connector_file_safe' } } })
    )
    await fs.writeFile(path.join(pluginRoot, 'apps', 'malformed.app.json'), '{')
    await fs.writeFile(
      path.join(pluginRoot, 'apps', 'mixed.app.json'),
      JSON.stringify({
        apps: {
          good: {
            authentication: {
              authorizationUrl: 'https://example.test/oauth/authorize',
              callbackPath: '/oauth/callback',
              scopes: ['repo:read'],
              type: 'oauth2'
            },
            id: 'connector_good',
            required: true
          },
          encodedPath: { id: encodeURIComponent('/custom/private') },
          path: { id: `${pluginRoot}/cache` },
          secretKey: { clientSecretValue: 'must-not-leak', id: 'secret-key' },
          secretValue: {
            authentication: { type: 'Bearer must-not-leak-credential-value' },
            id: 'secret-value'
          },
          unknown: { id: 'unknown', metadata: { label: 'not-declarative' } }
        }
      })
    )
    await fs.writeFile(
      path.join(pluginRoot, 'apps', 'oversized-string.app.json'),
      JSON.stringify({
        apps: {
          oversized: {
            capabilities: ['x'.repeat(16 * 1024 + 1)],
            id: 'oversized-string'
          }
        }
      })
    )
    await fs.writeFile(
      path.join(pluginRoot, 'apps', 'prototype.app.json'),
      '{"apps":{"prototype":{"id":"prototype","__proto__":{"polluted":true}}}}'
    )
    let deeplyNested: Record<string, unknown> = { id: 'too-deep' }
    for (let depth = 0; depth < 10; depth += 1) deeplyNested = { nested: deeplyNested }
    await fs.writeFile(
      path.join(pluginRoot, 'apps', 'too-deep.app.json'),
      JSON.stringify({ apps: { deeplyNested } })
    )

    const result = await collectCodexAppMetadata(pluginRoot, { apps: './apps', name: 'codex-demo' })

    expect(result.apps).toEqual([
      {
        id: 'connector_file_safe',
        name: 'fileSafe'
      },
      {
        authentication: {
          authorizationUrl: 'https://example.test/oauth/authorize',
          callbackPath: '/oauth/callback',
          scopes: ['repo:read'],
          type: 'oauth2'
        },
        connectionRequirements: { required: true },
        id: 'connector_good',
        name: 'good'
      }
    ])
    expect(result.generatedFiles).toHaveLength(2)
    expect(result.generatedFiles.some(file => file.content.includes('"/oauth/callback"'))).toBe(true)
    expect(result.generatedFiles.every(file => !file.path.includes('client_secret'))).toBe(true)
    expect(result.diagnostics.map(item => item.code)).toEqual([
      'codex_app_metadata_malformed',
      'codex_app_metadata_app_invalid',
      'codex_app_metadata_app_invalid',
      'codex_app_metadata_secret_rejected',
      'codex_app_metadata_secret_rejected',
      'codex_app_metadata_app_invalid',
      'codex_app_metadata_app_invalid',
      'codex_app_metadata_app_invalid',
      'codex_app_metadata_app_invalid'
    ])
    expect(JSON.stringify(result)).not.toContain('must-not-leak')
    expect(result.diagnostics.every(item => (
      !item.message.includes(pluginRoot) && Buffer.byteLength(item.message, 'utf8') <= 1024
    ))).toBe(true)
  })

  it('enforces deterministic Codex app metadata count and total-byte limits', async () => {
    const cwd = await createTempDir()
    const pluginRoot = path.join(cwd, 'codex-plugin')
    await fs.mkdir(path.join(pluginRoot, 'apps'), { recursive: true })

    const tooManyEntries = await collectCodexAppMetadata(pluginRoot, {
      apps: Array.from({ length: 65 }, (_value, index) => `./apps/${index}.app.json`),
      name: 'codex-demo'
    })
    expect(tooManyEntries).toMatchObject({
      apps: [],
      diagnostics: [{ code: 'codex_app_metadata_manifest_invalid' }],
      generatedFiles: []
    })

    const largePermission = `repository:${'segment.'.repeat(30)}read`
    for (let index = 0; index < 6; index += 1) {
      const apps = Object.fromEntries(
        Array.from({ length: 12 }, (_value, appIndex) => [
          `app-${index}-${appIndex}`,
          {
            id: `connector-${index}-${appIndex}`,
            permissions: Array.from({ length: 64 }, () => largePermission)
          }
        ])
      )
      await fs.writeFile(
        path.join(pluginRoot, 'apps', `${index}.app.json`),
        JSON.stringify({ apps })
      )
    }
    const totalLimited = await collectCodexAppMetadata(pluginRoot, {
      apps: './apps',
      name: 'codex-demo'
    })
    expect(totalLimited.generatedFiles).toHaveLength(5)
    expect(totalLimited.apps).toHaveLength(60)
    expect(totalLimited.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'codex_app_metadata_total_limit' })
    )
  })

  it('fails closed per app for credential-shaped or opaque declarative values', async () => {
    const cwd = await createTempDir()
    const pluginRoot = path.join(cwd, 'codex-plugin')
    const credentialUrlKeys = [
      'clientsecretvalue',
      'CLIENTSECRETVALUE',
      'apiKeyValue',
      'oauth-client_secret.valueSuffix',
      '%2563lient%2553ecret%2556alue',
      'api%255Fkey%255Fvalue',
      'clientSecretValue%'
    ]
    await fs.mkdir(path.join(pluginRoot, 'apps'), { recursive: true })
    await fs.writeFile(
      path.join(pluginRoot, 'apps', 'strict.app.json'),
      JSON.stringify({
        apps: {
          good: {
            authentication: {
              authorizationUrl:
                'https://example.test/oauth?client_id=docs&redirect_uri=%2Foauth%2Fcallback&redirect%255Furi=%2Fencoded&code_challenge=valid&login_hint=docs',
              type: 'oauth2'
            },
            id: 'connector_good',
            permissions: ['repository:read']
          },
          ...Object.fromEntries(credentialUrlKeys.map((key, index) => [
            `credentialKey${index}`,
            {
              authentication: {
                authorizationUrl: `https://example.test/oauth?${key}=must-not-leak`,
                type: 'oauth2'
              },
              id: `connector_key_${index}`
            }
          ])),
          credentialUrl: {
            authentication: {
              authorizationUrl: 'https://example.test/oauth?clientSecretValue=must-not-leak',
              type: 'oauth2'
            },
            id: 'connector_url'
          },
          credentialUrlSuffix: {
            authentication: {
              tokenUrl: 'https://example.test/token?oauthClientSecretValueSuffix=must-not-leak',
              type: 'oauth2'
            },
            id: 'connector_url_suffix'
          },
          credentialId: { id: 'connector_AKIAIOSFODNN7EXAMPLE' },
          credentialType: { authentication: { type: 'AIzaSyD-abcdefghijklmnopqrstuvwxyz1234' }, id: 'connector_type' },
          credentialScope: {
            authentication: { scopes: ['AIzaSyD-abcdefghijklmnopqrstuvwxyz1234'], type: 'oauth2' },
            id: 'connector_scope'
          },
          credentialCapability: { capabilities: ['AKIAIOSFODNN7EXAMPLE'], id: 'connector_capability' },
          opaquePermission: {
            id: 'connector_permission',
            permissions: ['abcdefghijklmnopqrstuvwx.yz0123456789abcdefghijklmnop']
          }
        }
      })
    )

    const result = await collectCodexAppMetadata(pluginRoot, { apps: './apps', name: 'codex-demo' })

    expect(result.apps).toEqual([{
      authentication: {
        authorizationUrl:
          'https://example.test/oauth?client_id=docs&redirect_uri=%2Foauth%2Fcallback&redirect%255Furi=%2Fencoded&code_challenge=valid&login_hint=docs',
        type: 'oauth2'
      },
      id: 'connector_good',
      name: 'good',
      permissions: ['repository:read']
    }])
    expect(JSON.stringify(result)).not.toContain('must-not-leak')
    expect(JSON.stringify(result)).not.toContain('AKIAIOSFODNN7EXAMPLE')
    expect(JSON.stringify(result)).not.toContain('AIzaSyD-abcdefghijklmnopqrstuvwxyz1234')
  })

  it('rejects repeatedly encoded credential values from public app URL fields', async () => {
    const cwd = await createTempDir()
    const pluginRoot = path.join(cwd, 'codex-plugin')
    const encodedAuthorizationValue = ['sk', '%252D', 'abcdefghijklmnop'].join('')
    const encodedCallbackValue = ['api', '%255F', 'key', '%253D', 'abcdefghijklmnop'].join('')
    const encodedTokenValue = ['ghp', '%252D', 'abcdefghijklmnop'].join('')
    await fs.mkdir(path.join(pluginRoot, 'apps'), { recursive: true })
    await fs.writeFile(
      path.join(pluginRoot, 'apps', 'encoded-credentials.app.json'),
      JSON.stringify({
        apps: {
          encodedAuthorization: {
            authentication: {
              authorizationUrl: `https://example.test/oauth?state=${encodedAuthorizationValue}`,
              type: 'oauth2'
            },
            id: 'connector_encoded_authorization'
          },
          encodedCallback: {
            authentication: {
              callbackPath: `/oauth/callback?state=${encodedCallbackValue}`,
              type: 'oauth2'
            },
            id: 'connector_encoded_callback'
          },
          encodedToken: {
            authentication: {
              tokenUrl: `https://example.test/token?state=${encodedTokenValue}`,
              type: 'oauth2'
            },
            id: 'connector_encoded_token'
          }
        }
      })
    )

    const result = await collectCodexAppMetadata(pluginRoot, {
      apps: './apps',
      name: 'codex-demo'
    })

    expect(result.apps).toEqual([])
    expect(result.generatedFiles).toEqual([])
    expect(result.diagnostics).toHaveLength(3)
  })

  it('uses the public native app limit during conversion and reports the boundary', async () => {
    const cwd = await createTempDir()
    const pluginRoot = path.join(cwd, 'codex-plugin')
    await fs.mkdir(path.join(pluginRoot, 'apps'), { recursive: true })
    await fs.writeFile(
      path.join(pluginRoot, 'apps', 'many.app.json'),
      JSON.stringify({
        apps: Object.fromEntries(Array.from({ length: 65 }, (_value, index) => [
          `app${index}`,
          { id: `connector_app${index}` }
        ]))
      })
    )

    const result = await collectCodexAppMetadata(pluginRoot, { apps: './apps', name: 'codex-demo' })

    expect(result.apps).toHaveLength(64)
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'codex_app_metadata_app_limit' })
    )
  })
})
