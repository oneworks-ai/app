import { describe, expect, it } from 'vitest'

import { createUserInputFromFormData } from '../src/features/users/userForm'
import { formDataOf } from './helpers'

describe('createUserInputFromFormData', () => {
  it('trims user form fields', () => {
    expect(createUserInputFromFormData(formDataOf({
      email: ' admin@example.com ',
      name: ' Admin ',
      password: ' secret-password ',
      role: 'admin'
    }))).toEqual({
      email: 'admin@example.com',
      loginId: null,
      name: 'Admin',
      password: 'secret-password',
      role: 'admin'
    })
  })

  it('returns undefined when email is empty', () => {
    expect(createUserInputFromFormData(formDataOf({
      email: ' ',
      role: 'member'
    }))).toBeUndefined()
  })
})
