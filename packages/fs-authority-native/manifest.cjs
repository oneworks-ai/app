'use strict'

const { createHash, randomUUID } = require('node:crypto')
const {
  closeSync,
  existsSync,
  fchmodSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync
} = require('node:fs')
const path = require('node:path')
const process = require('node:process')

const ARTIFACTS = Object.freeze({
  'darwin-arm64': Object.freeze({
    architecture: 'arm64',
    path: 'prebuilds/darwin-arm64/fs-authority.node'
  }),
  'darwin-x64': Object.freeze({
    architecture: 'x86_64',
    path: 'prebuilds/darwin-x64/fs-authority.node'
  })
})
const ARTIFACT_TUPLES = Object.freeze(Object.keys(ARTIFACTS))
const MANIFEST_PATH = 'prebuilds/manifest.json'
const NAPI_VERSION = 8
const SCHEMA_VERSION = 1

const fail = message => {
  throw new Error(`Native authority manifest ${message}`)
}

const isContained = (root, target) => {
  const relative = path.relative(root, target)
  return relative !== '' && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)
}

const resolvePackageRoot = packageRoot => {
  const resolved = realpathSync(packageRoot)
  if (!lstatSync(resolved).isDirectory()) fail('package root is invalid')
  return resolved
}

const resolveContainedExistingPath = (packageRoot, relativePath, kind) => {
  const root = resolvePackageRoot(packageRoot)
  const target = path.resolve(root, relativePath)
  if (!isContained(root, target)) fail(`${kind} escapes the package root`)
  const targetStat = lstatSync(target)
  if (targetStat.isSymbolicLink()) fail(`${kind} must not be a symbolic link`)
  const realTarget = realpathSync(target)
  if (!isContained(root, realTarget)) fail(`${kind} escapes the package root`)
  return { root, target, targetStat }
}

const assertExactKeys = (value, expected, label) => {
  if (
    value == null || typeof value !== 'object' || Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())
  ) fail(`${label} is invalid`)
}

const validateArtifactEntry = (tuple, entry) => {
  const artifact = ARTIFACTS[tuple]
  if (artifact == null) fail(`contains unsupported tuple ${tuple}`)
  assertExactKeys(entry, ['path', 'sha256', 'size'], `entry is invalid for ${tuple}`)
  if (
    entry.path !== artifact.path || !Number.isSafeInteger(entry.size) || entry.size <= 0 ||
    !/^[a-f0-9]{64}$/u.test(entry.sha256)
  ) fail(`entry is invalid for ${tuple}`)
  return Object.freeze({ path: entry.path, sha256: entry.sha256, size: entry.size })
}

const normalizeArtifacts = (artifacts, { requireClosed }) => {
  if (artifacts == null || typeof artifacts !== 'object' || Array.isArray(artifacts)) {
    fail('artifacts are invalid')
  }
  const tuples = Object.keys(artifacts).sort()
  if (tuples.some(tuple => ARTIFACTS[tuple] == null)) fail('contains an unsupported artifact')
  if (requireClosed && JSON.stringify(tuples) !== JSON.stringify([...ARTIFACT_TUPLES].sort())) {
    fail('must close over both macOS architectures')
  }
  const normalized = {}
  for (const tuple of ARTIFACT_TUPLES) {
    if (artifacts[tuple] != null) normalized[tuple] = validateArtifactEntry(tuple, artifacts[tuple])
  }
  return Object.freeze(normalized)
}

const serializeNativeAuthorityManifest = (artifacts, options = {}) => {
  const normalized = normalizeArtifacts(artifacts, { requireClosed: options.requireClosed === true })
  return `${
    JSON.stringify({ schemaVersion: SCHEMA_VERSION, napiVersion: NAPI_VERSION, artifacts: normalized }, null, 2)
  }\n`
}

