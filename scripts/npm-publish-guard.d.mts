import type { PublishPlan, PublishPlanItem } from './publish-plan-core.mjs'
export type NpmPublishAuthMode = 'oidc' | 'new-identity-bootstrap' | 'missing-trust-recovery'
export interface NpmTarballDigest {
  filePath?: string
  version: string
  integrity: string
  sha512: string
  shasum: string
}
export declare const npmRegistryRoot: string
export declare const npmOidcAudience: string
export declare const npmOidcExchangeRoot: string
export declare const npmRegistryPropagationAttempts: number
export declare const npmRegistryPropagationDelayMs: number
export declare const npmPublishAuthModes: Set<NpmPublishAuthMode>
export declare function redactNpmPublishSecrets(value: unknown, secrets?: string[]): string
export declare function extractPnpmPackRecord(
  stdout: unknown,
  item: { name: string; version: string }
): { name: string; version: string; filename: string; files: unknown[] }
export declare function evaluateNpmPublishMode(
  input: {
    mode: NpmPublishAuthMode
    requestedNames: string[]
    publishAll: boolean
    publishTag: string
    tokenAvailable: boolean
    targetProvenanceRequired: boolean
    onboardingVersion?: string
    selectedItems: Array<{ name: string; version: string }>
    registryMetadata: Map<string, unknown>
  }
): string[]
export declare function proveOidcExchangesBeforePublish(
  input: {
    selectedItems: Array<{ name: string; version: string }>
    requestToken: string
    requestUrl: string
    fetchImpl?: any
  }
): Promise<{ exchangedIdentityCount: number }>
export declare function waitForNpmRegistryVersions(
  input: {
    items: Array<{ name: string; version: string }>
    attempts?: number
    delayMs?: number
    fetchImpl?: any
    sleep?: (delayMs: number) => Promise<void>
  }
): Promise<{ attemptsUsed: number }>
export declare function freezeApprovedTarballs(
  input: {
    items: Array<{ name: string; version: string }>
    outputDir?: string
  }
): Promise<Map<string, NpmTarballDigest>>
export declare function preparePublishWorkspaceDependencies(
  input: {
    items: PublishPlanItem[]
    repoRoot?: string
    runCommand?: (command: string, args: string[], options: Record<string, unknown>) => { status?: number | null }
  }
): { sourceNames: string[] }
export declare function executeFrozenPublish(
  input: Record<string, unknown>
): Promise<{ attempts: Array<{ name: string; status: number }> }>
export declare function verifySlsaProvenance(input: Record<string, unknown>): unknown
export declare function verifyNpmPublishPostflight(
  input: Record<string, unknown>
): Promise<
  { complete: boolean; identityCount: number; completeCount: number; failures: string[]; provenanceVerified: boolean }
>
export declare function loadNpmPublishSelection(
  input?: { repoRoot?: string; packages?: string; publishAll?: boolean }
): Promise<{ plan: PublishPlan; requestedNames: string[] }>
