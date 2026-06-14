/* eslint-disable max-lines -- Relay passkey panel keeps WebAuthn ceremony and registration form state together. */
import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON
} from '@simplewebauthn/browser'
import { Button, Form, Input, Typography } from 'antd'
import { useCallback, useEffect, useState } from 'react'

import { AdminIcon } from '../shared/ui/AdminIcon'
import { isRecord } from './accountStorage'
import type { RelayLoginConfig } from './types'

interface RelayPasskeyPanelProps {
  config: RelayLoginConfig
  emailHint?: string
  finishWithToken: (token: string, user: unknown, authProvider?: string) => void
}

interface PasskeyFormValues {
  credentialName?: string
  email: string
  inviteCode?: string
  verificationCode?: string
}

const readError = (body: unknown, fallback: string) => (
  isRecord(body) && typeof body.error === 'string' ? body.error : fallback
)

interface RelayTokenResponse {
  token: string
  user: unknown
}

const requireTokenBody = (body: unknown, fallback: string): RelayTokenResponse => {
  if (!isRecord(body) || typeof body.token !== 'string') throw new Error(fallback)
  return {
    token: body.token,
    user: body.user
  }
}

const readAuthenticationOptions = (body: unknown, fallback: string): PublicKeyCredentialRequestOptionsJSON => {
  const options = isRecord(body) ? body.options : undefined
  if (!isRecord(options) || typeof options.challenge !== 'string') throw new Error(fallback)
  return options as unknown as PublicKeyCredentialRequestOptionsJSON
}

const readRegistrationOptions = (body: unknown, fallback: string): PublicKeyCredentialCreationOptionsJSON => {
  const options = isRecord(body) ? body.options : undefined
  if (!isRecord(options) || typeof options.challenge !== 'string') throw new Error(fallback)
  return options as unknown as PublicKeyCredentialCreationOptionsJSON
}

const localizeError = (message: string, config: RelayLoginConfig) => {
  if (message === 'Email required.') return config.messages.emailRequired
  if (message === 'Invite required.') return config.messages.inviteRequired
  if (message === 'Invalid verification code.') return config.messages.invalidCredentials
  if (message === 'Invalid email or passkey.') return config.messages.invalidCredentials
  return message
}

export const RelayPasskeyPanel = ({ config, emailHint, finishWithToken }: RelayPasskeyPanelProps) => {
  const [form] = Form.useForm<PasskeyFormValues>()
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

  const handlePasskeySignIn = useCallback(async () => {
    const email = form.getFieldValue('email')?.trim() ?? ''
    setError('')
    setIsSubmitting(true)
    try {
      await form.validateFields(['email'])
      const optionsPayload = await postJson(config.passkey.loginOptionsUrl, { email })
      const optionsJSON = readAuthenticationOptions(optionsPayload, config.messages.invalidCredentials)
      const response = await startAuthentication({ optionsJSON })
      const verifyPayload = await postJson(config.passkey.loginVerifyUrl, { email, response })
      const body = requireTokenBody(verifyPayload, config.messages.invalidCredentials)
      finishWithToken(body.token, body.user, 'passkey')
    } catch (passkeyError) {
      const message = passkeyError instanceof Error ? passkeyError.message : String(passkeyError)
      setError(localizeError(message, config))
      setIsSubmitting(false)
    }
  }, [config, finishWithToken, form, postJson])

  const handleSendCode = useCallback(async () => {
    const email = form.getFieldValue('email')?.trim() ?? ''
    setError('')
    setIsSendingCode(true)
    try {
      await form.validateFields(['email'])
      await postJson(config.emailVerificationSendUrl, {
        email,
        locale: config.locale,
        purpose: 'email-verification'
      })
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : String(sendError)
      setError(localizeError(message, config))
    } finally {
      setIsSendingCode(false)
    }
  }, [config, form, postJson])

  const handlePasskeyRegistration = useCallback(async () => {
    setError('')
    setIsSubmitting(true)
    try {
      const values = await form.validateFields()
      const email = values.email.trim()
      const optionsPayload = await postJson(config.passkey.registerOptionsUrl, {
        code: values.verificationCode?.trim() ?? '',
        credentialName: values.credentialName?.trim() ?? '',
        email,
        inviteCode: values.inviteCode?.trim() ?? ''
      })
      const optionsJSON = readRegistrationOptions(optionsPayload, config.messages.invalidCredentials)
      const response = await startRegistration({ optionsJSON })
      const verifyPayload = await postJson(config.passkey.registerVerifyUrl, {
        credentialName: values.credentialName?.trim() ?? '',
        email,
        response
      })
      const body = requireTokenBody(verifyPayload, config.messages.invalidCredentials)
      finishWithToken(body.token, body.user, 'passkey')
    } catch (passkeyError) {
      const message = passkeyError instanceof Error ? passkeyError.message : String(passkeyError)
      setError(localizeError(message, config))
      setIsSubmitting(false)
    }
  }, [config, finishWithToken, form, postJson])

  if (!config.passkey.enabled) return null

  const showRegistration = config.passkey.registrationMode !== 'admin_created_only'
  const showInvite = config.passkey.registrationMode === 'invite_required'

  return (
    <section className='relay-login-app__section relay-login-app__section--passkey'>
      <Typography.Text className='relay-login-app__section-title'>{config.messages.passkeyTitle}</Typography.Text>
      <Form
        className='relay-login-app__form relay-login-app__passkey-form'
        form={form}
        layout='vertical'
        requiredMark={false}
      >
        <Form.Item name='email' rules={[{ message: config.messages.emailRequired, required: true, type: 'email' }]}>
          <Input
            autoComplete='email webauthn'
            inputMode='email'
            placeholder={config.messages.emailPlaceholder}
            size='large'
          />
        </Form.Item>
        <Button
          block
          className='relay-login-app__submit relay-login-app__passkey-button'
          icon={<AdminIcon name='key' />}
          loading={isSubmitting}
          size='large'
          onClick={handlePasskeySignIn}
        >
          {config.messages.passkeySignIn}
        </Button>
        {showRegistration
          ? (
            <div className='relay-login-app__passkey-register'>
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
              {showInvite
                ? (
                  <Form.Item name='inviteCode' rules={[{ message: config.messages.inviteRequired, required: true }]}>
                    <Input
                      autoComplete='one-time-code'
                      placeholder={config.messages.inviteCodePlaceholder}
                      size='large'
                    />
                  </Form.Item>
                )
                : null}
              <Form.Item name='credentialName'>
                <Input autoComplete='off' placeholder={config.messages.passkeyNamePlaceholder} size='large' />
              </Form.Item>
              <Button
                block
                className='relay-login-app__submit'
                icon={<AdminIcon name='add' />}
                loading={isSubmitting}
                size='large'
                type='primary'
                onClick={handlePasskeyRegistration}
              >
                {config.messages.passkeyRegister}
              </Button>
            </div>
          )
          : null}
      </Form>
      {error === '' ? null : <Typography.Text className='relay-login-app__error'>{error}</Typography.Text>}
    </section>
  )
}
