export interface VscodeStoreVersionIdentity {
  logicalVersion: string
  prerelease: boolean
  storeVersion: string
  tag: string
}

export interface PersistedVsixReleaseSnapshot {
  assets?: Array<{ name?: unknown }>
  isDraft?: unknown
  isPrerelease?: unknown
  tagName?: unknown
}

export type PersistedVsixCandidateAction = 'create' | 'reuse' | 'upload'

export const vscodeExtensionPackageName: '@oneworks/vscode-extension'
export const vscodeExtensionReleaseTagPrefix: 'pkg/oneworks-vscode-extension/v'

export function assertVscodeStoreVersionAvailable(
  candidateTag: string,
  existingTags: readonly string[],
  options?: {
    recoveryEvidence?: boolean
  }
): VscodeStoreVersionIdentity

export function isPrereleaseVersion(version: string): boolean
export function resolveLogicalVersionFromReleaseTag(tag: string): string
export function resolveMarketplaceVersion(version: string): string
export function resolvePersistedVsixCandidateAction(input: {
  archiveFile: string
  logicalVersion: string
  release: null | PersistedVsixReleaseSnapshot
  tag: string
}): PersistedVsixCandidateAction
