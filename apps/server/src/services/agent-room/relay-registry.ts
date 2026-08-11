import { randomUUID } from 'node:crypto'

import type { SharedAgentRoomDirectoryEntry } from '@oneworks/types'

export interface ActiveAgentRoomRelayOwner {
  accountId: string
  label: string
  nodeId: string
  sourceId: string
}

interface DirectoryClient {
  listVisible: () => Promise<SharedAgentRoomDirectoryEntry[]>
}

const activeOwners = new Map<string, ActiveAgentRoomRelayOwner>()
const directoryClients = new Map<string, DirectoryClient>()

export const listActiveAgentRoomRelayOwners = (): ActiveAgentRoomRelayOwner[] => [...activeOwners.values()]

export const listSharedAgentRoomDirectory = async (): Promise<SharedAgentRoomDirectoryEntry[]> => {
  const results = await Promise.allSettled([...directoryClients.values()].map(client => client.listVisible()))
  return results.flatMap(result => result.status === 'fulfilled' ? result.value : [])
}

export const createAgentRoomRelayRegistryLease = () => {
  const leaseId = randomUUID()
  const ownerKeys = new Set<string>()
  const directoryKeys = new Set<string>()

  return {
    dispose: () => {
      for (const key of ownerKeys) activeOwners.delete(key)
      for (const key of directoryKeys) directoryClients.delete(key)
      ownerKeys.clear()
      directoryKeys.clear()
    },
    registerDirectoryClient: (client: DirectoryClient) => {
      const key = `${leaseId}:${randomUUID()}`
      directoryClients.set(key, client)
      directoryKeys.add(key)
      return () => {
        directoryClients.delete(key)
        directoryKeys.delete(key)
      }
    },
    setOwner: (localKey: string, owner?: ActiveAgentRoomRelayOwner) => {
      const key = `${leaseId}:${localKey}`
      if (owner == null) {
        activeOwners.delete(key)
        return
      }
      activeOwners.set(key, owner)
      ownerKeys.add(key)
    }
  }
}
