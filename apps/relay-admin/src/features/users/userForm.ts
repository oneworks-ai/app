import { readFormText } from '../../shared/forms/readFormText'
import type { CreateUserInput, RelayAdminRole } from '../../shared/model/adminTypes'

export const createUserInputFromFormData = (formData: FormData): CreateUserInput | undefined => {
  const email = readFormText(formData, 'email')
  if (email === '') return undefined
  const password = readFormText(formData, 'password')
  const maxDevicesText = readFormText(formData, 'maxDevices')
  const maxDevices = Number(maxDevicesText)
  return {
    email,
    loginId: readFormText(formData, 'loginId') || null,
    ...(maxDevicesText === '' || !Number.isFinite(maxDevices)
      ? {}
      : { maxDevices: Math.max(0, Math.trunc(maxDevices)) }),
    name: readFormText(formData, 'name'),
    ...(password === '' ? {} : { password }),
    role: readFormText(formData, 'role') as RelayAdminRole
  }
}
