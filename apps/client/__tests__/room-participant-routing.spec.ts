import { describe, expect, it } from 'vitest'

import {
  applyAgentRoomMentionCompletion,
  createAgentRoomSenderSubmit,
  getAgentRoomConversationTargetPreview,
  getAgentRoomMentionCompletions,
  resolveRoomTarget
} from '#~/components/agent-room/@core/resolve-room-target'
import type {
  AgentRoomTargetMember,
  AgentRoomTargetResolution
} from '#~/components/agent-room/@core/resolve-room-target'

const members: AgentRoomTargetMember[] = [
  {
    memberKey: 'member:host',
    kind: 'host',
    label: 'host',
    runs: [
      {
        runKey: 'run:host-plan',
        memberKey: 'member:host',
        title: 'host-plan'
      }
    ]
  },
  {
    memberKey: 'member:architect',
    kind: 'entity',
    label: 'architect',
    runs: [
      {
        runKey: 'run:schema-plan',
        memberKey: 'member:architect',
        title: 'schema-plan'
      },
      {
        runKey: 'run:billing-review',
        memberKey: 'member:architect',
        title: 'billing-review'
      }
    ]
  },
  {
    memberKey: 'member:reviewer',
    kind: 'entity',
    label: 'reviewer',
    runs: [
      {
        runKey: 'run:release-check',
        memberKey: 'member:reviewer',
        title: 'release-check'
      }
    ]
  }
]

const expectResolved = (
  resolution: AgentRoomTargetResolution
): Extract<AgentRoomTargetResolution, { status: 'resolved' }> => {
  expect(resolution.status).toBe('resolved')
  return resolution as Extract<AgentRoomTargetResolution, { status: 'resolved' }>
}

