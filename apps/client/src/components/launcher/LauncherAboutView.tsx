import './LauncherAboutView.scss'

import { useCallback, useEffect, useRef, useState } from 'react'

import type { AboutInfo } from '@oneworks/types'

import type { AuthStatus } from '#~/api/auth'
import { getLauncherAuthStatus } from '#~/api/launcher'
import { AboutSection } from '#~/components/config'
import type { AboutServerStatus } from '#~/components/config/ConfigAboutSection'

const launcherAboutUrls: NonNullable<AboutInfo['urls']> = {
  contact: 'https://github.com/oneworks-ai/app/discussions',
  docs: 'https://oneworks.cloud/docs/',
  issues: 'https://github.com/oneworks-ai/app/issues',
  releases: 'https://github.com/oneworks-ai/app/releases',
  repo: 'https://github.com/oneworks-ai/app'
}

interface LauncherAboutState {
  authStatus?: AuthStatus
  status: AboutServerStatus
}

export function LauncherAboutView({
  loadServerInfo = getLauncherAuthStatus
}: {
  loadServerInfo?: () => Promise<AuthStatus>
}) {
  const requestIdRef = useRef(0)
  const [state, setState] = useState<LauncherAboutState>({ status: 'loading' })

  const load = useCallback(() => {
    const requestId = ++requestIdRef.current
    setState({ status: 'loading' })

    void loadServerInfo().then((authStatus) => {
      if (requestId !== requestIdRef.current) return
      const hasBuildIdentity = authStatus.build != null ||
        (typeof authStatus.version === 'string' && authStatus.version.trim() !== '')
      setState({
        authStatus,
        status: hasBuildIdentity ? 'connected' : 'unavailable'
      })
    }).catch(() => {
      if (requestId !== requestIdRef.current) return
      setState({ status: 'error' })
    })
  }, [loadServerInfo])

  useEffect(() => {
    load()
    return () => {
      requestIdRef.current += 1
    }
  }, [load])

  const aboutInfo: AboutInfo = {
    build: state.authStatus?.build,
    version: state.authStatus?.version,
    urls: launcherAboutUrls
  }

  return (
    <div className='launcher-about'>
      <AboutSection
        value={aboutInfo}
        serverStatus={state.status}
        onRetryServer={load}
      />
    </div>
  )
}
