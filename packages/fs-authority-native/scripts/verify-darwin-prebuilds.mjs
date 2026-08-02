import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(resolve(root, 'prebuilds/manifest.json'), 'utf8'))
const expected = Object.freeze({
  'darwin-arm64': 'arm64',
  'darwin-x64': 'x86_64'
})
if (manifest?.schemaVersion !== 1 || manifest?.napiVersion !== 8) {
  throw new Error('Native authority manifest schema is invalid')
}
if (JSON.stringify(Object.keys(manifest.artifacts ?? {}).sort()) !== JSON.stringify(Object.keys(expected).sort())) {
  throw new Error('Native authority manifest must close over both macOS architectures')
}
for (const [tuple, architecture] of Object.entries(expected)) {
  const entry = manifest.artifacts[tuple]
  const path = `prebuilds/${tuple}/fs-authority.node`
  if (
    entry?.path !== path || !Number.isSafeInteger(entry.size) || entry.size <= 0 ||
    !/^[a-f0-9]{64}$/u.test(entry.sha256)
  ) {
    throw new Error(`Native authority manifest entry is invalid for ${tuple}`)
  }
  const artifact = resolve(root, path)
  const stat = lstatSync(artifact)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== entry.size) {
    throw new Error(`Native authority artifact is unsafe for ${tuple}`)
  }
  const bytes = readFileSync(artifact)
  if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
    throw new Error(`Native authority artifact hash mismatch for ${tuple}`)
  }
  const binaryArchitectures = execFileSync('lipo', ['-archs', artifact], { encoding: 'utf8' }).trim().split(/\s+/u)
  if (!binaryArchitectures.includes(architecture)) {
    throw new Error(`Native authority artifact architecture mismatch for ${tuple}`)
  }
}
process.stdout.write('Verified macOS arm64/x64 native authority prebuild closure\n')
