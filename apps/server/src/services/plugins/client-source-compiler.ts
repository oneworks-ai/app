import { Buffer } from 'node:buffer'
import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'

import { createClientSourceBoundaryPlugin } from './client-source-boundary.js'
import { isPathInside } from './client-source-paths.js'

export interface CompiledPluginClientSource {
  code: string
  fileName: string
  size: number
}

interface CompilePluginClientSourceOptions {
  cacheDir: string
  entryPath: string
  pluginRoot: string
  scope: string
}

const MAX_COMPILED_PLUGIN_CLIENT_SOURCE_BYTES = 16 * 1024 * 1024

const resolveSourceEntry = async (pluginRoot: string, entryPath: string) => {
  const absoluteEntry = path.resolve(pluginRoot, entryPath)
  const [realPluginRoot, realEntry] = await Promise.all([
    realpath(pluginRoot),
    realpath(absoluteEntry)
  ])
  const entryStat = await stat(realEntry)
  if (!entryStat.isFile() || !isPathInside(realPluginRoot, realEntry)) {
    throw new Error('Client source entry must be a file inside the plugin root.')
  }
  return {
    entryPath: realEntry,
    pluginRoot: realPluginRoot,
    sourceRoot: path.dirname(realEntry)
  }
}

export const compilePluginClientSource = async ({
  cacheDir,
  entryPath,
  pluginRoot,
  scope
}: CompilePluginClientSourceOptions): Promise<CompiledPluginClientSource> => {
  const source = await resolveSourceEntry(pluginRoot, entryPath)
  const { build } = await import('vite')
  const result = await build({
    appType: 'custom',
    cacheDir,
    configFile: false,
    css: {
      postcss: {}
    },
    define: {
      'import.meta.env.DEV': 'true',
      'import.meta.env.PROD': 'false'
    },
    envFile: false,
    logLevel: 'silent',
    plugins: [createClientSourceBoundaryPlugin(source)],
    publicDir: false,
    root: source.pluginRoot,
    build: {
      assetsInlineLimit: Number.MAX_SAFE_INTEGER,
      copyPublicDir: false,
      cssCodeSplit: false,
      emptyOutDir: false,
      lib: {
        entry: source.entryPath,
        fileName: () => 'index.js',
        formats: ['es']
      },
      minify: false,
      modulePreload: false,
      reportCompressedSize: false,
      sourcemap: 'inline',
      target: 'es2022',
      write: false,
      rollupOptions: {
        output: {
          inlineDynamicImports: true
        }
      }
    }
  })
  const outputs = (Array.isArray(result) ? result : [result]).flatMap(output => (
    'output' in output ? output.output : []
  ))
  const chunks = outputs.filter(output => output.type === 'chunk')
  const emittedAssets = outputs.filter(output => output.type === 'asset')
  if (chunks.length !== 1) {
    throw new Error(`Plugin "${scope}" client source compilation did not produce one executable module.`)
  }
  if (emittedAssets.length > 0) {
    const names = emittedAssets.map(asset => asset.fileName).join(', ')
    throw new Error(
      `Plugin "${scope}" client source emitted unsupported standalone assets (${names}). ` +
        'Import styles or assets with Vite inline queries such as "?inline".'
    )
  }
  const code = chunks[0]!.code
  const size = Buffer.byteLength(code)
  if (size > MAX_COMPILED_PLUGIN_CLIENT_SOURCE_BYTES) {
    throw new Error(
      `Plugin "${scope}" client source exceeded the ${MAX_COMPILED_PLUGIN_CLIENT_SOURCE_BYTES} byte compiled module limit.`
    )
  }
  return {
    code,
    fileName: 'index.js',
    size
  }
}
