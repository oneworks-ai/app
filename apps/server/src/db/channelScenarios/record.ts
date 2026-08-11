export type ChannelScenarioSessionType = 'direct' | 'group'
export type ChannelScenarioActorRole = 'admin' | 'participant'

export interface ChannelScenarioDbRow {
  actorRole: ChannelScenarioActorRole
  id: string
  name: string
  roomRef: string
  userLabel: string
  sessionType: ChannelScenarioSessionType
  text: string
  createdAt: number
  updatedAt: number
}

export type ChannelScenarioRow = ChannelScenarioDbRow
