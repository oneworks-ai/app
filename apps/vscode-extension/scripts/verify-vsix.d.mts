export interface VsixReleaseIdentityInput {
  extensionManifest: string
  sourceVersion: string
  vsixManifest: string
}

export interface VsixReleaseIdentity {
  prerelease: boolean
  sourceVersion: string
  storeVersion: string
}

export function assertVsixReleaseIdentity(input: VsixReleaseIdentityInput): VsixReleaseIdentity
export function verifyVsixFile(packagePath: string, sourceVersion: string): Promise<VsixReleaseIdentity>
