import { Button, Checkbox, Form, Input, Typography } from 'antd'
import type { FormInstance, InputRef } from 'antd'
import { useCallback, useState } from 'react'
import type { RefObject } from 'react'

import { AdminIcon } from '../shared/ui/AdminIcon'
import { RegistrationFields } from './RegistrationFields'
import { isRecord } from './accountStorage'
import type { RelayLoginConfig } from './types'

export interface LoginFormValues {
  confirmPassword?: string
  email: string
  inviteCode?: string
  password: string
  rememberAccount: boolean
}

interface RelayCredentialFormProps {
  config: RelayLoginConfig
  finishWithToken: (token: string, user: unknown, authProvider?: string) => void
  form: FormInstance<LoginFormValues>
  passwordRef: RefObject<InputRef>
  rememberAccount: boolean
  onRememberAccountChange: (rememberAccount: boolean) => void
}

const readError = (body: unknown, fallback: string) => (
  isRecord(body) && typeof body.error === 'string' ? body.error : fallback
)

const readErrorCode = (body: unknown) => (
  isRecord(body) && typeof body.code === 'string' ? body.code : undefined
)

class RelayPasswordLoginRequestError extends Error {
  constructor(
    message: string,
    readonly code?: string
  ) {
    super(message)
  }
}

export const RelayCredentialForm = (
  { config, finishWithToken, form, passwordRef, rememberAccount, onRememberAccountChange }: RelayCredentialFormProps
) => {
  const [error, setError] = useState('')
  const [isCompletingInviteRegistration, setIsCompletingInviteRegistration] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const localizeAuthError = useCallback((message: string) => {
    if (message === 'Invalid email or password.') return config.messages.invalidCredentials
    if (message === 'Invite required.') return config.messages.inviteRequired
    if (message === 'Email required.') return config.messages.emailRequired
    if (message === 'Login ID and password are required.') return config.messages.emailRequired
    if (message.startsWith('Password must be at least')) return config.messages.passwordMinLength
    return message
  }, [
    config.messages.emailRequired,
    config.messages.invalidCredentials,
    config.messages.inviteRequired,
    config.messages.passwordMinLength
  ])

  const handlePasswordLogin = useCallback(async (values: LoginFormValues) => {
    const loginId = values.email.trim()
    const password = values.password
    setError('')
    setIsSubmitting(true)
    try {
      const response = await fetch(config.passwordLoginUrl, {
        body: JSON.stringify({ email: loginId, loginId, password }),
        headers: { 'content-type': 'application/json' },
        method: 'POST'
      })
      const body = await response.json().catch(() => ({})) as unknown
      if (!response.ok) {
        throw new RelayPasswordLoginRequestError(
          readError(body, config.messages.invalidCredentials),
          readErrorCode(body)
        )
      }
      if (!isRecord(body) || typeof body.token !== 'string') {
        throw new Error(config.messages.invalidCredentials)
      }
      finishWithToken(body.token, body.user, 'password')
    } catch (loginError) {
      const message = loginError instanceof Error ? loginError.message : String(loginError)
      if (loginError instanceof RelayPasswordLoginRequestError && loginError.code === 'registration_required') {
        form.setFieldsValue({ confirmPassword: undefined, inviteCode: undefined })
        setIsCompletingInviteRegistration(true)
        setError(localizeAuthError(message))
        setIsSubmitting(false)
        return
      }
      setError(localizeAuthError(message))
      setIsSubmitting(false)
    }
  }, [config.messages.invalidCredentials, config.passwordLoginUrl, finishWithToken, form, localizeAuthError])

  const handleInviteRegistration = useCallback(async (values: LoginFormValues) => {
    const loginId = values.email.trim()
    const password = values.password
    const inviteCode = values.inviteCode?.trim() ?? ''
    setError('')
    setIsSubmitting(true)
    try {
      const response = await fetch(config.inviteLoginUrl, {
        body: JSON.stringify({ email: loginId, inviteCode, loginId, password }),
        headers: { 'content-type': 'application/json' },
        method: 'POST'
      })
      const body = await response.json().catch(() => ({})) as unknown
      if (!response.ok) {
        const message = isRecord(body) && typeof body.error === 'string'
          ? body.error
          : config.messages.inviteRequired
        throw new Error(message)
      }
      if (!isRecord(body) || typeof body.token !== 'string') {
        throw new Error(config.messages.inviteRequired)
      }
      finishWithToken(body.token, body.user, 'password')
    } catch (loginError) {
      const message = loginError instanceof Error ? loginError.message : String(loginError)
      setError(localizeAuthError(message))
      setIsSubmitting(false)
    }
  }, [config.inviteLoginUrl, config.messages.inviteRequired, finishWithToken, localizeAuthError])

  const handleSubmit = useCallback(async (values: LoginFormValues) => {
    if (isCompletingInviteRegistration) {
      await handleInviteRegistration(values)
      return
    }
    await handlePasswordLogin(values)
  }, [handleInviteRegistration, handlePasswordLogin, isCompletingInviteRegistration])

  const passwordRules = [
    { message: config.messages.passwordRequired, required: true },
    { message: config.messages.passwordMinLength, min: 8 }
  ]
  const sectionTitle = config.messages.signInWithPassword
  const idleSubmitLabel = config.messages.signInMode
  const submitLabel = isSubmitting ? config.messages.signingIn : idleSubmitLabel

  return (
    <section className='relay-login-app__section relay-login-app__section--auth-method'>
      <Typography.Text className='relay-login-app__section-title'>
        {sectionTitle}
      </Typography.Text>
      <Form
        className='relay-login-app__form'
        form={form}
        layout='vertical'
        requiredMark={false}
        onFinish={handleSubmit}
      >
        <Form.Item name='email' rules={[{ message: config.messages.emailRequired, required: true }]}>
          <Input autoComplete='username' placeholder={config.messages.emailPlaceholder} size='large' />
        </Form.Item>
        <Form.Item name='password' rules={passwordRules}>
          <Input.Password
            ref={passwordRef}
            autoComplete='current-password'
            placeholder={config.messages.passwordPlaceholder}
            size='large'
          />
        </Form.Item>
        {isCompletingInviteRegistration ? <RegistrationFields config={config} /> : null}
        <div className='relay-login-app__remember-row'>
          <Checkbox checked={rememberAccount} onChange={event => onRememberAccountChange(event.target.checked)}>
            {config.messages.rememberAccount}
          </Checkbox>
        </div>
        {error === '' ? null : <Typography.Text className='relay-login-app__error'>{error}</Typography.Text>}
        <Button
          block
          className='relay-login-app__submit'
          htmlType='submit'
          icon={<AdminIcon name='login' />}
          loading={isSubmitting}
          size='large'
          type='primary'
        >
          {submitLabel}
        </Button>
      </Form>
    </section>
  )
}
