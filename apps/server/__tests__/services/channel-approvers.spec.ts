import { describe, expect, it } from 'vitest'

import {
  accountApproverPrincipal,
  buildChannelApproverPrincipals,
  isAllowedChannelApprover,
  parseChannelApproverPrincipal
} from '#~/services/channel-authorizations/approvers.js'

describe('channel authorization approvers', () => {
  it('supports colon-bearing issuer keys and rejects a matching raw account from another issuer', () => {
    const allowed = buildChannelApproverPrincipals({
      channelAdmins: ['admin-open-id'],
      issuerKey: 'lark:product-team',
      requesterAccountId: 'ou_requester',
      requesterUserId: 'user-requester'
    })

    expect(allowed).toContain('account:lark:product-team:admin-open-id')
    expect(parseChannelApproverPrincipal('account:lark:product-team:admin-open-id')).toBe(
      'account:lark:product-team:admin-open-id'
    )
    expect(isAllowedChannelApprover({
      accountId: 'admin-open-id',
      allowedApprovers: allowed,
      issuerKey: 'lark:other-team'
    })).toBe(false)
  })

  it('allows a requester to resolve their own typed principal without an admin role', () => {
    const principal = accountApproverPrincipal('lark:product-team', 'ou_requester')
    expect(isAllowedChannelApprover({
      accountId: 'ou_requester',
      allowedApprovers: principal == null ? [] : [principal],
      issuerKey: 'lark:product-team'
    })).toBe(true)
  })

  it('does not let a requester approve another canonical user credential', () => {
    const allowed = buildChannelApproverPrincipals({
      channelAdmins: ['admin-open-id'],
      credentialSubjectUserId: 'user-owner',
      issuerKey: 'lark:product-team',
      requesterAccountId: 'ou_requester',
      requesterUserId: 'user-requester'
    })

    expect(allowed).toEqual(expect.arrayContaining([
      'user:user-owner',
      'account:lark:product-team:admin-open-id'
    ]))
    expect(allowed).not.toEqual(expect.arrayContaining([
      'user:user-requester',
      'account:lark:product-team:ou_requester'
    ]))
  })
})
