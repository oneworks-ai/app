import { readFormText } from '../../shared/forms/readFormText'
import type { CreateInviteInput, RelayAdminRole } from '../../shared/model/adminTypes'

export const createInviteInputFromFormData = (formData: FormData): CreateInviteInput => ({
  code: readFormText(formData, 'code') || undefined,
  maxUses: Math.max(1, Number(readFormText(formData, 'maxUses') || '1')),
  role: readFormText(formData, 'role') as RelayAdminRole,
  userId: readFormText(formData, 'userId') || undefined
})
