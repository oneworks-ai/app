import { readFormText } from '../../shared/forms/readFormText'
import type {
  CreateSsoProviderInput,
  RelayAdminSsoProvider,
  RelayAdminSsoProviderType,
  UpdateSsoProviderInput
} from '../../shared/model/adminTypes'

const DEFAULT_SCOPE = 'openid email profile'
const ssoProviderTypes = new Set<RelayAdminSsoProviderType>(['oauth2', 'oidc'])

const readProviderType = (formData: FormData) => {
  const type = readFormText(formData, 'type').toLowerCase()
  return ssoProviderTypes.has(type as RelayAdminSsoProviderType) ? type as RelayAdminSsoProviderType : 'oidc'
}

const readEnabled = (formData: FormData) => formData.get('enabled') === 'on'

export const createSsoProviderInputFromFormData = (formData: FormData): CreateSsoProviderInput | undefined => {
  const id = readFormText(formData, 'id').toLowerCase()
  const name = readFormText(formData, 'name')
  const clientId = readFormText(formData, 'clientId')
  const clientSecret = readFormText(formData, 'clientSecret')
  const authorizationUrl = readFormText(formData, 'authorizationUrl')
  const tokenUrl = readFormText(formData, 'tokenUrl')
  const userInfoUrl = readFormText(formData, 'userInfoUrl')
  if (
    id === '' ||
    name === '' ||
    clientId === '' ||
    clientSecret === '' ||
    authorizationUrl === '' ||
    tokenUrl === '' ||
    userInfoUrl === ''
  ) {
    return undefined
  }
  return {
    id,
    name,
    type: readProviderType(formData),
    authorizationUrl,
    tokenUrl,
    userInfoUrl,
    scope: readFormText(formData, 'scope') || DEFAULT_SCOPE,
    enabled: readEnabled(formData),
    clientId,
    clientSecret
  }
}

export const updateSsoProviderInputFromFormData = (
  provider: RelayAdminSsoProvider,
  formData: FormData
): UpdateSsoProviderInput | undefined => {
  const name = readFormText(formData, 'name')
  const clientId = readFormText(formData, 'clientId')
  const authorizationUrl = readFormText(formData, 'authorizationUrl')
  const tokenUrl = readFormText(formData, 'tokenUrl')
  const userInfoUrl = readFormText(formData, 'userInfoUrl')
  if (name === '' || clientId === '' || authorizationUrl === '' || tokenUrl === '' || userInfoUrl === '') {
    return undefined
  }
  const clientSecret = readFormText(formData, 'clientSecret')
  return {
    id: provider.id,
    name,
    type: readProviderType(formData),
    authorizationUrl,
    tokenUrl,
    userInfoUrl,
    scope: readFormText(formData, 'scope') || DEFAULT_SCOPE,
    enabled: readEnabled(formData),
    clientId,
    ...(clientSecret === '' ? {} : { clientSecret })
  }
}