const readNativeAuthorityManifest = (packageRoot, options = {}) => {
  const { target, targetStat } = resolveContainedExistingPath(packageRoot, MANIFEST_PATH, 'file')
  if (!targetStat.isFile()) fail('file is not regular')
  let manifest
  try {
    manifest = JSON.parse(readFileSync(target, 'utf8'))
  } catch {
    fail('JSON is invalid')
  }
  assertExactKeys(manifest, ['artifacts', 'napiVersion', 'schemaVersion'], 'schema')
  if (manifest.schemaVersion !== SCHEMA_VERSION || manifest.napiVersion !== NAPI_VERSION) {
    fail('schema is invalid')
  }
  return Object.freeze({
    artifacts: normalizeArtifacts(manifest.artifacts, { requireClosed: options.requireClosed === true }),
    napiVersion: NAPI_VERSION,
    schemaVersion: SCHEMA_VERSION
  })
}

const resolveNativeAuthorityArtifactPath = (packageRoot, tuple) => {
  const artifact = ARTIFACTS[tuple]
  if (artifact == null) fail(`contains unsupported tuple ${tuple}`)
  const { target, targetStat } = resolveContainedExistingPath(packageRoot, artifact.path, `artifact for ${tuple}`)
  if (!targetStat.isFile()) fail(`artifact is not regular for ${tuple}`)
  return target
}

const createNativeAuthorityArtifactEntry = (packageRoot, tuple) => {
  const artifactPath = resolveNativeAuthorityArtifactPath(packageRoot, tuple)
  const bytes = readFileSync(artifactPath)
  return Object.freeze({
    path: ARTIFACTS[tuple].path,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: bytes.length
  })
}

const writeNativeAuthorityManifest = (packageRoot, artifacts, options = {}) => {
  const root = resolvePackageRoot(packageRoot)
  const prebuildsPath = path.resolve(root, 'prebuilds')
  if (!isContained(root, prebuildsPath)) fail('directory escapes the package root')
  const prebuildsStat = lstatSync(prebuildsPath)
  if (!prebuildsStat.isDirectory() || prebuildsStat.isSymbolicLink()) fail('directory is unsafe')
  if (!isContained(root, realpathSync(prebuildsPath))) fail('directory escapes the package root')

  const manifestPath = path.join(prebuildsPath, 'manifest.json')
  let manifestMode = 0o644
  if (existsSync(manifestPath)) {
    const manifestStat = lstatSync(manifestPath)
    if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) fail('file is unsafe')
    if (!isContained(root, realpathSync(manifestPath))) fail('file escapes the package root')
    manifestMode = manifestStat.mode & 0o777
  }

  const serialized = serializeNativeAuthorityManifest(artifacts, options)
  const temporaryPath = path.join(prebuildsPath, `.manifest-${process.pid}-${randomUUID()}.tmp`)
  let descriptor
  try {
    descriptor = openSync(temporaryPath, 'wx', manifestMode)
    fchmodSync(descriptor, manifestMode)
    writeFileSync(descriptor, serialized)
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    renameSync(temporaryPath, manifestPath)
  } finally {
    if (descriptor != null) closeSync(descriptor)
    rmSync(temporaryPath, { force: true })
  }
  return Object.freeze({ manifestPath, serialized })
}

const refreshNativeAuthorityManifest = packageRoot => {
  readNativeAuthorityManifest(packageRoot, { requireClosed: true })
  const artifacts = {}
  for (const tuple of ARTIFACT_TUPLES) {
    artifacts[tuple] = createNativeAuthorityArtifactEntry(packageRoot, tuple)
  }
  return writeNativeAuthorityManifest(packageRoot, artifacts, { requireClosed: true })
}

module.exports = {
  ARTIFACTS,
  ARTIFACT_TUPLES,
  createNativeAuthorityArtifactEntry,
  readNativeAuthorityManifest,
  refreshNativeAuthorityManifest,
  resolveNativeAuthorityArtifactPath,
  serializeNativeAuthorityManifest,
  writeNativeAuthorityManifest
}
