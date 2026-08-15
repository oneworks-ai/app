'use strict'

const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { afterEach, test } = require('node:test')

const {
  ARTIFACTS,
  createNativeAuthorityArtifactEntry,
  readNativeAuthorityManifest,
  refreshNativeAuthorityManifest,
  serializeNativeAuthorityManifest,
  writeNativeAuthorityManifest
} = require('../manifest.cjs')

const roots = []

const createPackage = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'oneworks-native-manifest-'))
  roots.push(root)
  mkdirSync(path.join(root, 'prebuilds'), { recursive: true })
  for (const [tuple, artifact] of Object.entries(ARTIFACTS)) {
    const artifactPath = path.join(root, artifact.path)
    mkdirSync(path.dirname(artifactPath), { recursive: true })
    writeFileSync(artifactPath, `unsigned-${tuple}`)
  }
  const staleArtifacts = Object.fromEntries(
    Object.entries(ARTIFACTS).map(([tuple, artifact]) => [
      tuple,
      { path: artifact.path, sha256: '0'.repeat(64), size: 1 }
    ])
  )
  writeNativeAuthorityManifest(root, staleArtifacts, { requireClosed: true })
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

test('refreshes the exact two-architecture closure from signed bytes with a canonical atomic write', () => {
  const root = createPackage()
  const manifestPath = path.join(root, 'prebuilds', 'manifest.json')
  const originalInode = lstatSync(manifestPath).ino
  const originalMode = lstatSync(manifestPath).mode & 0o777
  for (const [tuple, artifact] of Object.entries(ARTIFACTS)) {
    writeFileSync(path.join(root, artifact.path), `signed-${tuple}`)
  }

  refreshNativeAuthorityManifest(root)

  const manifest = readNativeAuthorityManifest(root, { requireClosed: true })
  assert.deepEqual(Object.keys(manifest.artifacts), Object.keys(ARTIFACTS))
  for (const [tuple, artifact] of Object.entries(ARTIFACTS)) {
    const bytes = readFileSync(path.join(root, artifact.path))
    assert.deepEqual(manifest.artifacts[tuple], {
      path: artifact.path,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.length
    })
  }
  assert.equal(
    readFileSync(manifestPath, 'utf8'),
    serializeNativeAuthorityManifest(manifest.artifacts, { requireClosed: true })
  )
  assert.notEqual(lstatSync(manifestPath).ino, originalInode)
  assert.equal(lstatSync(manifestPath).mode & 0o777, originalMode)
  assert.deepEqual(readdirSync(path.dirname(manifestPath)).filter(name => name.startsWith('.manifest-')), [])
})

test('fails closed when either required signed artifact is missing', () => {
  const root = createPackage()
  rmSync(path.join(root, ARTIFACTS['darwin-x64'].path))

  assert.throws(() => refreshNativeAuthorityManifest(root))
})

test('fails closed when an artifact is a symbolic link', () => {
  const root = createPackage()
  const artifactPath = path.join(root, ARTIFACTS['darwin-arm64'].path)
  const targetPath = path.join(root, 'signed-native-target')
  rmSync(artifactPath)
  writeFileSync(targetPath, 'signed-arm64')
  symlinkSync(targetPath, artifactPath)

  assert.throws(
    () => createNativeAuthorityArtifactEntry(root, 'darwin-arm64'),
    /must not be a symbolic link/u
  )
})

test('fails closed on malformed or symbolic-link manifest state', () => {
  const malformedRoot = createPackage()
  writeFileSync(path.join(malformedRoot, 'prebuilds', 'manifest.json'), '{malformed')
  assert.throws(() => refreshNativeAuthorityManifest(malformedRoot), /JSON is invalid/u)

  const linkedRoot = createPackage()
  const manifestPath = path.join(linkedRoot, 'prebuilds', 'manifest.json')
  const targetPath = path.join(linkedRoot, 'manifest-target.json')
  rmSync(manifestPath)
  writeFileSync(targetPath, '{}')
  symlinkSync(targetPath, manifestPath)
  assert.throws(() => refreshNativeAuthorityManifest(linkedRoot), /must not be a symbolic link/u)
})
