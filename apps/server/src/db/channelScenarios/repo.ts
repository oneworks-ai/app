import { randomUUID } from 'node:crypto'

import type { SqliteDatabase } from '../sqlite'
import type { ChannelScenarioActorRole, ChannelScenarioDbRow, ChannelScenarioSessionType } from './record'

const FIELDS = 'id, name, roomRef, actorRole, userLabel, sessionType, text, createdAt, updatedAt'

export function createChannelScenariosRepo(db: SqliteDatabase) {
  const get = (id: string) =>
    db.prepare(`SELECT ${FIELDS} FROM channel_scenarios WHERE id = ?`).get<ChannelScenarioDbRow>(id)

  const list = () =>
    db.prepare(`SELECT ${FIELDS} FROM channel_scenarios ORDER BY updatedAt DESC`).all<ChannelScenarioDbRow>()

  const create = (input: {
    actorRole: ChannelScenarioActorRole
    id?: string
    name: string
    roomRef: string
    userLabel: string
    sessionType: ChannelScenarioSessionType
    text: string
  }) => {
    const id = input.id?.trim() || `channel_scenario_${randomUUID()}`
    const now = Date.now()
    db.prepare(`
      INSERT INTO channel_scenarios (${FIELDS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.name, input.roomRef, input.actorRole, input.userLabel, input.sessionType, input.text, now, now)
    return get(id)!
  }

  const update = (
    id: string,
    input: Partial<{
      actorRole: ChannelScenarioActorRole
      name: string
      roomRef: string
      userLabel: string
      sessionType: ChannelScenarioSessionType
      text: string
    }>
  ) => {
    const current = get(id)
    if (current == null) return undefined
    const now = Date.now()
    db.prepare(`
      UPDATE channel_scenarios
      SET name = ?, roomRef = ?, actorRole = ?, userLabel = ?, sessionType = ?, text = ?, updatedAt = ?
      WHERE id = ?
    `).run(
      input.name ?? current.name,
      input.roomRef ?? current.roomRef,
      input.actorRole ?? current.actorRole,
      input.userLabel ?? current.userLabel,
      input.sessionType ?? current.sessionType,
      input.text ?? current.text,
      now,
      id
    )
    return get(id)
  }

  const remove = (id: string) => db.prepare('DELETE FROM channel_scenarios WHERE id = ?').run(id).changes > 0

  return { create, get, list, remove, update }
}

export type ChannelScenariosRepo = ReturnType<typeof createChannelScenariosRepo>
