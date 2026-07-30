import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  acknowledgeHighRiskPermissionMode,
  buildPermissionModeSessionAcknowledgementScope,
  consumePermissionModeDraftCreationAcknowledgements,
  createDraftPermissionModeLifecycle,
  discardPermissionModeDraftCreationToken,
  hasAcknowledgedHighRiskPermissionMode,
  issuePermissionModeDraftCreationToken
} from '#~/hooks/chat/permission-mode-acknowledgement'
import { deriveCanonicalPermissionModeOwner } from '#~/hooks/chat/permission-mode-owner'
import { stableSha256 } from '#~/hooks/chat/stable-sha256'
import {
  buildPermissionModeOptions,
  getPermissionModeRiskLevel,
  requestPermissionModeChange
} from '#~/hooks/chat/use-chat-permission-mode'
import type { PermissionModeChangeHandler } from '#~/hooks/chat/use-chat-permission-mode'
import en from '#~/resources/locales/en.json'
import zh from '#~/resources/locales/zh.json'

const referenceActionsStyles = readFileSync(
  new URL(
    '../src/components/chat/sender/@components/reference-actions/ReferenceActionsControl.scss',
    import.meta.url
  ),
  'utf8'
)

describe('permission mode contract', () => {
  it('keeps adapter-accurate descriptions and canonical risk semantics', () => {
    const options = buildPermissionModeOptions(key => key)

    expect(options).toHaveLength(5)
    expect(options.every(option => option.description != null)).toBe(true)
    expect(getPermissionModeRiskLevel('dontAsk')).toBe('high')
    expect(getPermissionModeRiskLevel('bypassPermissions')).toBe('critical')
    expect(en.chat.permissionModes.plan.description).toContain('Limits vary')
    expect(en.chat.permissionModes.dontAsk.description).toContain('default approval policy')
    expect(zh.chat.permissionModes.plan.description).toContain('限制因适配器而异')
  })

  it('uses one stable shared width recipe for every reference submenu', () => {
    expect(referenceActionsStyles).toContain(
      '--reference-actions-submenu-width: min(340px, calc(100vw - 24px))'
    )
    expect(referenceActionsStyles).toContain(
      '.oneworks-overlay-menu-column.is-submenu\n  .reference-actions-menu'
    )
    expect(referenceActionsStyles).not.toContain(':has(')
    expect(referenceActionsStyles).not.toContain('376px')
  })

  it('consumes creation provenance exactly once and makes discard irreversible', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value)
    }
    const lifecycle = createDraftPermissionModeLifecycle({ ownerIdentity: 'workspace-a' })
    const draftScope = { kind: 'ephemeral' as const, lifecycle }
    acknowledgeHighRiskPermissionMode('bypassPermissions', draftScope, storage)
    const consumed = issuePermissionModeDraftCreationToken(lifecycle)
    const createdScope = buildPermissionModeSessionAcknowledgementScope({
      ownerIdentity: 'workspace-a',
      session: { createdAt: 1, id: 'created' }
    })!

    expect(consumePermissionModeDraftCreationAcknowledgements(
      consumed,
      createdScope,
      storage
    )).toBe(true)
    expect(consumePermissionModeDraftCreationAcknowledgements(
      consumed,
      createdScope,
      storage
    )).toBe(false)
    expect(hasAcknowledgedHighRiskPermissionMode(
      'bypassPermissions',
      createdScope,
      storage
    )).toBe(true)

    const discarded = issuePermissionModeDraftCreationToken(lifecycle)
    discardPermissionModeDraftCreationToken(discarded)
    expect(consumePermissionModeDraftCreationAcknowledgements(
      discarded,
      createdScope,
      storage
    )).toBe(false)
  })

  it('binds durable acknowledgement to owner and incarnation and accepts legacy void callbacks', async () => {
    expect(
      buildPermissionModeSessionAcknowledgementScope({
        ownerIdentity: 'workspace-a',
        session: { createdAt: 1, id: 'same-id' }
      })?.storageScopeId
    ).toBe('session:v2:workspace-a:same-id:1')
    expect(
      buildPermissionModeSessionAcknowledgementScope({
        ownerIdentity: 'workspace:a',
        session: { createdAt: 1, id: 'same-id' }
      })?.storageScopeId
    ).not.toBe(
      buildPermissionModeSessionAcknowledgementScope({
        ownerIdentity: 'workspace',
        session: { createdAt: 1, id: 'a:same-id' }
      })?.storageScopeId
    )
    expect(buildPermissionModeSessionAcknowledgementScope({
      ownerIdentity: 'workspace-a',
      session: { createdAt: Number.NaN, id: 'same-id' }
    })).toBeUndefined()
    expect(buildPermissionModeSessionAcknowledgementScope({
      session: { createdAt: 1, id: 'same-id' }
    })).toBeUndefined()

    const legacyHandler: PermissionModeChangeHandler = () => undefined
    const selection = requestPermissionModeChange({ legacyHandler }, 'default')
    expect(selection.result).toBe('selected')
    await expect(selection.completion).resolves.toBe(true)
  })

  it('normalizes and hashes namespace-aware canonical workspace owners', () => {
    expect(stableSha256('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
    const rawWorkspace = '/workspace/private/project'
    const posixOwner = deriveCanonicalPermissionModeOwner({
      workspaceFolder: rawWorkspace
    })
    expect(posixOwner).toMatch(/^workspace:sha256:[a-f0-9]{64}$/)
    expect(posixOwner).not.toContain(rawWorkspace)
    expect(deriveCanonicalPermissionModeOwner({
      workspaceFolder: '/workspace/project/./'
    })).toBe(deriveCanonicalPermissionModeOwner({
      workspaceFolder: '/workspace/project'
    }))
    expect(deriveCanonicalPermissionModeOwner({
      sourceWorkspaceFolder: '/workspace/root',
      workspaceFolder: '../project'
    })).toBe(deriveCanonicalPermissionModeOwner({
      workspaceFolder: '/workspace/project'
    }))
    expect(deriveCanonicalPermissionModeOwner({
      sourceWorkspaceFolder: '/workspace/root',
      workspaceFolder: 'dir\\child'
    })).not.toBe(deriveCanonicalPermissionModeOwner({
      sourceWorkspaceFolder: '/workspace/root',
      workspaceFolder: 'dir/child'
    }))
    expect(deriveCanonicalPermissionModeOwner({
      workspaceFolder: 'C:\\Workspace\\Project'
    })).toBe(deriveCanonicalPermissionModeOwner({
      workspaceFolder: 'c:/workspace/project'
    }))
    expect(deriveCanonicalPermissionModeOwner({
      workspaceFolder: '\\\\server\\share\\project'
    })).not.toBe(deriveCanonicalPermissionModeOwner({
      workspaceFolder: '/server/share/project'
    }))
    expect(deriveCanonicalPermissionModeOwner({
      workspaceFolder: 'relative-only'
    })).toBeUndefined()
    expect(deriveCanonicalPermissionModeOwner({
      workspaceFolder: '../project'
    })).toBeUndefined()

    const scope = buildPermissionModeSessionAcknowledgementScope({
      ownerIdentity: posixOwner,
      session: { createdAt: 1, id: 'private-session' }
    })
    expect(scope?.storageScopeId).not.toContain(rawWorkspace)
  })

  it('retires draft provenance before target storage failures and cleans legacy keys', () => {
    const lifecycle = createDraftPermissionModeLifecycle({
      ownerIdentity: 'workspace:/workspace/a'
    })
    const draftScope = { kind: 'ephemeral' as const, lifecycle }
    expect(acknowledgeHighRiskPermissionMode('bypassPermissions', draftScope, {
      getItem: () => {
        throw new Error('source storage must not be read')
      },
      removeItem: () => {
        throw new Error('source storage must not be removed')
      },
      setItem: () => {
        throw new Error('source storage must not be written')
      }
    })).toBe(true)
    const token = issuePermissionModeDraftCreationToken(lifecycle)
    const target = buildPermissionModeSessionAcknowledgementScope({
      ownerIdentity: 'workspace:/workspace/a',
      session: { createdAt: 1, id: 'created' }
    })!
    const values = new Map<string, string>()
    expect(consumePermissionModeDraftCreationAcknowledgements(token, target, {
      getItem: key => values.get(key) ?? null,
      removeItem: key => values.delete(key),
      setItem: (key, value) => {
        values.set(key, value)
        throw new Error('target write failed')
      }
    })).toBe(false)
    expect([...values.values()]).not.toContain('["bypassPermissions"]')
    expect(consumePermissionModeDraftCreationAcknowledgements(token, target, {
      getItem: key => values.get(key) ?? null,
      removeItem: key => values.delete(key),
      setItem: (key, value) => values.set(key, value)
    })).toBe(false)

    const readFailureLifecycle = createDraftPermissionModeLifecycle({
      ownerIdentity: 'workspace:/workspace/a'
    })
    acknowledgeHighRiskPermissionMode('dontAsk', {
      kind: 'ephemeral',
      lifecycle: readFailureLifecycle
    })
    const readFailureToken = issuePermissionModeDraftCreationToken(readFailureLifecycle)
    expect(consumePermissionModeDraftCreationAcknowledgements(readFailureToken, target, {
      getItem: () => {
        throw new Error('target read failed')
      },
      removeItem: () => undefined,
      setItem: () => undefined
    })).toBe(false)
    expect(consumePermissionModeDraftCreationAcknowledgements(readFailureToken, target, {
      getItem: key => values.get(key) ?? null,
      removeItem: key => values.delete(key),
      setItem: (key, value) => values.set(key, value)
    })).toBe(false)

    const legacyKey = `oneworks_chat_acknowledged_high_risk_permission_modes:${encodeURIComponent('session:created')}`
    values.set(legacyKey, '["bypassPermissions"]')
    expect(hasAcknowledgedHighRiskPermissionMode('bypassPermissions', target, {
      getItem: key => values.get(key) ?? null,
      removeItem: key => values.delete(key),
      setItem: (key, value) => values.set(key, value)
    })).toBe(false)
    expect(values.has(legacyKey)).toBe(false)
  })

  it('consumes owner-mismatched draft provenance without transferring it', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value)
    }
    const lifecycle = createDraftPermissionModeLifecycle({ ownerIdentity: 'owner-a' })
    acknowledgeHighRiskPermissionMode('dontAsk', {
      kind: 'ephemeral',
      lifecycle
    })
    const token = issuePermissionModeDraftCreationToken(lifecycle)
    const ownerB = buildPermissionModeSessionAcknowledgementScope({
      ownerIdentity: 'owner-b',
      session: { createdAt: 1, id: 'created' }
    })!
    const ownerA = buildPermissionModeSessionAcknowledgementScope({
      ownerIdentity: 'owner-a',
      session: { createdAt: 1, id: 'created' }
    })!

    expect(consumePermissionModeDraftCreationAcknowledgements(token, ownerB, storage)).toBe(false)
    expect(consumePermissionModeDraftCreationAcknowledgements(token, ownerA, storage)).toBe(false)
    expect(hasAcknowledgedHighRiskPermissionMode('dontAsk', ownerB, storage)).toBe(false)
    expect(hasAcknowledgedHighRiskPermissionMode('dontAsk', ownerA, storage)).toBe(false)
  })

  it('settles legacy async and guarded signals exactly once', async () => {
    let resolveLegacy: (() => void) | undefined
    const legacyPromise = new Promise<void>((resolve) => {
      resolveLegacy = resolve
    })
    const legacySelection = requestPermissionModeChange(
      {
        legacyHandler: () => legacyPromise
      },
      'default'
    )
    expect(legacySelection.result).toBe('selected')
    resolveLegacy?.()
    await expect(legacySelection.completion).resolves.toBe(true)

    const errors: unknown[] = []
    const rejectedSelection = requestPermissionModeChange(
      {
        legacyHandler: () => Promise.reject(new Error('legacy rejected')),
        onError: error => errors.push(error)
      },
      'default'
    )
    await expect(rejectedSelection.completion).resolves.toBe(false)
    expect(errors).toHaveLength(1)

    const guardedSelection = requestPermissionModeChange(
      {
        requestHandler: () => ({
          accepted: true,
          completion: Promise.resolve(true),
          result: 'selected'
        })
      },
      'default'
    )
    expect(guardedSelection.result).toBe('selected')
    await expect(guardedSelection.completion).resolves.toBe(true)

    let settlePending: ((selected: boolean) => void) | undefined
    const pendingCompletion = new Promise<boolean>((resolve) => {
      settlePending = resolve
    })
    const pendingSelection = requestPermissionModeChange(
      {
        requestHandler: () => ({
          accepted: true,
          completion: pendingCompletion,
          result: 'transition-pending'
        })
      },
      'default'
    )
    expect(pendingSelection.result).toBe('transition-pending')
    settlePending?.(true)
    await expect(pendingSelection.completion).resolves.toBe(true)
  })
})
