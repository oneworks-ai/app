const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { createRequire } = require('node:module')
const {
  existsSync,
  mkdtempSync,
  mkdirSync,
  renameSync,
  rmSync
} = require('node:fs')
const { tmpdir } = require('node:os')
const { dirname, join, resolve } = require('node:path')

// This deliberately exercises only the packaged app-build-info subpath through
// preview-runtime; it does not validate @oneworks/types root exports or the CLI.
const clientDir = dirname(__dirname)
const typesDir = resolve(clientDir, '../../packages/types')
const testRoot = mkdtempSync(join(tmpdir(), 'oneworks-client-packed-preview-runtime-'))
const clientPackDir = join(testRoot, 'client-pack')
const installDir = join(testRoot, 'install')
const typesPackDir = join(testRoot, 'types-pack')
const modulesDir = join(installDir, 'node_modules', '@oneworks')
process.env.npm_config_offline = 'true'

const readPackedFilename = (output) => {
  const parsed = JSON.parse(output)
  const result = Array.isArray(parsed) ? parsed[0] : parsed
  assert.equal(typeof result?.filename, 'string', 'pnpm pack must report a tarball filename')
  return result.filename
}

const run = async () => {
  mkdirSync(clientPackDir)
  mkdirSync(installDir)
  mkdirSync(typesPackDir)
  const typesPackOutput = execFileSync(
    'pnpm',
    ['pack', '--json', '--pack-destination', typesPackDir],
    { cwd: typesDir, encoding: 'utf8' }
  )
  const typesTarballPath = resolve(typesPackDir, readPackedFilename(typesPackOutput))
  assert.ok(existsSync(typesTarballPath), 'pnpm pack must create the current Types tarball')

  const clientPackOutput = execFileSync(
    'pnpm',
    ['pack', '--json', '--pack-destination', clientPackDir],
    { cwd: clientDir, encoding: 'utf8' }
  )
  const clientTarballPath = resolve(clientPackDir, readPackedFilename(clientPackOutput))
  assert.ok(existsSync(clientTarballPath), 'pnpm pack must create the Client tarball')

  mkdirSync(modulesDir, { recursive: true })
  for (const [tarballPath, packageName] of [
    [typesTarballPath, 'types'],
    [clientTarballPath, 'client']
  ]) {
    execFileSync('tar', ['-xzf', tarballPath], { cwd: modulesDir })
    renameSync(join(modulesDir, 'package'), join(modulesDir, packageName))
  }
  assert.ok(
    existsSync(join(modulesDir, 'types', 'src', 'app-build-info-runtime.js')),
    'offline extraction must resolve the current Types runtime artifact'
  )
  assert.equal(existsSync(join(installDir, 'node_modules', 'vite')), false)
  assert.equal(process.env.npm_config_offline, 'true', 'preview-runtime fixture must declare offline mode')

  const previewRequire = createRequire(join(modulesDir, 'client', 'preview-runtime.cjs'))
  const { parseAppBuildInfoJson } = previewRequire('@oneworks/types/app-build-info')
  assert.equal(parseAppBuildInfoJson('{"version":"2.3.4"}').version, '2.3.4')
  const { createRuntimeScript } = require(join(modulesDir, 'client', 'preview-runtime.cjs'))
  const html = createRuntimeScript('/ui/', {
    __ONEWORKS_PROJECT_CLIENT_COMMIT_HASH__: 'abcdef0123456789abcdef0123456789abcdef01',
    __ONEWORKS_PROJECT_CLIENT_VERSION__: '2.3.4'
  })
  assert.match(html, /__ONEWORKS_PROJECT_CLIENT_BUILD_INFO_JSON__/u)
  assert.match(html, /abcdef0123456789abcdef0123456789abcdef01/u)
}

run().finally(() => {
  rmSync(testRoot, { force: true, recursive: true })
}).catch((error) => {
  console.error(error)
  process.exitCode = 1
})
