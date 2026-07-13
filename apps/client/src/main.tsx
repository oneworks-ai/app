import '@oneworks/route-layout/design-tokens.css'
import '@oneworks/components/route-layout.css'
import './styles/material-symbols-rounded.scss'
import './styles/global.scss'

import { App as AntdApp, ConfigProvider } from 'antd'
import enUS from 'antd/locale/en_US'
import zhCN from 'antd/locale/zh_CN'
import React, { useEffect, useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import { useTranslation } from 'react-i18next'
import { BrowserRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'

import { ApiError, fetchApiJson } from '#~/api/base.js'
import { getLauncherManagerServerBaseUrl } from '#~/api/launcher.js'
import { AppErrorBoundary } from '#~/components/error-state'
import { installHomepagePreviewRuntimeIfEnabled } from '#~/homepage-preview/runtime-loader'
import { setupPwa } from '#~/pwa.js'
import {
  buildWorkspaceClientBase,
  getClientBase,
  mergeRuntimeEnv,
  normalizeServerBaseUrl,
  resolveDevDocumentTitle,
  resolveWorkspaceIdFromPathname
} from '#~/runtime-config.js'
import { setupMobileViewport } from '#~/utils/mobile-viewport.js'

import App from './App'
import { normalizeAppLanguage } from './i18n'
import { getRestorableWorkspaceConnection } from './workspace-connection-restore'
import {
  applyWorkspaceConnection,
  rememberWorkspaceConnection,
  withWorkspaceRouteId
} from './workspace-connection-state'

const gitRefLabel = import.meta.env.__ONEWORKS_PROJECT_GIT_REF_LABEL__ ?? ''

const appTitle = import.meta.env.DEV && gitRefLabel !== ''
  ? `One Works Web [${gitRefLabel}]`
  : 'One Works Web'

document.title = appTitle

const root = createRoot(document.getElementById('root')!)
let appClientBase = getClientBase()

document.title = resolveDevDocumentTitle(document.title, {
  isDev: import.meta.env.DEV,
  gitRef: import.meta.env.__ONEWORKS_PROJECT_DEV_GIT_REF__
})

const installDesktopWorkspaceRuntimeIfAvailable = async () => {
  const connection = await window.oneworksDesktop?.getWorkspaceConnection?.()
    .catch((error) => {
      console.warn('[desktop] failed to load workspace connection', error)
      return undefined
    })
  const serverBaseUrl = normalizeServerBaseUrl(connection?.serverBaseUrl)
  if (serverBaseUrl == null) return

  mergeRuntimeEnv({
    __ONEWORKS_PROJECT_CLIENT_MODE__: 'desktop',
    __ONEWORKS_PROJECT_SERVER_BASE_URL__: serverBaseUrl,
    ...(connection?.workspaceFolder == null
      ? {}
      : { __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: connection.workspaceFolder })
  })
}

const installWorkspaceRouteRuntimeIfAvailable = async () => {
  const workspaceId = resolveWorkspaceIdFromPathname(window.location.pathname)
  if (workspaceId == null) return

  const workspaceClientBase = buildWorkspaceClientBase(workspaceId)
  const initialManagerServerBaseUrl = getLauncherManagerServerBaseUrl()
  mergeRuntimeEnv({
    __ONEWORKS_PROJECT_CLIENT_BASE__: workspaceClientBase,
    __ONEWORKS_PROJECT_MANAGER_SERVER_BASE_URL__: initialManagerServerBaseUrl,
    __ONEWORKS_PROJECT_SERVER_ROLE__: 'workspace',
    __ONEWORKS_PROJECT_WORKSPACE_ID__: workspaceId
  })

  const restoredConnection = await getRestorableWorkspaceConnection(workspaceId)
    .catch((error) => {
      console.warn('[workspace] failed to restore workspace connection', error)
      return undefined
    })
  if (restoredConnection == null) return
  const { connection, transport } = restoredConnection
  const serverBaseUrl = normalizeServerBaseUrl(connection.serverBaseUrl)
  if (serverBaseUrl == null) return
  const managerServerBaseUrl = getLauncherManagerServerBaseUrl(connection.managerServerBaseUrl)
  const routeConnection = withWorkspaceRouteId(connection, workspaceId)

  mergeRuntimeEnv({
    __ONEWORKS_PROJECT_MANAGER_SERVER_BASE_URL__: managerServerBaseUrl
  })
  applyWorkspaceConnection({
    serverBaseUrl,
    workspaceFolder: routeConnection.workspaceFolder,
    workspaceId: routeConnection.workspaceId
  })
  rememberWorkspaceConnection({
    ...routeConnection,
    managerServerBaseUrl,
    serverBaseUrl
  }, transport)
}

const shouldRetryOnError = (error: unknown) => {
  if (!(error instanceof ApiError)) {
    return true
  }
  return error.status == null || ![404, 405, 501].includes(error.status)
}

function AppProviders() {
  const { i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? i18n.language
  const appLanguage = normalizeAppLanguage(language) ?? 'zh'
  const antdLocale = useMemo(() => appLanguage.startsWith('en') ? enUS : zhCN, [appLanguage])

  useEffect(() => {
    document.documentElement.lang = appLanguage === 'zh' ? 'zh-CN' : appLanguage
  }, [appLanguage])

  return (
    <ConfigProvider locale={antdLocale} theme={{ token: { colorPrimary: '#000000' } }}>
      <AntdApp>
        <SWRConfig
          value={{
            fetcher: async (path: string) => fetchApiJson<unknown>(path),
            shouldRetryOnError
          }}
        >
          <BrowserRouter basename={appClientBase}>
            <AppErrorBoundary>
              <App />
            </AppErrorBoundary>
          </BrowserRouter>
        </SWRConfig>
      </AntdApp>
    </ConfigProvider>
  )
}

const renderApp = () => {
  root.render(
    <React.StrictMode>
      <AppProviders />
    </React.StrictMode>
  )
}

const startApp = async () => {
  await installWorkspaceRouteRuntimeIfAvailable()
  await installDesktopWorkspaceRuntimeIfAvailable()
  setupMobileViewport()

  appClientBase = getClientBase()
  setupPwa({
    clientBase: appClientBase,
    isProd: import.meta.env.PROD
  })

  if (__ONEWORKS_PROJECT_HOMEPAGE_PREVIEW__) {
    await installHomepagePreviewRuntimeIfEnabled()
      .catch((error) => {
        console.error('[homepage-preview] failed to install preview runtime', error)
      })
  }

  renderApp()
}

void startApp()
