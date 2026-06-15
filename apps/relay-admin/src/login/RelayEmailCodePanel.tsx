import { Button, Checkbox, Form, Input, Typography } from 'antd'
import { useCallback, useEffect, useState } from 'react'

import { AdminIcon } from '../shared/ui/AdminIcon'
import { isRecord } from './accountStorage'
import type { RelayLoginConfig } from './types'

interface RelayEmailCodePanelProps {
  config: RelayLoginConfig
  emailHint?: string
  finishWithToken: (token: string, user: unknown, authProvider?: string) => void
  rememberAccount: boolean
  onRememberAccountChange: (rememberAccount: boolean) => void
}

interface EmailCodeFormValues {
  email: string
  verificationCode?: string
}

const readError = (body: unknown, fallback: string) => (
  isRecord(body) && typeof body.error === 'string' ? body.error : fallback
)

const localizeError = (message: string, config: RelayLoginConfig) => {
  if (message === 'Email required.') return config.messages.emailRequired
  if (message === 'Invalid email or verification code.') return config.messages.invalidCredentials
  return message
}

export const RelayEmailCodePanel = (
  { config, emailHint, finishWithToken, rememberAccount, onRememberAccountChange }: RelayEmailCodePanelProps
) => {
  const [form] = Form.useForm<EmailCodeFormValues>()
  const [error, setError] = useState('')
  const [isSendingCode, setIsSendingCode] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (emailHint != null && emailHint !== '') form.setFieldsValue({ email: emailHint })
  }, [emailHint, form])

  const postJson = useCallback(async (url: string, body: Record<string, unknown>) => {
    const response = await fetch(url, {
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    })
    const payload = await response.json().catch(() => ({})) as unknown
    if (!response.ok) throw new Error(readError(payload, config.messages.invalidCredentials))
    return payload
  }, [config.messages.invalidCredentials])

  const handleSendCode = useCallback(async () => {
    const loginId = form.getFieldValue('email')?.trim() ?? ''
    setError('')
    setIsSendingCode(true)
    try {
      await form.validateFields(['email'])
      await postJson(config.emailVerificationSendUrl, {
        email: loginId,
        loginId,
        locale: config.locale,
        purpose: 'login'
      })
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : String(sendError)
      setError(localizeError(message, config))
    } finally {
      setIsSendingCode(false)
    }
  }, [config, form, postJson])

  const handleSubmit = useCallback(async (values: EmailCodeFormValues) => {
    setError('')
    setIsSubmitting(true)
    try {
      const loginId = values.email.trim()
      const payload = await postJson(config.emailCodeLoginUrl, {
        code: values.verificationCode?.trim() ?? '',
        email: loginId,
        loginId
      })
      if (!isRecord(payload) || typeof payload.token !== 'string') {
        throw new Error(config.messages.invalidCredentials)
      }
      finishWithToken(payload.token, payload.user, 'verification_code')
    } catch (loginError) {
      const message = loginError instanceof Error ? loginError.message : String(loginError)
      setError(localizeError(message, config))
      setIsSubmitting(false)
    }
  }, [config, finishWithToken, postJson])

  return (
    <section className='relay-login-app__section relay-login-app__section--auth-method'>
      <Typography.Text className='relay-login-app__section-title'>
        {config.messages.verificationCodeSignIn}
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
        <div className='relay-login-app__passkey-code-row'>
          <Form.Item
            name='verificationCode'
            rules={[{ message: config.messages.passkeyCodePlaceholder, required: true }]}
          >
            <Input
              autoComplete='one-time-code'
              inputMode='numeric'
              maxLength={6}
              placeholder={config.messages.passkeyCodePlaceholder}
              size='large'
            />
          </Form.Item>
          <Button loading={isSendingCode} size='large' onClick={handleSendCode}>
            {config.messages.passkeySendCode}
          </Button>
        </div>
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
          icon={<AdminIcon name='fact_check' />}
          loading={isSubmitting}
          size='large'
          type='primary'
        >
          {isSubmitting ? config.messages.signingIn : config.messages.signInMode}
        </Button>
      </Form>
    </section>
  )
}
