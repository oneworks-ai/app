export interface BridgeRealHomeToMockHomeOptions {
  realHome?: string
  mockHome?: string
  entries?: string[]
  excludeEntries?: string[]
  includeDotEntries?: boolean
  includePlatformEntries?: boolean
  directLinkEntries?: string[]
}

export interface ClaimMockHomePathsOptions {
  mockHome?: string
  paths?: string[]
}

export declare const bridgeRealHomeToMockHome: (options?: BridgeRealHomeToMockHomeOptions) => void
export declare const claimMockHomePaths: (options?: ClaimMockHomePathsOptions) => void
export declare const collectGitHomeEntries: (realHome: string) => string[]
export declare const linkRealHomeGitConfig: (options?: BridgeRealHomeToMockHomeOptions) => void
