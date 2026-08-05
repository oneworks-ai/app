export interface StableReleaseInput {
  version: string
  vscodeVersion: string
}

export interface StablePackageIdentity {
  name: string
  version?: string
  license?: string
  pluginVersion?: string
}

export declare function evaluateStablePackageGraph(
  input: StableReleaseInput,
  packages: StablePackageIdentity[]
): string[]
export declare function runStableReleasePreflight(argv?: string[]): Promise<{
  ok: boolean
  packageCount: number
  version: string
  vscodeVersion: string
  errors: string[]
}>
