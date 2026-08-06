/* eslint-disable max-lines -- candidate creation and promotion verification share one auditable release contract. */
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const MANIFEST_FILE_NAME = 'oneworks-desktop-release-candidate.json'
const RELEASE_TAG_PREFIX = 'pkg/oneworks-desktop/v'
const RELEASE_VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$/
const SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/i
const ALLOWED_ARCHITECTURES = new Set(['arm64', 'x64'])
const ALLOWED_TARGETS = new Set(['dmg', 'pkg', 'zip'])
const UPDATE_CHANNELS = new Set(['stable', 'alpha', 'beta', 'rc'])

const normalizeDeclaredList = (items, allowedValues, name) => {
  if (!Array.isArray(items) || items.length === 0 || items.some(item => typeof item !== 'string' || !item)) {
    throw new TypeError(`${name} must contain at least one string value.`)
  }
  if (new Set(items).size !== items.length) {
    throw new Error(`${name} must not contain duplicate values.`)
  }
  const unsupported = items.filter(item => !allowedValues.has(item))
  if (unsupported.length > 0) {
    throw new Error(`Unsupported ${name}: ${unsupported.join(', ')}.`)
  }
  return items
}

const parseCsv = (value, allowedValues, name) => {
  const items = String(value ?? '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
  return normalizeDeclaredList(items, allowedValues, name)
}

const resolveReleaseIdentity = tag => {
  if (!tag.startsWith(RELEASE_TAG_PREFIX)) {
    throw new Error(`Desktop release tags must start with ${RELEASE_TAG_PREFIX}.`)
  }

  const version = tag.slice(RELEASE_TAG_PREFIX.length)
  if (!RELEASE_VERSION_PATTERN.test(version)) {
    throw new Error(
      `Desktop release tag must look like ${RELEASE_TAG_PREFIX}1.2.3 or ${RELEASE_TAG_PREFIX}1.2.3-beta.1.`
    )
  }

  const updateChannel = /^\d+\.\d+\.\d+-([0-9A-Za-z]+)(?:[.-].*)?$/u.exec(version)?.[1] ?? 'stable'
  if (!UPDATE_CHANNELS.has(updateChannel)) {
    throw new Error('Desktop prerelease channel must be alpha, beta, or rc.')
  }

  return { tag, updateChannel, version }
}

const listArtifactPaths = (artifactDirectory) => {
  const visit = (directory) =>
    fs.readdirSync(directory, { withFileTypes: true })
      .flatMap(entry => {
        const absolutePath = path.join(directory, entry.name)
        if (entry.isDirectory()) return visit(absolutePath)
        if (!entry.isFile()) return []
        return [absolutePath]
      })

  return visit(artifactDirectory)
    .filter(filePath => path.basename(filePath) !== MANIFEST_FILE_NAME)
    .sort()
}

const describeArtifact = (artifactDirectory, filePath) => ({
  name: path.relative(artifactDirectory, filePath).split(path.sep).join('/'),
  sha256: crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'),
  size: fs.statSync(filePath).size
})

const primaryArtifactNames = ({ architectures, targets, version }) =>
  architectures.flatMap(architecture => targets.map(target => `oneworks-${version}-mac-${architecture}.${target}`))
    .sort()

const assertArtifactMatrix = ({ architectures, artifacts, targets, version }) => {
  const expectedNames = primaryArtifactNames({ architectures, targets, version })
  const actualNames = artifacts
    .map(artifact => artifact.name)
    .filter(name => /^oneworks-.+-mac-(arm64|x64)\.(dmg|pkg|zip)$/u.test(name))
    .sort()
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new Error(
      `Desktop release candidate installer matrix mismatch. Expected: ${expectedNames.join(', ')}. Found: ${
        actualNames.join(', ')
      }.`
    )
  }
}

