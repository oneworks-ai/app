/**
 * Relay's intentionally narrow shared-Room contract.  Room content stays on
 * the owner node; these types describe only directory, ACL, and live-envelope
 * metadata.
 */
export type RelayRoomPermission =
  | 'approve'
  | 'manage_share'
  | 'open_run'
  | 'send'
  | 'target_member'
  | 'view'

export interface RelayRoomAclGrant {
  permissions: RelayRoomPermission[]
  principalId: string
  principalType: 'team' | 'user'
}

export interface RelayRoomDescriptor {
  acls: RelayRoomAclGrant[]
  createdAt: string
  icon?: string
  ownerDeviceId: string
  ownerNodeId: string
  ownerUserId: string
  shareId: string
  status: 'active' | 'revoked'
  title: string
  updatedAt: string
}

/** Public Relay directory projection. Content and owner-local identifiers stay on the owner node. */
export type SharedAgentRoomDescriptor =
  & Pick<
    RelayRoomDescriptor,
    'createdAt' | 'icon' | 'shareId' | 'status' | 'title' | 'updatedAt'
  >
  & {
    availability: 'offline' | 'online'
  }

export interface SharedAgentRoomDirectoryEntry {
  room: SharedAgentRoomDescriptor
  sourceLabel: string
  sourceRef: string
}

export type RelayRoomAction = 'approve' | 'manage_share' | 'open_run' | 'send' | 'target_member' | 'view'

/** The opaque body is live-only and must never be persisted or logged by Relay. */
export interface RelayRoomLiveRequest {
  action: RelayRoomAction
  body?: unknown
  /**
   * Stable caller-provided operation identifier. The Relay never persists it,
   * but the owner uses it to make a retried mutation idempotent.
   */
  operationId: string
  principal: { id: string; teamIds?: string[]; type: 'user' }
  requestId: string
  shareId: string
}

export interface RelayRoomLiveResponse {
  body?: unknown
  error?: 'owner_offline' | 'room_unavailable' | 'timeout'
  ok: boolean
  operationId?: string
  requestId: string
  shareId: string
}
