import { Button, Checkbox, Form, Input, Segmented, Typography } from 'antd'
import type { FormInstance, InputRef } from 'antd'
import { useCallback, useState } from 'react'
import type { RefObject } from 'react'

import { AdminIcon } from '../shared/ui/AdminIcon'
import { RegistrationFields } from './RegistrationFields'
import { isRecord } from './accountStorage'
import type { RelayLoginConfig } from './types'

type LoginMode = 'invite' | 'password'

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
}

export const RelayCredentialForm = ({ config, finishWithToken, form, passwordRef }: RelayCredentialFormProps) => {
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [loginMode, setLoginMode] = useState<LoginMode>('password')

  const localizeAuthError = useCallback((message: string) => {
    if (message === 'Invalid email or password.') return config.messages.invalidCredentials
    if (message === 'Invite required.') return config.messages.inviteRequired
    if (message === 'Email required.') return config.messages.emailRequired
    if (message.startsWith('Password must be at least')) return config.messages.passwordMinLength
    return message
  }, [
    config.messages.emailRequired,
    config.messages.invalidCredentials,
    config.messages.inviteRequired,
    config.messages.passwordMinLength
  ])

  const handlePasswordLogin = useCallback(async (values: LoginFormValues) => {
    const email = values.email.trim()
    const password = values.password
    setError('')
    setIsSubmitting(true)
    try {
      const response = await fetch(config.passwordLoginUrl, {
        body: JSON.stringify({ email, password }),
        headers: { 'content-type': 'application/json' },
        method: 'POST'
      })
      const body = await response.json().catch(() => ({})) as unknown
      if (!response.ok) {
        const message = isRecord(body) && typeof body.error === 'string'
          ? body.error
          : config.messages.invalidCredentials
        throw new Error(message)
      }
      if (!isRecord(body) || typeof body.token !== 'string') {
        throw new Error(config.messages.invalidCredentials)
      }
      finishWithToken(body.token, body.user, 'password')
    } catch (loginError) {
      const message = loginError instanceof Error ? loginError.message : String(loginError)
      setError(localizeAuthError(message))
      setIsSubmitting(false)
    }
  }, [config.messages.invalidCredentials, config.passwordLoginUrl, finishWithToken, localizeAuthError])

  const handleInviteRegistration = useCallback(async (values: LoginFormValues) => {
    const email = values.email.trim()
    const password = values.password
    const inviteCode = values.inviteCode?.trim() ?? ''
    setError('')
    setIsSubmitting(true)
    try {
      const response = await fetch(config.inviteLoginUrl, {
        body: JSON.stringify({ email, inviteCode, password }),
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
    if (loginMode === 'invite') {
      await handleInviteRegistration(values)
      return
    }
    await handlePasswordLogin(values)
  }, [handleInviteRegistration, handlePasswordLogin, loginMode])

  const updateLoginMode = useCallback((value: string | number) => {
    setLoginMode(value === 'invite' ? 'invite' : 'password')
    setError('')
  }, [])

  const passwordRules = [
    { message: config.messages.passwordRequired, required: true },
    { message: config.messages.passwordMinLength, min: 8 }
  ]
  const sectionTitle = loginMode === 'invite' ? config.messages.registerWithInvite : config.messages.signInWithPassword
  const idleSubmitLabel = loginMode === 'invite'
    ? config.messages.continueWithRegistration
    : config.messages.continueWithPassword
  const submitLabel = isSubmitting ? config.messages.signingIn : idleSubmitLabel
  const submitIconName = loginMode === 'invite' ? 'add' : 'login'

  return (
    <section className='relay-login-app__section'>
      <Typography.Text className='relay-login-app__section-title'>
        {sectionTitle}
      </Typography.Text>
      <Segmented
        block
        className='relay-login-app__mode'
        options={[
          { label: config.messages.signInMode, value: 'password' },
          { label: config.messages.registerWithInvite, value: 'invite' }
        ]}
        value={loginMode}
        onChange={updateLoginMode}
      />
      <Form
        className='relay-login-app__form'
        form={form}
        initialValues={{ rememberAccount: true }}
        layout='vertical'
        requiredMark={false}
        onFinish={handleSubmit}
      >
        <Form.Item name='email' rules={[{ message: config.messages.emailRequired, required: true, type: 'email' }]}>
          <Input autoComplete='email' inputMode='email' placeholder={config.messages.emailPlaceholder} size='large' />
        </Form.Item>
        <Form.Item name='password' rules={passwordRules}>
          <Input.Password
            ref={passwordRef}
            autoComplete={loginMode === 'invite' ? 'new-password' : 'current-password'}
            placeholder={config.messages.passwordPlaceholder}
            size='large'
          />
        </Form.Item>
        {loginMode === 'invite' ? <RegistrationFields config={config} /> : null}
        <Form.Item className='relay-login-app__remember-item' name='rememberAccount' valuePropName='checked'>
          <Checkbox>{config.messages.rememberAccount}</Checkbox>
        </Form.Item>
        {error === '' ? null : <Typography.Text className='relay-login-app__error'>{error}</Typography.Text>}
        <Button
          block
          className='relay-login-app__submit'
          htmlType='submit'
          icon={<AdminIcon name={submitIconName} />}
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
