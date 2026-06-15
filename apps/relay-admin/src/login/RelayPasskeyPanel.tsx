/* eslint-disable max-lines -- Relay passkey panel keeps WebAuthn ceremony and registration form state together. */
import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON
} from '@simplewebauthn/browser'
import { Button, Checkbox, Form, Input, Typography } from 'antd'
import { useCallback, useEffect, useState } from 'react'

import { AdminIcon } from '../shared/ui/AdminIcon'
import { isRecord } from './accountStorage'
import type { RelayLoginConfig } from './types'

interface RelayPasskeyPanelProps {
  config: RelayLoginConfig
  emailHint?: string
  finishWithToken: (token: string, user: unknown, authProvider?: string) => void
  rememberAccount: boolean
  onRememberAccountChange: (rememberAccount: boolean) => void
}

interface PasskeyFormValues {
  email: string
  inviteCode?: string
  verificationCode?: string
}

type PasskeyStep = 'identify' | 'register'

const readError = (body: unknown, fallback: string) => (
  isRecord(body) && typeof body.error === 'string' ? body.error : fallback
)

const readErrorCode = (body: unknown) => (
  isRecord(body) && typeof body.code === 'string' ? body.code : undefined
)

class RelayLoginRequestError extends Error {
  constructor(
    message: string,
    readonly code?: string
  ) {
    super(message)
  }
}

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

export const RelayPasskeyPanel = (
  { config, emailHint, finishWithToken, rememberAccount, onRememberAccountChange }: RelayPasskeyPanelProps
) => {
  const [form] = Form.useForm<PasskeyFormValues>()
  const [error, setError] = useState('')
  const [isSendingCode, setIsSendingCode] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [step, setStep] = useState<PasskeyStep>('identify')
  const watchedEmail = Form.useWatch('email', form)

  useEffect(() => {
    if (emailHint != null && emailHint !== '') {
      form.setFieldsValue({ email: emailHint })
      setStep('identify')
    }
  }, [emailHint, form])

  const showRegistration = config.passkey.registrationMode !== 'admin_created_only'
  const showInvite = config.passkey.registrationMode === 'invite_required'
  const showEmailVerification = config.passkey.emailVerificationRequired
  const needsRegistrationDetails = showEmailVerification || showInvite
  const canUsePasskey = typeof watchedEmail === 'string' && watchedEmail.trim() !== ''

  const postJson = useCallback(async (url: string, body: Record<string, unknown>) => {
    const response = await fetch(url, {
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    })
    const payload = await response.json().catch(() => ({})) as unknown
    if (!response.ok) {
      throw new RelayLoginRequestError(readError(payload, config.messages.invalidCredentials), readErrorCode(payload))
    }
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
        purpose: 'email-verification'
      })
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : String(sendError)
      setError(localizeError(message, config))
    } finally {
      setIsSendingCode(false)
    }
  }, [config, form, postJson])

  const finishPasskeyAuthentication = useCallback(async (loginId: string) => {
    const optionsPayload = await postJson(config.passkey.loginOptionsUrl, { email: loginId, loginId })
    const optionsJSON = readAuthenticationOptions(optionsPayload, config.messages.invalidCredentials)
    const response = await startAuthentication({ optionsJSON })
    const verifyPayload = await postJson(config.passkey.loginVerifyUrl, { email: loginId, loginId, response })
    const body = requireTokenBody(verifyPayload, config.messages.invalidCredentials)
    finishWithToken(body.token, body.user, 'passkey')
  }, [
    config.messages.invalidCredentials,
    config.passkey.loginOptionsUrl,
    config.passkey.loginVerifyUrl,
    finishWithToken,
    postJson
  ])

  const finishPasskeyRegistration = useCallback(async (values: PasskeyFormValues) => {
    const loginId = values.email.trim()
    const optionsPayload = await postJson(config.passkey.registerOptionsUrl, {
      code: values.verificationCode?.trim() ?? '',
      email: loginId,
      inviteCode: values.inviteCode?.trim() ?? '',
      loginId
    })
    const optionsJSON = readRegistrationOptions(optionsPayload, config.messages.invalidCredentials)
    const response = await startRegistration({ optionsJSON })
    const verifyPayload = await postJson(config.passkey.registerVerifyUrl, {
      email: loginId,
      loginId,
      response
    })
    const body = requireTokenBody(verifyPayload, config.messages.invalidCredentials)
    finishWithToken(body.token, body.user, 'passkey')
  }, [
    config.messages.invalidCredentials,
    config.passkey.registerOptionsUrl,
    config.passkey.registerVerifyUrl,
    finishWithToken,
    postJson
  ])

  const handleUsePasskey = useCallback(async () => {
    setError('')
    setIsSubmitting(true)
    try {
      if (step === 'register') {
        const values = await form.validateFields()
        await finishPasskeyRegistration(values)
        return
      }

      const values = await form.validateFields(['email'])
      const loginId = values.email.trim()
      await finishPasskeyAuthentication(loginId).catch(async authError => {
        if (
          !showRegistration || !(authError instanceof RelayLoginRequestError) ||
          authError.code !== 'passkey_unavailable'
        ) {
          throw authError
        }
        if (needsRegistrationDetails) {
          setStep('register')
          setIsSubmitting(false)
          return
        }
        await finishPasskeyRegistration({ email: loginId })
      })
    } catch (passkeyError) {
      if (step === 'identify') {
        form.setFieldsValue({
          inviteCode: undefined,
          verificationCode: undefined
        })
      }
      const message = passkeyError instanceof Error ? passkeyError.message : String(passkeyError)
      setError(localizeError(message, config))
      setIsSubmitting(false)
    }
  }, [
    config,
    finishPasskeyAuthentication,
    finishPasskeyRegistration,
    form,
    needsRegistrationDetails,
    showRegistration,
    step
  ])

  if (!config.passkey.enabled) return null

  return (
    <section className='relay-login-app__section relay-login-app__section--auth-method relay-login-app__section--passkey'>
      <Typography.Text className='relay-login-app__section-title'>{config.messages.passkeyTitle}</Typography.Text>
      <Form
        className='relay-login-app__form relay-login-app__passkey-form'
        form={form}
        layout='vertical'
        requiredMark={false}
      >
        <div className='relay-login-app__account-stack'>
          <Form.Item
            name='email'
            rules={[{ message: config.messages.emailRequired, required: true }]}
          >
            <Input
              autoComplete='username webauthn'
              disabled={step === 'register'}
              placeholder={config.messages.emailPlaceholder}
              size='large'
            />
          </Form.Item>
          {step === 'register'
            ? (
              <>
                {showEmailVerification
                  ? (
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
                  )
                  : null}
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
              </>
            )
            : null}
          <div className='relay-login-app__remember-row'>
            <Checkbox checked={rememberAccount} onChange={event => onRememberAccountChange(event.target.checked)}>
              {config.messages.rememberAccount}
            </Checkbox>
          </div>
        </div>
        <Button
          block
          className='relay-login-app__submit relay-login-app__passkey-button'
          disabled={!canUsePasskey}
          icon={<AdminIcon name='key' />}
          loading={isSubmitting}
          size='large'
          type='primary'
          onClick={handleUsePasskey}
        >
          {config.messages.useLoginMethodPasskey}
        </Button>
      </Form>
      {error === '' ? null : <Typography.Text className='relay-login-app__error'>{error}</Typography.Text>}
    </section>
  )
}