const assertExpectedSet = (actual, expectedCsv, allowedValues, name) => {
  if (!expectedCsv) return
  const expected = parseCsv(expectedCsv, allowedValues, `expected ${name}`).sort()
  if (JSON.stringify([...actual].sort()) !== JSON.stringify(expected)) {
    throw new Error(`Desktop release candidate ${name} do not match the promotion policy.`)
  }
}

const createCandidateManifest = ({
  adHocSealed,
  architectures,
  artifactDirectory,
  builderSha,
  createdAt,
  signed,
  sourceSha,
  tag,
  targets
}) => {
  const release = resolveReleaseIdentity(tag)
  if (!SOURCE_SHA_PATTERN.test(sourceSha)) {
    throw new Error('Desktop release candidate source SHA must be a 40-character Git commit SHA.')
  }
  if (!SOURCE_SHA_PATTERN.test(builderSha)) {
    throw new Error('Desktop release candidate builder SHA must be a 40-character Git commit SHA.')
  }
  if (typeof adHocSealed !== 'boolean' || adHocSealed === signed) {
    throw new Error('Desktop release candidates must be either Developer ID signed or ad-hoc sealed.')
  }
  if (Number.isNaN(Date.parse(createdAt))) {
    throw new TypeError('Desktop release candidate createdAt must be an ISO timestamp.')
  }

  const declaredArchitectures = parseCsv(architectures, ALLOWED_ARCHITECTURES, 'architectures')
  const declaredTargets = parseCsv(targets, ALLOWED_TARGETS, 'targets')
  const artifacts = listArtifactPaths(artifactDirectory)
    .map(filePath => describeArtifact(artifactDirectory, filePath))
  if (artifacts.length === 0) {
    throw new Error('Desktop release candidate contains no artifacts.')
  }
  assertArtifactMatrix({
    architectures: declaredArchitectures,
    artifacts,
    targets: declaredTargets,
    version: release.version
  })

  const manifest = {
    schemaVersion: 2,
    ...release,
    sourceSha: sourceSha.toLowerCase(),
    builderSha: builderSha.toLowerCase(),
    createdAt,
    signed,
    adHocSealed,
    architectures: declaredArchitectures,
    targets: declaredTargets,
    artifacts
  }
  fs.writeFileSync(
    path.join(artifactDirectory, MANIFEST_FILE_NAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  )
  return manifest
}

const readCandidateManifest = artifactDirectory => {
  const manifestPath = path.join(artifactDirectory, MANIFEST_FILE_NAME)
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Desktop release candidate manifest was not found at ${manifestPath}.`)
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  if (manifest?.schemaVersion !== 1 && manifest?.schemaVersion !== 2) {
    throw new Error(`Unsupported desktop release candidate schema: ${manifest?.schemaVersion}.`)
  }
  return manifest
}

const verifyCandidateManifest = ({
  artifactDirectory,
  expectedArchitectures,
  expectedTag,
  expectedTargets
}) => {
  const manifest = readCandidateManifest(artifactDirectory)
  const release = resolveReleaseIdentity(expectedTag)
  if (
    manifest.tag !== expectedTag || manifest.version !== release.version ||
    manifest.updateChannel !== release.updateChannel
  ) {
    throw new Error(`Desktop release candidate tag mismatch: expected ${expectedTag}, found ${manifest.tag}.`)
  }
  if (!SOURCE_SHA_PATTERN.test(manifest.sourceSha)) {
    throw new Error('Desktop release candidate manifest contains an invalid source SHA.')
  }
  if (typeof manifest.signed !== 'boolean') {
    throw new TypeError('Desktop release candidate manifest contains an invalid signed value.')
  }
  if (manifest.schemaVersion === 2) {
    if (!SOURCE_SHA_PATTERN.test(manifest.builderSha)) {
      throw new Error('Desktop release candidate manifest contains an invalid builder SHA.')
    }
    if (typeof manifest.adHocSealed !== 'boolean' || manifest.adHocSealed === manifest.signed) {
      throw new Error('Desktop release candidate manifest has an invalid signing mode.')
    }
  }
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
    throw new Error('Desktop release candidate manifest contains no artifact records.')
  }

  const architectures = normalizeDeclaredList(
    manifest.architectures,
    ALLOWED_ARCHITECTURES,
    'architectures'
  )
  const targets = normalizeDeclaredList(manifest.targets, ALLOWED_TARGETS, 'targets')
  assertExpectedSet(architectures, expectedArchitectures, ALLOWED_ARCHITECTURES, 'architectures')
  assertExpectedSet(targets, expectedTargets, ALLOWED_TARGETS, 'targets')
  const actualArtifacts = listArtifactPaths(artifactDirectory)
    .map(filePath => describeArtifact(artifactDirectory, filePath))
  if (JSON.stringify(actualArtifacts) !== JSON.stringify(manifest.artifacts)) {
    throw new Error('Desktop release candidate artifact inventory or SHA-256 digest does not match the manifest.')
  }
  assertArtifactMatrix({
    architectures,
    artifacts: actualArtifacts,
    targets,
    version: release.version
  })

  return manifest
}

const writeOutputs = (outputPath, manifest) => {
  if (!outputPath) return
  fs.appendFileSync(
    outputPath,
    `${
      [
        `signed=${manifest.signed}`,
        `ad_hoc_sealed=${manifest.adHocSealed === true}`,
        `builder_sha=${manifest.builderSha ?? manifest.sourceSha}`,
        `source_sha=${manifest.sourceSha}`,
        `tag=${manifest.tag}`,
        `update_channel=${manifest.updateChannel}`,
        `version=${manifest.version}`
      ].join('\n')
    }\n`,
    'utf8'
  )
}

const runCli = () => {
  const [command, requestedDirectory] = process.argv.slice(2)
  const artifactDirectory = path.resolve(requestedDirectory ?? 'apps/desktop/release')
  if (command === 'create') {
    const manifest = createCandidateManifest({
      adHocSealed: /^(1|true|yes|on)$/i.test(process.env.ONEWORKS_DESKTOP_AD_HOC_SEALED ?? ''),
      architectures: process.env.ONEWORKS_DESKTOP_ARCHS,
      artifactDirectory,
      builderSha: process.env.ONEWORKS_DESKTOP_BUILDER_GIT_HASH ?? '',
      createdAt: process.env.ONEWORKS_DESKTOP_BUILD_TIME,
      signed: /^(1|true|yes|on)$/i.test(process.env.ONEWORKS_DESKTOP_SIGN ?? ''),
      sourceSha: process.env.ONEWORKS_DESKTOP_BUILD_GIT_HASH ?? '',
      tag: process.env.ONEWORKS_DESKTOP_RELEASE_TAG ?? '',
      targets: process.env.ONEWORKS_DESKTOP_MAKE_TARGETS
    })
    console.log(`Created ${MANIFEST_FILE_NAME} with ${manifest.artifacts.length} artifact digest(s).`)
    return
  }
  if (command === 'verify') {
    const manifest = verifyCandidateManifest({
      artifactDirectory,
      expectedArchitectures: process.env.ONEWORKS_DESKTOP_EXPECTED_ARCHS,
      expectedTag: process.env.ONEWORKS_DESKTOP_RELEASE_TAG ?? '',
      expectedTargets: process.env.ONEWORKS_DESKTOP_EXPECTED_MAKE_TARGETS
    })
    writeOutputs(process.env.GITHUB_OUTPUT, manifest)
    console.log(`Verified ${MANIFEST_FILE_NAME} for ${manifest.tag} at ${manifest.sourceSha}.`)
    return
  }
  throw new Error('Usage: node release-candidate-manifest.cjs <create|verify> [artifact-directory]')
}

if (require.main === module) {
  runCli()
}

module.exports = {
  MANIFEST_FILE_NAME,
  createCandidateManifest,
  resolveReleaseIdentity,
  verifyCandidateManifest
}
