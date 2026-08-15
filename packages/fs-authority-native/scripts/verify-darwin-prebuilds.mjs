import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const {
  ARTIFACTS,
  createNativeAuthorityArtifactEntry,
  readNativeAuthorityManifest,
  resolveNativeAuthorityArtifactPath
} = require('../manifest.cjs')

const suppliedRoot = process.argv[2]?.trim()
const root = suppliedRoot == null || suppliedRoot === ''
  ? resolve(dirname(fileURLToPath(import.meta.url)), '..')
  : resolve(suppliedRoot)
if (suppliedRoot != null && suppliedRoot !== '') {
  const loader = lstatSync(resolve(root, 'loader.cjs'))
  if (!loader.isFile() || loader.isSymbolicLink()) {
    throw new Error('Packaged native authority loader is unsafe')
  }
  if (existsSync(resolve(root, 'build'))) {
    throw new Error('Packaged native authority contains build intermediates')
  }
}
const manifest = readNativeAuthorityManifest(root, { requireClosed: true })
for (const [tuple, artifactDefinition] of Object.entries(ARTIFACTS)) {
  const entry = manifest.artifacts[tuple]
  const actualEntry = createNativeAuthorityArtifactEntry(root, tuple)
  if (JSON.stringify(entry) !== JSON.stringify(actualEntry)) {
    throw new Error(`Native authority artifact hash mismatch for ${tuple}`)
  }
  const artifact = resolveNativeAuthorityArtifactPath(root, tuple)
  const binaryArchitectures = execFileSync('lipo', ['-archs', artifact], { encoding: 'utf8' }).trim().split(/\s+/u)
  if (!binaryArchitectures.includes(artifactDefinition.architecture)) {
    throw new Error(`Native authority artifact architecture mismatch for ${tuple}`)
  }
}
process.stdout.write('Verified macOS arm64/x64 native authority prebuild closure\n')
