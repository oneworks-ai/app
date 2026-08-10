export interface PrepareVercelOutputOptions {
  packageRootOverrides?: Map<string, string>
  relayDirectory?: string
  runtimePackages?: string[]
}

export function findPackageRoot(packageName: string, fromPaths: string[]): Promise<string>

export function collectRuntimePackages(
  packageNames: string[],
  options: {
    collected?: Map<string, string>
    fromPaths: string[]
    packageRootOverrides?: Map<string, string>
  }
): Promise<Map<string, string>>

export function prepareVercelOutput(
  options?: PrepareVercelOutputOptions
): Promise<Map<string, string>>
