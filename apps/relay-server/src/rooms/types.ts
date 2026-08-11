import type {
  RelayRoomAclGrant,
  RelayRoomAction,
  RelayRoomDescriptor,
  RelayRoomLiveRequest,
  RelayRoomLiveResponse,
  RelayRoomPermission
} from '@oneworks/types'

/** This is the entire persisted Room representation in Relay. */
export type RelaySharedRoom = RelayRoomDescriptor

export type { RelayRoomAclGrant, RelayRoomAction, RelayRoomLiveRequest, RelayRoomLiveResponse, RelayRoomPermission }
