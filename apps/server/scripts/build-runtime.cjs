const fs = require('node:fs')
const path = require('node:path')
const process = require('node:process')

const { build } = require('esbuild')

const serverRoot = path.resolve(__dirname, '..')
const workspaceRoot = path.resolve(serverRoot, '../..')
const defaultRuntimeOutfile = path.join(serverRoot, 'dist/__INTERNAL__home/index.mjs')
const serverPackage = require(path.join(serverRoot, 'package.json'))
const requireResolveRuntimeExternals = ['node-gyp/bin/node-gyp.js']
const packageOwnedAssetExternals = ['@oneworks/fs-authority-native']
const esmRuntimeBanner = [
  'import { createRequire as __oneworksCreateRequire } from "node:module";',
  'import { dirname as __oneworksDirname } from "node:path";',
  'import { fileURLToPath as __oneworksFileURLToPath } from "node:url";',
  'const require = __oneworksCreateRequire(import.meta.url);',
  'const __filename = __oneworksFileURLToPath(import.meta.url);',
  'const __dirname = __oneworksDirname(__filename);'
].join(' ')

const resolveExternalRuntimePackages = () => (
  Object.keys(serverPackage.dependencies ?? {})
    .filter(packageName => (
      !packageName.startsWith('@oneworks/') || packageOwnedAssetExternals.includes(packageName)
    ))
    .sort()
)

const buildServerRuntimeBundle = async ({
  outfile = defaultRuntimeOutfile
} = {}) => {
  const externalRuntimePackages = resolveExternalRuntimePackages()
  const outdir = path.dirname(outfile)
  const entryName = path.basename(outfile, path.extname(outfile))
  const outputExtension = path.extname(outfile) || '.mjs'
  if (path.resolve(outfile) === path.resolve(defaultRuntimeOutfile)) {
    fs.rmSync(outdir, { force: true, recursive: true })
  }
  fs.mkdirSync(outdir, { recursive: true })
  return await build({
    absWorkingDir: workspaceRoot,
    banner: { js: esmRuntimeBanner },
    bundle: true,
    chunkNames: 'chunks/[name]-[hash]',
    conditions: ['__oneworks__'],
    entryNames: '[name]',
    entryPoints: { [entryName]: path.join(serverRoot, 'src/index.ts') },
    external: [
      ...externalRuntimePackages.flatMap(packageName => [packageName, `${packageName}/*`]),
      ...requireResolveRuntimeExternals
    ],
    format: 'esm',
    logLevel: 'warning',
    metafile: true,
    minifySyntax: true,
    minifyWhitespace: true,
    outdir,
    outExtension: { '.js': outputExtension },
    platform: 'node',
    sourcemap: 'linked',
    sourcesContent: false,
    splitting: true,
    target: 'node22'
  })
}

module.exports = {
  buildServerRuntimeBundle,
  resolveExternalRuntimePackages
}

if (require.main === module) {
  buildServerRuntimeBundle()
    .then(result => {
      const outputPath = Object.keys(result.metafile.outputs)
        .find(candidate => candidate.endsWith(`${path.sep}index.mjs`)) ??
        defaultRuntimeOutfile
      process.stdout.write(`[oneworks-server] runtime bundle ready: ${outputPath}\n`)
    })
    .catch(error => {
      console.error(error)
      process.exitCode = 1
    })
}
