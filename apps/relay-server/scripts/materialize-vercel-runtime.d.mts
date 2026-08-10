export interface VercelWorkspacePackageOptions {
  packageName: string
  relayDirectory?: string
  sourceDirectory: string
}

export function materializeVercelWorkspacePackage(
  options: VercelWorkspacePackageOptions
): Promise<string>

export function materializeVercelRuntime(
  env?: Record<string, string | undefined>
): Promise<string[]>
