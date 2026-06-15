import { Button } from 'antd'

import { AdminIcon } from '../shared/ui/AdminIcon'
import type { AdminIconName } from '../shared/ui/AdminIcon'
import type { RelayLoginConfig, RelayLoginMethod } from './types'

interface RelayLoginMethodSwitcherProps {
  activeMethod: RelayLoginMethod
  config: RelayLoginConfig
  enabledMethods: RelayLoginMethod[]
  onChange: (method: RelayLoginMethod) => void
}

const labelForLoginMethod = (config: RelayLoginConfig, method: RelayLoginMethod) => {
  if (method === 'passkey') return config.messages.useLoginMethodPasskey
  if (method === 'verification_code') return config.messages.useLoginMethodVerificationCode
  return config.messages.useLoginMethodPassword
}

const iconForLoginMethod = (method: RelayLoginMethod): AdminIconName => {
  if (method === 'passkey') return 'key'
  if (method === 'verification_code') return 'fact_check'
  return 'login'
}

export const RelayLoginMethodSwitcher = (
  { activeMethod, config, enabledMethods, onChange }: RelayLoginMethodSwitcherProps
) => {
  const options = enabledMethods.filter(method => method !== activeMethod)

  if (options.length === 0) return null

  return (
    <section className='relay-login-app__method-switcher'>
      <div className='relay-login-app__method-switch-list'>
        {options.map(method => (
          <Button
            key={method}
            className='relay-login-app__method-switch-button'
            icon={<AdminIcon name={iconForLoginMethod(method)} />}
            size='small'
            type='text'
            onClick={() => onChange(method)}
          >
            {labelForLoginMethod(config, method)}
          </Button>
        ))}
      </div>
    </section>
  )
}
