export declare function shouldBuildStableWindowsAsset(packages: string, publishAll: string): boolean
export declare function assertStableVersion(version: string): string
export declare function buildWindowsAssetNames(version: string): {
  archiveName: string
  checksumName: string
  releaseTag: string
}
