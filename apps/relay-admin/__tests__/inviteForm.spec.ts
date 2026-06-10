import { describe, expect, it } from 'vitest'

import { createInviteInputFromFormData } from '../src/features/invites/inviteForm'
import { formDataOf } from './helpers'

describe('createInviteInputFromFormData', () => {
  it('normalizes invite form fields', () => {
    expect(createInviteInputFromFormData(formDataOf({
      code: ' team-alpha ',
      maxUses: '3',
      role: 'member',
      userId: ' user-1 '
    }))).toEqual({
      code: 'team-alpha',
      maxUses: 3,
      role: 'member',
      userId: 'user-1'
    })
  })

  it('defaults blank optional fields and clamps max uses', () => {
    expect(createInviteInputFromFormData(formDataOf({
      code: ' ',
      maxUses: '0',
      role: 'viewer',
      userId: ''
    }))).toEqual({
      code: undefined,
      maxUses: 1,
      role: 'viewer',
      userId: undefined
    })
  })
})
