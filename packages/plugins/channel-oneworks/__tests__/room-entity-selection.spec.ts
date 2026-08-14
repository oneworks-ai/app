import { describe, expect, it } from 'vitest'

import {
  filterRoomEntities,
  partitionRoomEntities,
  selectLeaderRelatedEntities
} from '../client/src/room-entity-selection'

const entities = [
  {
    description: 'Owns product decisions',
    entityId: 'product-leader',
    name: 'Product lead',
    relatedEntityIds: ['designer', 'engineer'],
    teamRole: 'leader' as const
  },
  { description: 'Designs flows', entityId: 'designer', name: 'Designer', teamRole: 'member' as const },
  { description: 'Builds features', entityId: 'engineer', name: 'Engineer', teamRole: 'member' as const }
]

describe('team chat entity selection', () => {
  it('partitions registered leaders from regular entities', () => {
    expect(partitionRoomEntities(entities)).toEqual({
      leaders: [entities[0]],
      members: [entities[1], entities[2]]
    })
  })

  it('searches both entity identity and descriptions', () => {
    expect(filterRoomEntities(entities, 'features')).toEqual([entities[2]])
    expect(filterRoomEntities(entities, 'PRODUCT-LEADER')).toEqual([entities[0]])
  })

  it('adds available related members without removing manual selections', () => {
    expect(selectLeaderRelatedEntities(
      ['observer'],
      entities[0]!,
      new Set(['designer', 'engineer', 'observer'])
    )).toEqual(['observer', 'designer', 'engineer'])
  })
})
