import { access, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { compilePluginClientSource } from '#~/services/plugins/client-source-compiler.js'

const repositoryPluginSources = [
  ['china-red-theme', 'client/src/index.ts'],
  ['neo-workshop-theme', 'client/src/index.ts'],
  ['focus-workbench-theme', 'client/src/index.ts'],
  ['warm-cowork-theme', 'client/src/index.ts'],
  ['external-browser-driver', 'client/src/index.tsx'],
  ['cua-driver', 'client/src/index.tsx'],
  ['demo', 'client/src/index.tsx'],
  ['demo-extension', 'client/src/index.tsx'],
  ['relay', 'src/client/index.ts', 'src']
] as const

describe('plugin client source compiler', () => {
  const temporaryRoots: string[] = []

  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  })

  for (const [pluginName, entry, sourceRoot] of repositoryPluginSources) {
    it(`compiles the ${pluginName} local plugin into one executable module`, async () => {
      const pluginRoot = path.resolve('packages', 'plugins', pluginName)
      const compiled = await compilePluginClientSource({
        cacheDir: path.resolve(os.tmpdir(), 'oneworks-plugin-client-source-test-cache'),
        entryPath: path.join(pluginRoot, entry),
        pluginRoot,
        scope: pluginName,
        sourceRoot
      })

      expect(compiled.fileName).toBe('index.js')
      expect(compiled.size).toBeGreaterThan(0)
      expect(compiled.code).toContain('activatePlugin')
    })
  }

  it('rejects source entries outside the configured plugin root', async () => {
    const pluginRoot = await mkdtemp(path.join(os.tmpdir(), 'ow-plugin-client-source-root-'))
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), 'ow-plugin-client-source-outside-'))
    temporaryRoots.push(pluginRoot, outsideRoot)
    const outsideEntry = path.join(outsideRoot, 'index.ts')
    await writeFile(outsideEntry, 'export const outside = true\n')

    await expect(compilePluginClientSource({
      cacheDir: path.join(pluginRoot, '.cache'),
      entryPath: outsideEntry,
      pluginRoot,
      scope: 'outside'
    })).rejects.toThrow('inside the plugin root')
  })

  it('rejects an explicit client source root outside the plugin root', async () => {
    const outerRoot = await mkdtemp(path.join(os.tmpdir(), 'ow-plugin-client-explicit-root-'))
    temporaryRoots.push(outerRoot)
    const pluginRoot = path.join(outerRoot, 'plugin')
    const sourceRoot = path.join(pluginRoot, 'client')
    await mkdir(sourceRoot, { recursive: true })
    const entryPath = path.join(sourceRoot, 'index.ts')
    await writeFile(entryPath, 'export const inside = true\n')

    await expect(compilePluginClientSource({
      cacheDir: path.join(pluginRoot, '.cache'),
      entryPath,
      pluginRoot,
      scope: 'explicit-root-escape',
      sourceRoot: outerRoot
    })).rejects.toThrow('inside the plugin root')
  })

  it('reports standalone build assets instead of silently dropping them', async () => {
    const pluginRoot = await mkdtemp(path.join(os.tmpdir(), 'ow-plugin-client-source-assets-'))
    temporaryRoots.push(pluginRoot)
    await mkdir(path.join(pluginRoot, 'client'), { recursive: true })
    await writeFile(path.join(pluginRoot, 'client', 'styles.css'), ':root { color: red; }\n')
    await writeFile(
      path.join(pluginRoot, 'client', 'index.ts'),
      "import './styles.css'\nexport function activatePlugin() {}\n"
    )

    await expect(compilePluginClientSource({
      cacheDir: path.join(pluginRoot, '.cache'),
      entryPath: path.join(pluginRoot, 'client', 'index.ts'),
      pluginRoot,
      scope: 'standalone-assets'
    })).rejects.toThrow('Import styles or assets with Vite inline queries')
  })

  it('does not discover or execute plugin PostCSS configuration', async () => {
    const pluginRoot = await mkdtemp(path.join(os.tmpdir(), 'ow-plugin-client-source-postcss-'))
    temporaryRoots.push(pluginRoot)
    const markerPath = path.join(pluginRoot, 'postcss-config-executed')
    await mkdir(path.join(pluginRoot, 'client'), { recursive: true })
    await writeFile(
      path.join(pluginRoot, 'postcss.config.cjs'),
      [
        "const fs = require('node:fs')",
        `fs.writeFileSync(${JSON.stringify(markerPath)}, 'executed')`,
        'module.exports = {}'
      ].join('\n')
    )
    await writeFile(path.join(pluginRoot, 'client', 'styles.css'), ':root { color: red; }\n')
    await writeFile(
      path.join(pluginRoot, 'client', 'index.ts'),
      "import styles from './styles.css?inline'\nexport const compiledStyles = styles\n"
    )

    const compiled = await compilePluginClientSource({
      cacheDir: path.join(pluginRoot, '.cache'),
      entryPath: path.join(pluginRoot, 'client', 'index.ts'),
      pluginRoot,
      scope: 'postcss-config'
    })
    expect(compiled.code).toContain(':root')
    await expect(access(markerPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects static imports into sibling server source', async () => {
    const pluginRoot = await mkdtemp(path.join(os.tmpdir(), 'ow-plugin-client-static-escape-'))
    temporaryRoots.push(pluginRoot)
    await mkdir(path.join(pluginRoot, 'client', 'src'), { recursive: true })
    await mkdir(path.join(pluginRoot, 'server'), { recursive: true })
    await writeFile(
      path.join(pluginRoot, 'server', 'secret.ts'),
      "export const secret = 'STATIC_ESCAPE_MARKER'\n"
    )
    await writeFile(
      path.join(pluginRoot, 'client', 'src', 'index.ts'),
      "import { secret } from '../../server/secret'\nexport const leaked = secret\n"
    )

    await expect(compilePluginClientSource({
      cacheDir: path.join(pluginRoot, '.cache'),
      entryPath: path.join(pluginRoot, 'client', 'src', 'index.ts'),
      pluginRoot,
      scope: 'static-escape'
    })).rejects.toThrow('outside the client source root')
  })

  it('rejects static imports through a source-root symlink escape', async () => {
    const pluginRoot = await mkdtemp(path.join(os.tmpdir(), 'ow-plugin-client-symlink-escape-'))
    temporaryRoots.push(pluginRoot)
    await mkdir(path.join(pluginRoot, 'client', 'src'), { recursive: true })
    await mkdir(path.join(pluginRoot, 'server'), { recursive: true })
    const serverSecretPath = path.join(pluginRoot, 'server', 'secret.ts')
    await writeFile(serverSecretPath, "export const secret = 'SYMLINK_ESCAPE_MARKER'\n")
    await symlink(serverSecretPath, path.join(pluginRoot, 'client', 'src', 'leak.ts'))
    await writeFile(
      path.join(pluginRoot, 'client', 'src', 'index.ts'),
      "import { secret } from './leak'\nexport const leaked = secret\n"
    )

    await expect(compilePluginClientSource({
      cacheDir: path.join(pluginRoot, '.cache'),
      entryPath: path.join(pluginRoot, 'client', 'src', 'index.ts'),
      pluginRoot,
      scope: 'symlink-escape'
    })).rejects.toThrow('outside the client source root')
  })

  it('rejects new URL assets outside the client source root', async () => {
    const outerRoot = await mkdtemp(path.join(os.tmpdir(), 'ow-plugin-client-url-escape-'))
    temporaryRoots.push(outerRoot)
    const pluginRoot = path.join(outerRoot, 'plugin')
    await mkdir(path.join(pluginRoot, 'client', 'src'), { recursive: true })
    await writeFile(path.join(outerRoot, 'outside-secret.txt'), 'OUTSIDE_URL_ESCAPE_MARKER\n')
    await writeFile(
      path.join(pluginRoot, 'client', 'src', 'index.ts'),
      "export const leaked = new URL('../../../outside-secret.txt', import.meta.url).href\n"
    )

    await expect(compilePluginClientSource({
      cacheDir: path.join(pluginRoot, '.cache'),
      entryPath: path.join(pluginRoot, 'client', 'src', 'index.ts'),
      pluginRoot,
      scope: 'url-escape'
    })).rejects.toThrow('outside the client source root')
  })

  it('rejects new URL assets through a source-root symlink escape', async () => {
    const outerRoot = await mkdtemp(path.join(os.tmpdir(), 'ow-plugin-client-url-symlink-'))
    temporaryRoots.push(outerRoot)
    const pluginRoot = path.join(outerRoot, 'plugin')
    const sourceRoot = path.join(pluginRoot, 'client', 'src')
    await mkdir(sourceRoot, { recursive: true })
    const outsideSecretPath = path.join(outerRoot, 'outside-secret.txt')
    await writeFile(outsideSecretPath, 'SYMLINK_URL_ESCAPE_MARKER\n')
    await symlink(outsideSecretPath, path.join(sourceRoot, 'leak.txt'))
    await writeFile(
      path.join(sourceRoot, 'index.ts'),
      "export const leaked = new URL('./leak.txt', import.meta.url).href\n"
    )

    await expect(compilePluginClientSource({
      cacheDir: path.join(pluginRoot, '.cache'),
      entryPath: path.join(sourceRoot, 'index.ts'),
      pluginRoot,
      scope: 'url-symlink-escape'
    })).rejects.toThrow('outside the client source root')
  })

  it('does not treat new URL examples inside comments or strings as assets', async () => {
    const outerRoot = await mkdtemp(path.join(os.tmpdir(), 'ow-plugin-client-url-comment-'))
    temporaryRoots.push(outerRoot)
    const pluginRoot = path.join(outerRoot, 'plugin')
    const sourceRoot = path.join(pluginRoot, 'client', 'src')
    await mkdir(sourceRoot, { recursive: true })
    await writeFile(path.join(outerRoot, 'outside-secret.txt'), 'COMMENT_ONLY_MARKER\n')
    await writeFile(
      path.join(sourceRoot, 'index.ts'),
      [
        "// new URL('../../../outside-secret.txt', import.meta.url)",
        'export const example = "new URL(\'../../../outside-secret.txt\', import.meta.url)"'
      ].join('\n')
    )

    await expect(compilePluginClientSource({
      cacheDir: path.join(pluginRoot, '.cache'),
      entryPath: path.join(sourceRoot, 'index.ts'),
      pluginRoot,
      scope: 'url-comment'
    })).resolves.toMatchObject({
      fileName: 'index.js'
    })
  })

  it('supports plain CSS imports and URL assets inside the client source root', async () => {
    const pluginRoot = await mkdtemp(path.join(os.tmpdir(), 'ow-plugin-client-css-inside-'))
    temporaryRoots.push(pluginRoot)
    const sourceRoot = path.join(pluginRoot, 'client', 'src')
    await mkdir(sourceRoot, { recursive: true })
    await writeFile(path.join(sourceRoot, 'asset.txt'), 'INSIDE_CSS_ASSET_MARKER\n')
    await writeFile(path.join(sourceRoot, 'base.css'), '.base { color: red; }\n')
    await writeFile(
      path.join(sourceRoot, 'styles.css'),
      "@import './base.css';\n.example { background: url('./asset.txt'); }\n"
    )
    await writeFile(
      path.join(sourceRoot, 'index.ts'),
      "import styles from './styles.css?inline'\nexport const compiledStyles = styles\n"
    )

    const compiled = await compilePluginClientSource({
      cacheDir: path.join(pluginRoot, '.cache'),
      entryPath: path.join(sourceRoot, 'index.ts'),
      pluginRoot,
      scope: 'css-inside'
    })
    expect(compiled.code).toContain('.base')
    expect(compiled.code).toContain('SU5TSURFX0NTU19BU1NFVF9NQVJLRVIK')
  })

  it('rejects CSS URL assets outside the client source root', async () => {
    const outerRoot = await mkdtemp(path.join(os.tmpdir(), 'ow-plugin-client-css-url-'))
    temporaryRoots.push(outerRoot)
    const pluginRoot = path.join(outerRoot, 'plugin')
    const sourceRoot = path.join(pluginRoot, 'client', 'src')
    await mkdir(sourceRoot, { recursive: true })
    await writeFile(path.join(outerRoot, 'outside-secret.txt'), 'CSS_URL_ESCAPE_MARKER\n')
    await writeFile(
      path.join(sourceRoot, 'styles.css'),
      ".example { background: url('../../../outside-secret.txt'); }\n"
    )
    await writeFile(
      path.join(sourceRoot, 'index.ts'),
      "import styles from './styles.css?inline'\nexport const leaked = styles\n"
    )

    await expect(compilePluginClientSource({
      cacheDir: path.join(pluginRoot, '.cache'),
      entryPath: path.join(sourceRoot, 'index.ts'),
      pluginRoot,
      scope: 'css-url-escape'
    })).rejects.toThrow('outside the client source root')
  })

  it('rejects CSS imports outside the client source root', async () => {
    const pluginRoot = await mkdtemp(path.join(os.tmpdir(), 'ow-plugin-client-css-import-'))
    temporaryRoots.push(pluginRoot)
    const sourceRoot = path.join(pluginRoot, 'client', 'src')
    await mkdir(sourceRoot, { recursive: true })
    await mkdir(path.join(pluginRoot, 'server'), { recursive: true })
    await writeFile(path.join(pluginRoot, 'server', 'secret.css'), '.secret { color: red; }\n')
    await writeFile(
      path.join(sourceRoot, 'styles.css'),
      "@import '../../server/secret.css';\n.example { color: black; }\n"
    )
    await writeFile(
      path.join(sourceRoot, 'index.ts'),
      "import styles from './styles.css?inline'\nexport const leaked = styles\n"
    )

    await expect(compilePluginClientSource({
      cacheDir: path.join(pluginRoot, '.cache'),
      entryPath: path.join(sourceRoot, 'index.ts'),
      pluginRoot,
      scope: 'css-import-escape'
    })).rejects.toThrow('outside the client source root')
  })

  it('rejects CSS preprocessors before their independent import graph can run', async () => {
    const pluginRoot = await mkdtemp(path.join(os.tmpdir(), 'ow-plugin-client-scss-import-'))
    temporaryRoots.push(pluginRoot)
    const sourceRoot = path.join(pluginRoot, 'client', 'src')
    await mkdir(sourceRoot, { recursive: true })
    await writeFile(path.join(sourceRoot, 'styles.scss'), '.example { color: red; }\n')
    await writeFile(
      path.join(sourceRoot, 'index.ts'),
      "import styles from './styles.scss?inline'\nexport const compiledStyles = styles\n"
    )

    await expect(compilePluginClientSource({
      cacheDir: path.join(pluginRoot, '.cache'),
      entryPath: path.join(sourceRoot, 'index.ts'),
      pluginRoot,
      scope: 'scss-import'
    })).rejects.toThrow('CSS preprocessors are unsupported')
  })
})
