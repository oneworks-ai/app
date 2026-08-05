import type { FilesystemAuthority } from '.'

export interface FilesystemAuthorityTestOptions {
  autoStart?: boolean
  controlRoot: string
  fault?:
    | 'crash-after-stage'
    | 'crash-after-tree-remove-before-sync'
    | 'crash-after-tree-restore-before-sync'
    | 'crash-after-tree-stage-before-sync'
    | 'file-sync'
    | 'identity-probe'
    | 'parent-sync'
    | 'pause-after-final-check'
    | 'pause-after-tree-cleanup-open'
    | 'pause-after-tree-final-check'
    | 'pause-before-publish'
    | 'pause-before-tree-remove'
    | 'tree-parent-sync'
    | 'tree-stage-rollback-collision'
    | 'tree-stage-rollback-sync-failure'
  binding?: { verifyLocalPeer?(descriptor: number, serverSide: boolean): boolean }
  secret: string
  timeoutMs?: number
}

export function loadFilesystemAuthorityBinding(): {
  closeAuthority(handle: unknown): void
  openAuthority(workspaceRoot: string, controlRoot: string): unknown
  publishSync(...args: unknown[]): unknown
  treeSync(...args: unknown[]): unknown
  verifyLocalPeer(descriptor: number, serverSide: boolean): boolean
}
export function openFilesystemAuthorityForTest(
  workspaceRoot: string,
  options: FilesystemAuthorityTestOptions
): Promise<FilesystemAuthority>
export function prepareFilesystemAuthorityTestControlRoot(override: string): { controlRoot: string; secret: string }
export function startFilesystemAuthorityBroker(
  options: {
    beforeRecover?(): Promise<void> | void
    controlRoot: string
    database?: unknown
    secret?: string
  }
): Promise<{ close(): Promise<void>; endpoint: string; epoch: string }>
