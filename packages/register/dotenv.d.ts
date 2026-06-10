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

export declare const loadDotenv: (options?: LoadDotenvOptions) => void
export declare const migrateProjectHomeSegmentSync: (
  cwd: string | undefined,
  env: NodeJS.ProcessEnv | undefined,
  segment: ProjectHomeMigratedSegment
) => ProjectHomeMigrationResult
export declare const migrateProjectHomeSegmentsSync: (
  cwd?: string,
  env?: NodeJS.ProcessEnv,
  segments?: readonly ProjectHomeMigratedSegment[]
) => ProjectHomeMigrationResult[]
export declare const resolveLegacyProjectHomeSegmentPaths: (
  cwd: string | undefined,
  env: NodeJS.ProcessEnv | undefined,
  segment: ProjectHomeMigratedSegment
) => LegacyProjectHomeSegmentPaths
export declare const resolvePrimaryWorkspaceFolder: (
  workspaceFolder: string,
  env?: NodeJS.ProcessEnv
) => string | undefined
export declare const resolveProjectLaunchCwd: (cwd?: string, env?: NodeJS.ProcessEnv) => string
export declare const resolveProjectWorkspaceFolder: (cwd?: string, env?: NodeJS.ProcessEnv) => string
export declare const resolveProjectConfigDir: (cwd?: string, env?: NodeJS.ProcessEnv) => string | undefined
export declare const resolveProjectOoBaseDir: (cwd?: string, env?: NodeJS.ProcessEnv) => string
export declare const resolveProjectHomeProjectsDir: (env?: NodeJS.ProcessEnv) => string
export declare const resolveProjectHomeDir: (cwd?: string, env?: NodeJS.ProcessEnv) => string
export declare const resolveProjectHomePath: (cwd?: string, env?: NodeJS.ProcessEnv, ...segments: string[]) => string
export declare const resolveProjectMockHome: (cwd?: string, env?: NodeJS.ProcessEnv) => string
