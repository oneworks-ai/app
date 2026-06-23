/* eslint-disable max-lines -- auth gate keeps status, login, and desktop startup fallback in one flow. */
import './AuthGate.scss'

import { Button, Checkbox, Form, Input, Spin } from 'antd'
import type { PropsWithChildren } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import { getAuthStatus, login } from '#~/api/auth'
import { setAuthToken } from '#~/api/auth-token'
import { getApiErrorMessage, isApiRequestTimeoutError } from '#~/api/base'
import { AppErrorState, FullscreenErrorState } from '#~/components/error-state'
import {
  isDesktopClientMode,
  isServerConnectionManagedClientMode,
  requestServerConnectionPicker
} from '#~/runtime-config'

const DESKTOP_INITIAL_STATUS_ERROR_GRACE_MS = 10_000

interface LoginFormValues {
  username?: string
  password?: string
  rememberDevice?: boolean
}

export function AuthGate({ children }: PropsWithChildren) {
  const { t } = useTranslation()
  const { data, error, isLoading, isValidating, mutate } = useSWR('/api/auth/status', getAuthStatus)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [initialStatusErrorGraceElapsed, setInitialStatusErrorGraceElapsed] = useState(false)
  const suggestedUsername = data?.usernames[0] ?? 'admin'
  const connectionManagedMode = isServerConnectionManagedClientMode()
  const desktopMode = isDesktopClientMode()
  const hasAuthStatus = data != null
  const shouldKeepInitialStatusLoading = desktopMode &&
    error != null &&
    !hasAuthStatus &&
    !initialStatusErrorGraceElapsed
  const statusErrorDescription = isApiRequestTimeoutError(error)
    ? t('auth.statusTimeout')
    : getApiErrorMessage(error, t('auth.statusFailedHelp'))

  const handleChangeServer = () => {
    requestServerConnectionPicker({ clearCurrentServer: true })
    window.location.reload()
  }

  useEffect(() => {
    if (error == null || hasAuthStatus) {
      return
    }

    const retryDelayMs = isApiRequestTimeoutError(error) ? 1000 : 2500
    const retryTimer = window.setTimeout(() => {
      void mutate()
    }, retryDelayMs)
    return () => window.clearTimeout(retryTimer)
  }, [error, hasAuthStatus, mutate])

  useEffect(() => {
    if (!desktopMode || hasAuthStatus) {
      setInitialStatusErrorGraceElapsed(false)
      return
    }

    const timer = window.setTimeout(() => {
      setInitialStatusErrorGraceElapsed(true)
    }, DESKTOP_INITIAL_STATUS_ERROR_GRACE_MS)
    return () => window.clearTimeout(timer)
  }, [desktopMode, hasAuthStatus])

  if ((isLoading || shouldKeepInitialStatusLoading) && !hasAuthStatus) {
    return (
      <div className='auth-gate auth-gate--loading'>
        <Spin size='large' />
      </div>
    )
  }

  if (error != null && !hasAuthStatus) {
    return (
      <FullscreenErrorState
        actions={[
          {
            kind: 'retry',
            loading: isValidating,
            onClick: () => void mutate()
          },
          ...(connectionManagedMode
            ? [{
              kind: 'changeServer' as const,
              onClick: handleChangeServer
            }]
            : [])
        ]}
        compact
        description={statusErrorDescription}
        details={{
          copyText: statusErrorDescription,
          items: [{ label: t('errorState.diagnostics'), value: statusErrorDescription }],
          title: t('errorState.diagnostics')
        }}
        mobileDescription={statusErrorDescription}
        title={t('auth.statusFailed')}
      />
    )
  }

  if (data == null || !data.enabled || data.authenticated) {
    return children
  }

  const handleFinish = async (values: LoginFormValues) => {
    setSubmitting(true)
    setSubmitError(null)
    try {
      const status = await login({
        username: values.username?.trim() ?? '',
        password: values.password ?? '',
        rememberDevice: values.rememberDevice === true,
        returnToken: connectionManagedMode
      })
      if (status.token != null) {
        setAuthToken(status.token)
      }
      await mutate(status, { revalidate: false })
    } catch (err) {
      setSubmitError(getApiErrorMessage(err, t('auth.loginFailed')))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className='auth-gate'>
      <main className='auth-gate__panel' aria-labelledby='auth-gate-title'>
        <div className='auth-gate__intro'>
          <h1 id='auth-gate-title'>{t('auth.title')}</h1>
          <p>{t('auth.subtitle')}</p>
        </div>

        {submitError != null && (
          <AppErrorState
            className='auth-gate__notice'
            description={submitError}
            focusOnMount={false}
            title={t('auth.loginFailed')}
            variant='inline'
          />
        )}

        <Form
          layout='vertical'
          requiredMark={false}
          initialValues={{ username: suggestedUsername, rememberDevice: true }}
          onFinish={(values: LoginFormValues) => void handleFinish(values)}
        >
          <Form.Item
            name='username'
            label={t('auth.username')}
            rules={[{ required: true, message: t('auth.usernameRequired') }]}
          >
            <Input
              autoComplete='username'
              size='large'
              placeholder={t('auth.usernamePlaceholder')}
            />
          </Form.Item>

          <Form.Item
            name='password'
            label={t('auth.password')}
            rules={[{ required: true, message: t('auth.passwordRequired') }]}
          >
            <Input.Password
              autoComplete='current-password'
              size='large'
              placeholder={t('auth.passwordPlaceholder')}
            />
          </Form.Item>

          <Form.Item name='rememberDevice' valuePropName='checked' className='auth-gate__remember'>
            <Checkbox>{t('auth.rememberDevice')}</Checkbox>
          </Form.Item>

          {data.passwordSource === 'generated' && (
            <p className='auth-gate__hint'>
              {t('auth.generatedPasswordHint', {
                path: data.passwordFilePath ?? '<project-home>/server/data/web-auth-password'
              })}
            </p>
          )}

          <Button
            type='primary'
            htmlType='submit'
            size='large'
            loading={submitting}
            block
          >
            {t('auth.login')}
          </Button>

          {connectionManagedMode && (
            <Button
              className='auth-gate__secondary-action'
              htmlType='button'
              onClick={handleChangeServer}
              block
            >
              {t('auth.changeServer')}
            </Button>
          )}
        </Form>
      </main>
    </div>
  )
}
