export type FilesystemAuthorityErrorCode =
  | 'asset_claim_indeterminate'
  | 'asset_claim_lost'
  | 'asset_create_in_progress'
  | 'asset_destination_changed'
  | 'asset_destination_forbidden'
  | 'asset_exists'
  | 'asset_filesystem_authority_unavailable'
  | 'asset_native_protocol_error'
  | 'asset_publish_indeterminate'

export interface FilesystemPublication {
  authorityId: string
  basename: string
  bytes: Uint8Array
  generation: number
  parentSegments: readonly string[]
}

export type FilesystemPublicationOutcome =
  | { state: 'committed'; warnings?: readonly string[] }
  | { state: 'committed-degraded'; warnings: readonly string[] }
  | { state: 'committed-indeterminate'; warnings: readonly string[] }

export interface FilesystemAuthority {
  readonly capability: string
  readonly id: string
  claim(kind: 'entity' | 'spec' | 'rule', semanticName: string): Promise<number>
  close(): void
  publish(publication: FilesystemPublication): Promise<FilesystemPublicationOutcome>
  release(generation: number): Promise<boolean>
}

export class FilesystemAuthorityError extends Error {
  readonly code: FilesystemAuthorityErrorCode
  readonly committed: boolean | 'indeterminate'
  readonly warnings: readonly string[]
}

export function openFilesystemAuthority(workspaceRoot: string): Promise<FilesystemAuthority>
