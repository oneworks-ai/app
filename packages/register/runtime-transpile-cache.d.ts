export interface RuntimeTranspileInput {
  cacheDir?: string
  code: string
  compilerConfigFingerprint?: string
  filename: string
  options: Record<string, unknown>
  transform: () => string
  transformVersion: string
}

export function loadOrTransformSync(input: RuntimeTranspileInput): string
export function resolveCompilerConfigFingerprint(filename: string): string
export function resolveRuntimeTranspileCacheDir(env?: NodeJS.ProcessEnv): string | undefined
