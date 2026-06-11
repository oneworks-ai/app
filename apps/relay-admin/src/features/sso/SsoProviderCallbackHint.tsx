import { useMemo } from 'react'

import { buildSsoProviderCallbackUrl } from './ssoProviderPresets'

export interface SsoProviderCallbackHintProps {
  providerId: string
}

const readAdminOrigin = () => (
  typeof window === 'undefined' ? '' : window.location.origin
)

export const SsoProviderCallbackHint = ({ providerId }: SsoProviderCallbackHintProps) => {
  const callbackUrl = useMemo(
    () => buildSsoProviderCallbackUrl(readAdminOrigin(), providerId),
    [providerId]
  )

  if (callbackUrl === '') return null

  return (
    <div className='relay-sso-panel__callback-hint'>
      <span>Redirect URI</span>
      <code>{callbackUrl}</code>
    </div>
  )
}
