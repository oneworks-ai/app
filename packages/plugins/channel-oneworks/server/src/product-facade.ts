import type { PluginRequestPrincipal } from '@oneworks/types'

export interface OneWorksChannelProductFacade {
  attachRoomChannelConnection: (
    principal: PluginRequestPrincipal,
    roomId: string,
    input: unknown
  ) => Promise<unknown>
  createRoom: (principal: PluginRequestPrincipal, input: unknown) => Promise<unknown>
  createRoomShare: (principal: PluginRequestPrincipal, roomId: string, input: unknown) => Promise<unknown>
  createScenario: (principal: PluginRequestPrincipal, input: unknown) => Promise<unknown>
  deleteRoom: (principal: PluginRequestPrincipal, roomId: string) => Promise<boolean>
  deleteScenario: (principal: PluginRequestPrincipal, scenarioRef: string) => Promise<boolean>
  getTrace: (principal: PluginRequestPrincipal, limit?: unknown) => Promise<unknown>
  injectSimulation: (principal: PluginRequestPrincipal, input: unknown) => Promise<unknown>
  listEntities: (principal: PluginRequestPrincipal) => Promise<unknown>
  listRoomChannelConnectionCandidates: (principal: PluginRequestPrincipal) => Promise<unknown>
  listRooms: (principal: PluginRequestPrincipal) => Promise<unknown>
  listScenarios: (principal: PluginRequestPrincipal) => Promise<unknown>
  listShareOwners: (principal: PluginRequestPrincipal) => Promise<unknown>
  listSharedRooms: (principal: PluginRequestPrincipal) => Promise<unknown>
  listShares: (principal: PluginRequestPrincipal) => Promise<unknown>
  listSimulationTargets: (principal: PluginRequestPrincipal) => Promise<unknown>
  revokeRoomShare: (principal: PluginRequestPrincipal, roomId: string, shareRef: string) => Promise<boolean>
  runScenario: (principal: PluginRequestPrincipal, scenarioRef: string) => Promise<unknown>
  updateRoom: (principal: PluginRequestPrincipal, roomId: string, input: unknown) => Promise<unknown>
  updateRoomChannelConnection: (
    principal: PluginRequestPrincipal,
    roomId: string,
    memberKey: string,
    channelLinkName: string,
    input: unknown
  ) => Promise<unknown>
  updateScenario: (principal: PluginRequestPrincipal, scenarioRef: string, input: unknown) => Promise<unknown>
}
