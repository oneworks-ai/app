import { describe, expect, it } from 'vitest'

import {
  matchesRelayConfigProject,
  normalizeRelayConfigAssignment,
  upsertRelayConfigAssignment
} from '../src/config-snapshot-normalize.js'

describe('relay config snapshot POSIX path identity', () => {
  it.runIf(process.platform !== 'win32')('preserves literal backslashes through upsert, snapshot, and matching', () => {
    const literalBackslashProject = String.raw`/projects/team\secret`
    const nestedProject = '/projects/team/secret'
    const store = { configAssignments: [] } as never

    const assignment = upsertRelayConfigAssignment(store, {
      allowedFields: ['skills'],
      configPatch: { skills: ['literal-project'] },
      id: 'literal-project',
      project: { allow: [literalBackslashProject], deny: [nestedProject] },
      updatedAt: '2026-08-12T00:00:00.000Z'
    })
    const snapshot = JSON.parse(JSON.stringify(assignment))
    const normalized = normalizeRelayConfigAssignment(snapshot)

    expect(normalized?.project).toEqual({
      allow: [literalBackslashProject],
      deny: [nestedProject]
    })
    expect(matchesRelayConfigProject(normalized!, { workspaceFolder: literalBackslashProject })).toBe(true)
    expect(matchesRelayConfigProject(normalized!, { workspaceFolder: nestedProject })).toBe(false)

    const relativeAssignment = normalizeRelayConfigAssignment({
      allowedFields: ['skills'],
      configPatch: { skills: ['relative-literal-project'] },
      id: 'relative-literal-project',
      project: { allow: [String.raw`team\secret`], deny: ['team/secret'] }
    })
    expect(matchesRelayConfigProject(relativeAssignment!, { workspaceFolder: String.raw`team\secret` })).toBe(true)
    expect(matchesRelayConfigProject(relativeAssignment!, { workspaceFolder: 'team/secret' })).toBe(false)
  })

  it('matches Windows family spellings without crossing into POSIX identities', () => {
    const assignment = normalizeRelayConfigAssignment({
      allowedFields: ['skills'],
      configPatch: { skills: ['windows-family'] },
      id: 'windows-family',
      project: { allow: [String.raw`C:\Projects\App`, String.raw`\\Server\Share`, String.raw`\project`] }
    })

    expect(matchesRelayConfigProject(assignment!, { workspaceFolder: 'c:/projects/app' })).toBe(true)
    expect(matchesRelayConfigProject(assignment!, { workspaceFolder: '//server/share' })).toBe(true)
    expect(matchesRelayConfigProject(assignment!, { workspaceFolder: '/server/share' })).toBe(false)
    expect(matchesRelayConfigProject(assignment!, { workspaceFolder: '/project' })).toBe(false)
    expect(matchesRelayConfigProject(assignment!, { workspaceFolder: String.raw`C:Projects\App` })).toBe(false)
  })
})
