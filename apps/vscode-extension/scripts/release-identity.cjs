const vscodeExtensionPackageName = '@oneworks/vscode-extension'
const vscodeExtensionReleaseTagPrefix = 'pkg/oneworks-vscode-extension/v'

function isPrereleaseVersion(version) {
  return version.includes('-')
}

function resolveMarketplaceVersion(version) {
  const match = version.match(/^(\d+\.\d+\.\d+)(?:-.+)?$/u)

  if (!match) {
    throw new Error(
      `Invalid VS Code extension version "${version}". Expected major.minor.patch or a prerelease variant.`
    )
  }

  return match[1]
}

function resolveLogicalVersionFromReleaseTag(tag) {
  if (!tag.startsWith(vscodeExtensionReleaseTagPrefix)) {
    throw new Error(
      `VS Code extension release tag "${tag}" must start with ${vscodeExtensionReleaseTagPrefix}.`
    )
  }

  const logicalVersion = tag.slice(vscodeExtensionReleaseTagPrefix.length)
  resolveMarketplaceVersion(logicalVersion)
  return logicalVersion
}

function assertVscodeStoreVersionAvailable(candidateTag, existingTags, options = {}) {
  const logicalVersion = resolveLogicalVersionFromReleaseTag(candidateTag)
  const storeVersion = resolveMarketplaceVersion(logicalVersion)
  const identity = {
    logicalVersion,
    prerelease: isPrereleaseVersion(logicalVersion),
    storeVersion,
    tag: candidateTag
  }

  const recoveryEvidence = options.recoveryEvidence === true
  if (recoveryEvidence && existingTags.includes(candidateTag)) {
    return identity
  }

  const priorReleases = existingTags
    .filter(tag => tag !== candidateTag && tag.startsWith(vscodeExtensionReleaseTagPrefix))
    .map((tag) => {
      const priorLogicalVersion = resolveLogicalVersionFromReleaseTag(tag)
      return {
        logicalVersion: priorLogicalVersion,
        storeVersion: resolveMarketplaceVersion(priorLogicalVersion),
        tag
      }
    })

  const collision = priorReleases.find(release => release.storeVersion === storeVersion)
  if (collision != null) {
    throw new Error(
      `VS Code store version ${storeVersion} for ${candidateTag} is already owned by ${collision.tag}. ` +
        'Use a new numeric major.minor.patch base for the next logical prerelease.'
    )
  }

  if (isPrereleaseVersion(logicalVersion)) {
    const newestPriorRelease = priorReleases.reduce((newest, release) => (
      newest == null || compareNumericVersions(release.storeVersion, newest.storeVersion) > 0
        ? release
        : newest
    ), null)

    if (
      newestPriorRelease != null &&
      compareNumericVersions(storeVersion, newestPriorRelease.storeVersion) <= 0
    ) {
      throw new Error(
        `VS Code store version ${storeVersion} for ${candidateTag} must be newer than ` +
          `${newestPriorRelease.storeVersion} from ${newestPriorRelease.tag}.`
      )
    }
  }

  return identity
}

function resolvePersistedVsixCandidateAction(input) {
  if (input.release == null) return 'create'

  const release = input.release
  if (release.tagName !== input.tag) {
    throw new Error(
      `Existing GitHub Release tag ${String(release.tagName)} does not match ${input.tag}.`
    )
  }
  if (release.isDraft !== false) {
    throw new Error(`Existing GitHub Release ${input.tag} must not be a draft.`)
  }

  const expectedPrerelease = isPrereleaseVersion(input.logicalVersion)
  if (release.isPrerelease !== expectedPrerelease) {
    throw new Error(
      `Existing GitHub Release ${input.tag} prerelease=${String(release.isPrerelease)} ` +
        `does not match logical version ${input.logicalVersion}.`
    )
  }

  const matchingAssets = Array.isArray(release.assets)
    ? release.assets.filter(asset => asset?.name === input.archiveFile)
    : []
  if (matchingAssets.length > 1) {
    throw new Error(
      `Existing GitHub Release ${input.tag} has multiple ${input.archiveFile} assets.`
    )
  }

  return matchingAssets.length === 1 ? 'reuse' : 'upload'
}

function compareNumericVersions(left, right) {
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)

  for (let index = 0; index < 3; index += 1) {
    const difference = leftParts[index] - rightParts[index]
    if (difference !== 0) return difference
  }

  return 0
}

exports.assertVscodeStoreVersionAvailable = assertVscodeStoreVersionAvailable
exports.isPrereleaseVersion = isPrereleaseVersion
exports.resolveLogicalVersionFromReleaseTag = resolveLogicalVersionFromReleaseTag
exports.resolveMarketplaceVersion = resolveMarketplaceVersion
exports.resolvePersistedVsixCandidateAction = resolvePersistedVsixCandidateAction
exports.vscodeExtensionPackageName = vscodeExtensionPackageName
exports.vscodeExtensionReleaseTagPrefix = vscodeExtensionReleaseTagPrefix
