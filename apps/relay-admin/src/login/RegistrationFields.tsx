import { Form, Input } from 'antd'
import type { Rule } from 'antd/es/form'

import type { RelayLoginConfig } from './types'

interface RegistrationFieldsProps {
  config: RelayLoginConfig
}

export const RegistrationFields = ({ config }: RegistrationFieldsProps) => {
  const confirmPasswordRules: Rule[] = [
    { message: config.messages.confirmPasswordRequired, required: true },
    ({ getFieldValue }) => ({
      validator(_: unknown, value: string | undefined) {
        if (value == null || value === '' || getFieldValue('password') === value) {
          return Promise.resolve()
        }
        return Promise.reject(new Error(config.messages.passwordMismatch))
      }
    })
  ]

  return (
    <>
      <Form.Item dependencies={['password']} name='confirmPassword' rules={confirmPasswordRules}>
        <Input.Password
          autoComplete='new-password'
          placeholder={config.messages.confirmPasswordPlaceholder}
          size='large'
        />
      </Form.Item>
      <Form.Item name='inviteCode' rules={[{ message: config.messages.inviteRequired, required: true }]}>
        <Input autoComplete='one-time-code' placeholder={config.messages.inviteCodePlaceholder} size='large' />
      </Form.Item>
    </>
  )
}
