import 'antd/dist/reset.css'
import '@oneworks/route-layout/design-tokens.css'
import './RelayLoginApp.css'

import { App as AntdApp, ConfigProvider, theme } from 'antd'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { RelayLoginApp } from './RelayLoginApp'
import type { RelayLoginConfig, RelayRememberedAccount } from './types'

declare global {
  interface Window {
    __relayLoginConfig?: RelayLoginConfig
    __relayLoginRedirectUri?: string
    __relayLoginStoreAccount?: (account: RelayRememberedAccount) => void
  }
}

const ADMIN_PRIMARY_COLOR = '#E23F12'

const readLoginConfig = (): RelayLoginConfig | undefined => {
  const script = document.querySelector<HTMLScriptElement>('#relay-login-config')
  const rawConfig = script?.textContent?.trim()
  if (!rawConfig) return undefined
  try {
    return JSON.parse(rawConfig) as RelayLoginConfig
  } catch {
    return undefined
  }
}

const root = document.querySelector('#relay-login-root')
const config = readLoginConfig()

if (root != null && config != null) {
  window.__relayLoginConfig = config
  createRoot(root).render(
    <StrictMode>
      <ConfigProvider
        theme={{
          algorithm: theme.defaultAlgorithm,
          token: {
            borderRadius: 6,
            colorPrimary: ADMIN_PRIMARY_COLOR,
            fontFamily: 'inherit'
          }
        }}
      >
        <AntdApp>
          <RelayLoginApp config={config} />
        </AntdApp>
      </ConfigProvider>
    </StrictMode>
  )
}
