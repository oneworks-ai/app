import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'

if (process.platform !== 'darwin') {
  throw new Error('Filesystem authority native builds are macOS-only')
}

const packageRoot = dirname(dirname(import.meta.filename))
const requestedArch = process.argv.includes('--arch')
  ? process.argv[process.argv.indexOf('--arch') + 1]
  : process.arch
if (requestedArch !== 'arm64' && requestedArch !== 'x64') {
  throw new Error(`Unsupported macOS architecture: ${requestedArch}`)
}
const tuple = `darwin-${requestedArch}`
const nodePrefix = dirname(dirname(realpathSync(process.execPath)))
const nodeInclude = join(nodePrefix, 'include', 'node')
if (!existsSync(join(nodeInclude, 'node_api.h'))) throw new Error(`Node headers are unavailable at ${nodeInclude}`)
const buildDirectory = join(packageRoot, 'build', tuple)
mkdirSync(buildDirectory, { recursive: true })
const run = args => {
  const result = spawnSync('cmake', args, { cwd: packageRoot, stdio: 'inherit' })
  if (result.error != null) throw result.error
  if (result.status !== 0) throw new Error(`cmake failed with status ${result.status}`)
}
run([
  '-S',
  packageRoot,
  '-B',
  buildDirectory,
  '-DCMAKE_BUILD_TYPE=Release',
  `-DNODE_INCLUDE_DIR=${nodeInclude}`,
  `-DCMAKE_OSX_ARCHITECTURES=${requestedArch === 'x64' ? 'x86_64' : 'arm64'}`
])
run(['--build', buildDirectory, '--config', 'Release', '--parallel'])
const built = [join(buildDirectory, 'fs-authority.node'), join(buildDirectory, 'Release', 'fs-authority.node')].find(
  existsSync
)
if (built == null) throw new Error('Native build did not produce fs-authority.node')
const relativePath = `prebuilds/${tuple}/fs-authority.node`
const destination = join(packageRoot, relativePath)
mkdirSync(dirname(destination), { recursive: true })
cpSync(built, destination)
const bytes = readFileSync(destination)
const manifestPath = join(packageRoot, 'prebuilds/manifest.json')
let artifacts = {}
if (existsSync(manifestPath)) {
  const existing = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (existing?.schemaVersion !== 1 || existing?.napiVersion !== 8 || existing?.artifacts == null) {
    throw new Error('Existing native authority manifest is invalid')
  }
  artifacts = existing.artifacts
}
artifacts[tuple] = {
  path: relativePath,
  size: statSync(destination).size,
  sha256: createHash('sha256').update(bytes).digest('hex')
}
writeFileSync(
  manifestPath,
  `${
    JSON.stringify(
      {
        schemaVersion: 1,
        napiVersion: 8,
        artifacts
      },
      null,
      2
    )
  }\n`
)
process.stdout.write(`Built ${tuple}: ${destination}\n`)
