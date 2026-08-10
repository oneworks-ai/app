export interface VercelWorkspacePackageOptions {
  packageName: string
  relayDirectory?: string
  sourceDirectory: string
}

export interface VercelRuntimeMaterializationOptions {
  relayDirectory?: string
}

export function getVercelRuntimeWorkspacePackages(relayDirectory?: string): Array<{
  packageName: string
  sourceDirectory: string
}>

export function materializeVercelWorkspacePackage(
  options: VercelWorkspacePackageOptions
): Promise<string>

export function materializeVercelRuntime(
  env?: Record<string, string | undefined>,
  options?: VercelRuntimeMaterializationOptions
): Promise<string[]>
