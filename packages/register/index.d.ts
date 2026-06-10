declare module '@oneworks/register/dotenv' {
  export interface LoadDotenvOptions {
    workspaceFolder?: string
    files?: string[]
  }

  export type ProjectHomeMigratedSegment = 'logs' | 'caches' | '.mock' | '.local' | 'runtime'

  export interface ProjectHomeMigrationResult {
    migratedSources: string[]
    targetDir: string
  }

  export interface LegacyProjectHomeSegmentPaths {
    sourceDirs: string[]
    targetDir: string
  }

  export const loadDotenv: (options?: LoadDotenvOptions) => void
  export const migrateProjectHomeSegmentSync: (
    cwd: string | undefined,
    env: NodeJS.ProcessEnv | undefined,
    segment: ProjectHomeMigratedSegment
  ) => ProjectHomeMigrationResult
  export const migrateProjectHomeSegmentsSync: (
    cwd?: string,
    env?: NodeJS.ProcessEnv,
    segments?: readonly ProjectHomeMigratedSegment[]
  ) => ProjectHomeMigrationResult[]
  export const resolveLegacyProjectHomeSegmentPaths: (
    cwd: string | undefined,
    env: NodeJS.ProcessEnv | undefined,
    segment: ProjectHomeMigratedSegment
  ) => LegacyProjectHomeSegmentPaths
  export const resolvePrimaryWorkspaceFolder: (
    workspaceFolder: string,
    env?: NodeJS.ProcessEnv
  ) => string | undefined
  export const resolveProjectLaunchCwd: (cwd?: string, env?: NodeJS.ProcessEnv) => string
  export const resolveProjectWorkspaceFolder: (cwd?: string, env?: NodeJS.ProcessEnv) => string
  export const resolveProjectConfigDir: (cwd?: string, env?: NodeJS.ProcessEnv) => string | undefined
  export const resolveProjectOoBaseDir: (cwd?: string, env?: NodeJS.ProcessEnv) => string
  export const resolveProjectHomeProjectsDir: (env?: NodeJS.ProcessEnv) => string
  export const resolveProjectHomeDir: (cwd?: string, env?: NodeJS.ProcessEnv) => string
  export const resolveProjectHomePath: (cwd?: string, env?: NodeJS.ProcessEnv, ...segments: string[]) => string
  export const resolveProjectMockHome: (cwd?: string, env?: NodeJS.ProcessEnv) => string
}

declare module '@oneworks/register/mock-home-git' {
  export interface LinkRealHomeGitConfigOptions {
    realHome?: string
    mockHome?: string
  }

  export const linkRealHomeGitConfig: (options?: LinkRealHomeGitConfigOptions) => void
}

declare module '@oneworks/register/mock-home-bridge' {
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

  export const bridgeRealHomeToMockHome: (options?: BridgeRealHomeToMockHomeOptions) => void
  export const claimMockHomePaths: (options?: ClaimMockHomePathsOptions) => void
  export const collectGitHomeEntries: (realHome: string) => string[]
  export const linkRealHomeGitConfig: (options?: BridgeRealHomeToMockHomeOptions) => void
}

declare module '@oneworks/register/esbuild' {}

declare module '@oneworks/register/preload' {}
