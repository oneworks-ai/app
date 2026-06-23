import './ServerConnectionGate.scss'

import { Button, Form } from 'antd'
import type { PropsWithChildren } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AppErrorState } from '#~/components/error-state'
import { isHomepagePreviewRuntimeEnabled } from '#~/homepage-preview/mock-runtime'
import {
  clearServerConnectionPickerRequest,
  getConfiguredServerBaseUrl,
  getStoredServerBaseUrl,
  isDesktopClientMode,
  isServerConnectionManagedClientMode,
  isServerConnectionPickerRequested,
  normalizeServerBaseUrl,
  setStoredServerBaseUrl
} from '#~/runtime-config'
import {
  getServerConnectionProfiles,
  rememberServerBaseUrl,
  updateServerConnectionProfile
} from '#~/server-connection-history'

import { ServerConnectionProfiles } from './ServerConnectionProfiles'
import {
  DEFAULT_SERVER_HOST,
  DEFAULT_SERVER_SCHEME,
  ServerConnectionUrlInput,
  buildServerUrl,
  normalizeServerUrlField
} from './ServerConnectionUrlInput'
import type { ServerConnectionFormValues } from './ServerConnectionUrlInput'
import { PWA_DOCS_URL, UnsupportedServerVersionError, pingServer } from './server-connection-status'

export function ServerConnectionGate({ children }: PropsWithChildren) {
  const { t } = useTranslation()
  const connectionManagedMode = isServerConnectionManagedClientMode()
  const desktopMode = isDesktopClientMode()
  const configuredServerUrl = getConfiguredServerBaseUrl()
  const pickerRequested = isServerConnectionPickerRequested()
  const [form] = Form.useForm<ServerConnectionFormValues>()
  const [connectedServerUrl, setConnectedServerUrl] = useState(() => desktopMode ? undefined : getStoredServerBaseUrl())
  const [connectionProfiles, setConnectionProfiles] = useState(() => getServerConnectionProfiles())
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const homepagePreviewRuntime = isHomepagePreviewRuntimeEnabled()

  useEffect(() => {
    if (configuredServerUrl == null) return
    setConnectionProfiles((profiles) => {
      if (profiles.some(profile => profile.serverUrl === configuredServerUrl)) {
        return profiles
      }

      const rememberedProfiles = rememberServerBaseUrl(configuredServerUrl)
      if (!desktopMode) {
        return rememberedProfiles
      }

      return updateServerConnectionProfile(configuredServerUrl, {
        alias: t('serverConnection.localServiceAlias'),
        description: t('serverConnection.localServiceProfileDescription')
      })
    })
  }, [configuredServerUrl, desktopMode, t])

  if (
    homepagePreviewRuntime ||
    !connectionManagedMode ||
    (!pickerRequested && (connectedServerUrl != null || configuredServerUrl != null))
  ) {
    return children
  }

  const connectToServer = async (serverUrl: string) => {
    setSubmitting(true)
    setSubmitError(null)
    try {
      const normalizedServerUrl = normalizeServerBaseUrl(serverUrl)
      if (normalizedServerUrl == null) {
        setSubmitError(t('serverConnection.invalidUrl'))
        return
      }

      const publicStatus = await pingServer(normalizedServerUrl)
      const storedServerUrl = setStoredServerBaseUrl(normalizedServerUrl)
      if (storedServerUrl == null) {
        setSubmitError(t('serverConnection.invalidUrl'))
        return
      }
      clearServerConnectionPickerRequest()
      setConnectionProfiles(rememberServerBaseUrl(storedServerUrl, { serverVersion: publicStatus.version }))
      setConnectedServerUrl(storedServerUrl)
    } catch (err) {
      if (err instanceof UnsupportedServerVersionError) {
        setSubmitError(t('serverConnection.unsupportedServerVersion', {
          clientVersion: err.clientVersion,
          serverVersion: err.serverVersion ?? t('serverConnection.serverVersionUnknown')
        }))
      } else {
        setSubmitError(t('serverConnection.connectionFailed'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleFinish = async (values: ServerConnectionFormValues) => {
    normalizeServerUrlField(form)
    await connectToServer(buildServerUrl(values))
  }

  const handleProfileConnect = (serverUrl: string) => {
    void connectToServer(serverUrl)
  }

  return (
    <div className='server-connection-gate'>
      <main className='server-connection-gate__panel' aria-labelledby='server-connection-title'>
        <div className='server-connection-gate__intro'>
          <h1 id='server-connection-title'>
            {desktopMode ? t('serverConnection.desktopTitle') : t('serverConnection.title')}
          </h1>
          <p>{desktopMode ? t('serverConnection.desktopSubtitle') : t('serverConnection.subtitle')}</p>
        </div>

        {desktopMode
          ? configuredServerUrl != null && (
            <div className='server-connection-gate__setup'>
              <div className='server-connection-gate__setup-title'>
                <span className='material-symbols-rounded'>computer</span>
                <span>{t('serverConnection.localServiceTitle')}</span>
              </div>
              <code>{configuredServerUrl}</code>
              <p>{t('serverConnection.localServiceBannerDescription')}</p>
            </div>
          )
          : (
            <div className='server-connection-gate__setup'>
              <div className='server-connection-gate__setup-title'>
                <span className='material-symbols-rounded'>terminal</span>
                <span>{t('serverConnection.setupTitle')}</span>
              </div>
              <code>npx oneworks server --allow-cors</code>
              <p>
                {t('serverConnection.setupDescription')}
                <a href={PWA_DOCS_URL} target='_blank' rel='noreferrer'>
                  {t('serverConnection.docsLink')}
                </a>
              </p>
            </div>
          )}

        {submitError != null && (
          <AppErrorState
            className='server-connection-gate__notice'
            description={submitError}
            details={{
              copyText: submitError,
              items: [{
                label: t('serverConnection.serverUrl'),
                mono: true,
                value: String(form.getFieldValue('serverUrl') ?? '')
              }],
              title: t('errorState.diagnostics')
            }}
            focusOnMount={false}
            title={t('errorState.connectionIssueTitle')}
            variant='inline'
          />
        )}

        <Form
          form={form}
          layout='vertical'
          requiredMark={false}
          initialValues={{
            serverScheme: DEFAULT_SERVER_SCHEME,
            serverUrl: DEFAULT_SERVER_HOST
          }}
          onFinish={(values: ServerConnectionFormValues) => void handleFinish(values)}
        >
          <Form.Item
            name='serverUrl'
            label={t('serverConnection.serverUrl')}
            rules={[{ required: true, message: t('serverConnection.serverUrlRequired') }]}
          >
            <ServerConnectionUrlInput form={form} />
          </Form.Item>

          <ServerConnectionProfiles
            profiles={connectionProfiles}
            submitting={submitting}
            onConnect={handleProfileConnect}
            onProfilesChange={setConnectionProfiles}
          />

          <Button
            type='primary'
            htmlType='submit'
            size='large'
            loading={submitting}
            icon={<span className='material-symbols-rounded'>link</span>}
            block
          >
            {t('serverConnection.connect')}
          </Button>
        </Form>
      </main>
    </div>
  )
}
