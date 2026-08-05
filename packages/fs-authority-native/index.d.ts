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
  | 'managed_tree_changed'
  | 'managed_tree_cleanup_incomplete'
  | 'managed_tree_exists'
  | 'managed_tree_mutation_indeterminate'
  | 'managed_tree_transaction_invalid'

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

export interface ManagedTreePreparation {
  authorityId: string
  entryName: string
  generation: number
  parentSegments: readonly string[]
}

export interface ManagedTreeMutation {
  authorityId: string
  generation: number
  transaction: string
}

export type ManagedTreeMutationOutcome =
  | { state: 'quarantined'; warnings?: readonly string[] }
  | { state: 'removed'; warnings?: readonly string[] }
  | { state: 'restored'; warnings?: readonly string[] }
  | { state: 'committed-indeterminate'; warnings: readonly string[] }

export interface FilesystemAuthority {
  readonly capability: string
  readonly id: string
  claim(kind: 'entity' | 'spec' | 'rule', semanticName: string): Promise<number>
  claimMutation(namespace: string, key: string): Promise<number>
  close(): void
  prepareManagedTree(transaction: ManagedTreePreparation): Promise<string>
  publish(publication: FilesystemPublication): Promise<FilesystemPublicationOutcome>
  removeManagedTree(transaction: ManagedTreeMutation): Promise<ManagedTreeMutationOutcome>
  release(generation: number): Promise<boolean>
  restoreManagedTree(transaction: ManagedTreeMutation): Promise<ManagedTreeMutationOutcome>
  stageManagedTree(transaction: ManagedTreeMutation): Promise<ManagedTreeMutationOutcome>
}

export class FilesystemAuthorityError extends Error {
  readonly code: FilesystemAuthorityErrorCode
  readonly committed: boolean | 'indeterminate'
  readonly warnings: readonly string[]
}

export function openFilesystemAuthority(workspaceRoot: string): Promise<FilesystemAuthority>
