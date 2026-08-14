export interface RoomEntitySelectionItem {
  avatar?: string
  description?: string
  entityId: string
  name: string
  relatedEntityIds?: string[]
  teamRole?: 'leader' | 'member'
}

export const filterRoomEntities = <T extends RoomEntitySelectionItem>(entities: T[], query: string) => {
  const normalizedQuery = query.trim().toLowerCase()
  if (normalizedQuery === '') return entities
  return entities.filter(entity => (
    [entity.name, entity.description, entity.entityId]
      .filter(Boolean)
      .some(value => String(value).toLowerCase().includes(normalizedQuery))
  ))
}

export const partitionRoomEntities = <T extends RoomEntitySelectionItem>(entities: T[]) => ({
  leaders: entities.filter(entity => entity.teamRole === 'leader'),
  members: entities.filter(entity => entity.teamRole !== 'leader')
})

export const selectLeaderRelatedEntities = (
  selectedEntityIds: string[],
  leader: RoomEntitySelectionItem,
  availableMemberIds: Set<string>
) => [
  ...new Set([
    ...selectedEntityIds,
    ...(leader.relatedEntityIds ?? []).filter(entityId => availableMemberIds.has(entityId))
  ])
]