describe('agent room target routing', () => {
  it('routes plain room messages to the host agent', () => {
    expect(resolveRoomTarget('Please coordinate this', members)).toEqual({
      status: 'resolved',
      content: 'Please coordinate this',
      target: { memberKey: 'member:host' },
      route: 'host',
      previewLabel: '@host'
    })
  })

  it('recognizes leader-labeled host members without relying on member kind', () => {
    const leaderMembers: AgentRoomTargetMember[] = [
      {
        memberKey: 'host:host-session',
        label: 'leader',
        runs: []
      }
    ]

    expect(resolveRoomTarget('Please coordinate this', leaderMembers)).toEqual({
      status: 'resolved',
      content: 'Please coordinate this',
      target: { memberKey: 'host:host-session' },
      route: 'host',
      previewLabel: '@leader'
    })
    expect(getAgentRoomConversationTargetPreview('', leaderMembers)).toEqual({
      status: 'host',
      targetLabel: 'leader'
    })
  })

  it('previews the active room conversation target for the sender header', () => {
    expect(getAgentRoomConversationTargetPreview('', members)).toEqual({
      status: 'host',
      targetLabel: 'host'
    })

    expect(getAgentRoomConversationTargetPreview('Please coordinate this', members)).toEqual({
      status: 'host',
      targetLabel: 'host'
    })

    expect(getAgentRoomConversationTargetPreview('@architect Please review the plan', members)).toEqual({
      status: 'member',
      targetLabel: 'architect'
    })

    expect(getAgentRoomConversationTargetPreview('@architect/schema-plan Continue', members)).toEqual({
      status: 'run',
      targetLabel: 'architect/schema-plan'
    })

    expect(getAgentRoomConversationTargetPreview('@architect ', members)).toEqual({
      status: 'member',
      targetLabel: 'architect'
    })

    expect(getAgentRoomConversationTargetPreview('@architect/schema-plan ', members)).toEqual({
      status: 'run',
      targetLabel: 'architect/schema-plan'
    })
  })

  it('routes @member targets to the member mailbox', () => {
    expect(resolveRoomTarget('@architect Please review the plan', members)).toEqual({
      status: 'resolved',
      content: 'Please review the plan',
      target: { memberKey: 'member:architect' },
      route: 'member',
      mention: '@architect',
      previewLabel: '@architect mailbox'
    })
  })

  it('routes @member/run targets to an explicit run', () => {
    expect(resolveRoomTarget('@architect/schema-plan Can I change the schema?', members)).toEqual({
      status: 'resolved',
      content: 'Can I change the schema?',
      target: { memberKey: 'member:architect', runKey: 'run:schema-plan' },
      route: 'run',
      mention: '@architect/schema-plan',
      previewLabel: '@architect/schema-plan'
    })
  })

  it('builds room submit requests for the default host target', () => {
    const request = createAgentRoomSenderSubmit(expectResolved(resolveRoomTarget('Please coordinate this', members)))

    expect(request).toEqual({
      content: 'Please coordinate this',
      target: { memberKey: 'member:host' },
      route: 'host'
    })
  })

  it('builds room submit requests for @member targets', () => {
    const request = createAgentRoomSenderSubmit(expectResolved(resolveRoomTarget('@architect Review it', members)))

    expect(request).toEqual({
      content: 'Review it',
      target: { memberKey: 'member:architect' },
      route: 'member'
    })
  })

  it('builds room submit requests for @member/run targets', () => {
    const request = createAgentRoomSenderSubmit(
      expectResolved(resolveRoomTarget('@architect/schema-plan Continue', members))
    )

    expect(request).toEqual({
      content: 'Continue',
      target: { memberKey: 'member:architect', runKey: 'run:schema-plan' },
      route: 'run'
    })
  })

  it('reports missing member or run targets', () => {
    expect(resolveRoomTarget('@planner Draft this', members)).toEqual({
      status: 'missing',
      mention: '@planner'
    })

    expect(resolveRoomTarget('@architect/missing-run Draft this', members)).toEqual({
      status: 'missing',
      mention: '@architect/missing-run'
    })

    expect(getAgentRoomConversationTargetPreview('@planner Draft this', members)).toEqual({
      status: 'missing',
      targetLabel: '@planner'
    })
  })

  it('reports ambiguous targets with suggestions', () => {
    const duplicateMembers: AgentRoomTargetMember[] = [
      ...members,
      {
        memberKey: 'member:architect-copy',
        kind: 'entity',
        label: 'architect',
        runs: []
      }
    ]

    const resolution = resolveRoomTarget('@architect Continue', duplicateMembers)

    expect(resolution.status).toBe('ambiguous')
    expect(resolution).toMatchObject({
      mention: '@architect',
      suggestions: [
        { value: '@architect', target: { memberKey: 'member:architect' }, kind: 'member' },
        { value: '@architect', target: { memberKey: 'member:architect-copy' }, kind: 'member' }
      ]
    })
    expect(getAgentRoomConversationTargetPreview('@architect Continue', duplicateMembers)).toEqual({
      status: 'ambiguous',
      targetLabel: '@architect'
    })
  })

  it('rejects empty targeted messages', () => {
    expect(resolveRoomTarget('@architect ', members)).toEqual({
      status: 'empty-targeted-message',
      mention: '@architect',
      target: { memberKey: 'member:architect' },
      route: 'member',
      previewLabel: '@architect mailbox'
    })

    expect(resolveRoomTarget('@architect/schema-plan', members)).toEqual({
      status: 'empty-targeted-message',
      mention: '@architect/schema-plan',
      target: { memberKey: 'member:architect', runKey: 'run:schema-plan' },
      route: 'run',
      previewLabel: '@architect/schema-plan'
    })
  })

  it('normalizes labels that already include @ when resolving and completing mentions', () => {
    const prefixedMembers: AgentRoomTargetMember[] = [
      {
        memberKey: 'entity:designer-1',
        kind: 'entity',
        label: '@designer',
        runs: [
          {
            runKey: 'run:handoff-1',
            memberKey: 'entity:designer-1',
            title: '@handoff'
          }
        ]
      }
    ]

    expect(resolveRoomTarget('@designer Check copy', prefixedMembers)).toEqual({
      status: 'resolved',
      content: 'Check copy',
      target: { memberKey: 'entity:designer-1' },
      route: 'member',
      mention: '@designer',
      previewLabel: '@designer mailbox'
    })
    expect(resolveRoomTarget('@designer/handoff Continue', prefixedMembers)).toEqual({
      status: 'resolved',
      content: 'Continue',
      target: { memberKey: 'entity:designer-1', runKey: 'run:handoff-1' },
      route: 'run',
      mention: '@designer/handoff',
      previewLabel: '@designer/handoff'
    })
    expect(getAgentRoomMentionCompletions(prefixedMembers).map(item => item.value)).toEqual([
      '@designer',
      '@designer/handoff'
    ])
    expect(getAgentRoomConversationTargetPreview('@designer/handoff ', prefixedMembers)).toEqual({
      status: 'run',
      targetLabel: 'designer/handoff'
    })
  })

  it('routes scoped entity names with slashes as member targets before treating the slash as a run separator', () => {
    const scopedMembers: AgentRoomTargetMember[] = [
      {
        memberKey: 'entity:std/dev-planner',
        kind: 'entity',
        label: 'std/dev-planner',
        runs: [
          {
            runKey: 'run:plan-check',
            memberKey: 'entity:std/dev-planner',
            title: 'plan-check'
          }
        ]
      },
      {
        memberKey: 'entity:std/dev-reviewer',
        kind: 'entity',
        label: 'std/dev-reviewer',
        runs: []
      }
    ]

    expect(resolveRoomTarget('@std/dev-planner hi?', scopedMembers)).toEqual({
      status: 'resolved',
      content: 'hi?',
      target: { memberKey: 'entity:std/dev-planner' },
      route: 'member',
      mention: '@std/dev-planner',
      previewLabel: '@std/dev-planner mailbox'
    })
    expect(resolveRoomTarget('@std/dev-planner/plan-check continue', scopedMembers)).toEqual({
      status: 'resolved',
      content: 'continue',
      target: { memberKey: 'entity:std/dev-planner', runKey: 'run:plan-check' },
      route: 'run',
      mention: '@std/dev-planner/plan-check',
      previewLabel: '@std/dev-planner/plan-check'
    })
    expect(getAgentRoomConversationTargetPreview('@std/dev-planner hi?', scopedMembers)).toEqual({
      status: 'member',
      targetLabel: 'std/dev-planner'
    })
    expect(getAgentRoomMentionCompletions(scopedMembers, 'std/dev').map(item => item.value)).toEqual([
      '@std/dev-planner',
      '@std/dev-planner/plan-check',
      '@std/dev-reviewer'
    ])
  })

  it('returns member and run mention completions', () => {
    expect(getAgentRoomMentionCompletions(members, 'architect/s').map(item => item.value)).toEqual([
      '@architect/schema-plan'
    ])

    expect(applyAgentRoomMentionCompletion('Ask @arch', '@architect/schema-plan', 'Ask @arch'.length)).toBe(
      'Ask @architect/schema-plan '
    )
  })
})
