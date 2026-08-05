import type { FilesystemAuthority } from '.'

export interface FilesystemAuthorityTestOptions {
  autoStart?: boolean
  controlRoot: string
  fault?:
    | 'crash-after-stage'
    | 'file-sync'
    | 'identity-probe'
    | 'parent-sync'
    | 'pause-after-final-check'
    | 'pause-before-publish'
  binding?: { verifyLocalPeer?(descriptor: number, serverSide: boolean): boolean }
  secret: string
  timeoutMs?: number
}

export function loadFilesystemAuthorityBinding(): {
  closeAuthority(handle: unknown): void
  openAuthority(workspaceRoot: string, controlRoot: string): unknown
  publishSync(...args: unknown[]): unknown
  verifyLocalPeer(descriptor: number, serverSide: boolean): boolean
}
export function openFilesystemAuthorityForTest(
  workspaceRoot: string,
  options: FilesystemAuthorityTestOptions
): Promise<FilesystemAuthority>
export function prepareFilesystemAuthorityTestControlRoot(override: string): { controlRoot: string; secret: string }
export function startFilesystemAuthorityBroker(
  options: { controlRoot: string; secret?: string }
): Promise<{ close(): Promise<void>; endpoint: string; epoch: string }>
