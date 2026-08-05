export interface StableNpmSelectionInput {
  allNames: string[]
  bootstrapWithToken: boolean
  dryRun: boolean
  expectedRecoveryNames: string[]
  expectedRef: string
  githubRef: string
  missingNames: string[]
  publishAll: boolean
  publishedNames: string[]
  requestedNames: string[]
  selectedNames: string[]
}

export interface RegistryPlanItem {
  name: string
  version: string
}

export interface RegistryMetadataEvaluation {
  mismatches: string[]
  records: Array<{
    dist: { integrity: string; shasum: string; tarball: string }
    name: string
    version: string
  }>
}

export function evaluateStableNpmSelection(input: StableNpmSelectionInput): string[]
export function evaluateRegistryMetadata(
  items: RegistryPlanItem[],
  metadataByName: Map<string, unknown>
): RegistryMetadataEvaluation
export function verifyTarballBytes(
  bytes: Uint8Array,
  dist: { integrity: string; shasum: string }
): {
  integrity: string
  integrityMatches: boolean
  shasum: string
  shasumMatches: boolean
}
