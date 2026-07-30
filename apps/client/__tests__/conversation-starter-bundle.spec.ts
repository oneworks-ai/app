import { describe, expect, it } from 'vitest'

import type { ConversationStarterConfig } from '@oneworks/types'

import { buildConversationStarterBundle } from '#~/components/chat/use-conversation-starter-bundle'
import type { ConversationStarterBundleSnapshot } from '#~/components/chat/use-conversation-starter-bundle'
import { DEFAULT_CHAT_SESSION_TARGET_DRAFT } from '#~/hooks/chat/chat-session-target'
import { DEFAULT_CHAT_SESSION_WORKSPACE_DRAFT } from '#~/hooks/chat/chat-session-workspace-draft'

const baseline = (): ConversationStarterBundleSnapshot => ({
  account: 'before-account',
  adapter: 'before-adapter',
  effortSelection: { effort: 'low', source: 'user' },
  initialContent: [{ type: 'text', text: 'before-content' }],
  model: 'before-model',
  permissionMode: 'default',
  sessionTargetDraft: DEFAULT_CHAT_SESSION_TARGET_DRAFT,
  workspaceDraft: DEFAULT_CHAT_SESSION_WORKSPACE_DRAFT,
  workspaceDraftDirty: false
})

describe('conversation starter bundle transaction', () => {
  it('keeps configured field presence separate from inherited snapshot values', () => {
    const adapterOnly = buildConversationStarterBundle({
      adapter: 'next-adapter',
      title: 'Adapter only'
    }, baseline())
    expect(adapterOnly.configuredFields).toMatchObject({
      account: { present: false },
      adapter: { present: true, value: 'next-adapter' },
      effort: { present: false },
      model: { present: false }
    })
    expect(adapterOnly.snapshot).toMatchObject({
      account: 'before-account',
      adapter: 'next-adapter',
      model: 'before-model'
    })

    const explicitAccount = buildConversationStarterBundle({
      account: 'next-account',
      adapter: 'next-adapter',
      title: 'Adapter account'
    }, baseline())
    expect(explicitAccount.configuredFields.account).toEqual({
      present: true,
      value: 'next-account'
    })
  })

  it.each(
    [
      'account',
      'adapter',
      'effort',
      'model',
      'mode',
      'worktree',
      'files'
    ] as const
  )('leaves the authoritative snapshot unchanged when %s projection throws', (field) => {
    const current = baseline()
    const before = structuredClone(current)
    const starter = {
      prompt: 'next-content',
      title: 'Throwing starter'
    } as ConversationStarterConfig
    Object.defineProperty(starter, field, {
      get: () => {
        throw new Error(`invalid ${field}`)
      }
    })

    expect(() => buildConversationStarterBundle(starter, current))
      .toThrow(`invalid ${field}`)
    expect(current).toEqual(before)
  })

  it('captures a configured mode getter once before building the immutable transaction', () => {
    let modeReads = 0
    const starter = {
      title: 'Read once'
    } as ConversationStarterConfig
    Object.defineProperty(starter, 'mode', {
      get: () => {
        modeReads += 1
        if (modeReads > 1) throw new Error('mode read twice')
        return 'workspace'
      }
    })

    const result = buildConversationStarterBundle(starter, baseline())

    expect(modeReads).toBe(1)
    expect(result.snapshot.sessionTargetDraft.type).toBe('workspace')
  })
})
