export declare function resolvePnpmCommand(platform?: string): string
export declare function shouldBuildStableWindowsAsset(packages: string, publishAll: string): boolean
export declare function assertStableVersion(version: string): string
export declare function buildWindowsAssetNames(version: string): {
  archiveName: string
  checksumName: string
  releaseTag: string
}
export declare const STABLE_WINDOWS_MSI_UPGRADE_CODE: string
export declare function assertStableWindowsMsiVersion(version: string): string
export declare function buildStableWindowsMsiProductCode(version: string): string
export declare function buildStableWindowsMsiAssetNames(version: string): {
  checksumName: string
  installerName: string
  provenanceName: string
  releaseTag: string
}
export declare function buildStableWindowsMsiWxs(input: {
  payloadDir: string
  productSourceSha: string
  version: string
}): string
export declare function buildStableWindowsMsiProvenance(input: {
  builderWorkflowSha: string
  installerName: string
  installerSha256: string
  launchers: Record<string, string>
  productSourceSha: string
  releaseTag: string
  version: string
}): {
  builderWorkflowSha: string
  installer: { name: string; sha256: string }
  launchers: Record<string, string>
  productCode: string
  productSourceSha: string
  releaseTag: string
  schemaVersion: number
  version: string
}
export declare function assertStableWindowsMsiReleaseIntegrity(input: {
  checksum: string
  installerSha256: string
  provenance: { installer?: { name?: string; sha256?: string } }
  version: string
}): void
