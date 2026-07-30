import './ConfigAboutSection.scss'

import { App } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  parseAppBuildInfoJson
} from '@oneworks/types'
import type {
  AboutInfo,
  AppBuildInfo
} from '@oneworks/types'

import { getClientBuildInfo } from '#~/client-build-info'
import { copyTextWithFeedback } from '#~/utils/copy'
import { areSemverVersionsCompatible } from '#~/version-compatibility'

import { ConfigAboutFingerprint } from './ConfigAboutFingerprint'

type DesktopBuildSourceInfo = Pick<
  NonNullable<DesktopSettings['buildSource']>,
  'buildTime' | 'gitHash'
>

export type AboutServerStatus = 'connected' | 'error' | 'loading' | 'unavailable'
export type AboutBuildMismatch = 'commit' | 'version' | undefined

interface AboutSectionProps {
  onRetryServer?: () => void
  serverStatus?: AboutServerStatus
  value?: AboutInfo
}

interface AboutDiagnosticInput {
  client: AppBuildInfo
  mismatch?: AboutBuildMismatch
  server: AppBuildInfo
  serverStatus: AboutServerStatus
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const normalizeText = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const normalizeDesktopBuildSource = (value: unknown): DesktopBuildSourceInfo | undefined => {
  if (!isRecord(value)) return undefined

  const buildTime = normalizeText(value.buildTime)
  const gitHash = normalizeText(value.gitHash)
  if (buildTime == null || gitHash == null) {
    return undefined
  }

  return {
    buildTime,
    gitHash
  }
}

const mergeDesktopBuildSource = (
  client: AppBuildInfo,
  desktopBuildSource: DesktopBuildSourceInfo | undefined
) => {
  if (desktopBuildSource == null) return client
  return parseAppBuildInfoJson(JSON.stringify({
    ...client,
    commit: client.commit ?? desktopBuildSource.gitHash,
    buildTime: client.buildTime ?? desktopBuildSource.buildTime,
    buildTimeSource: client.buildTime == null ? 'build' : client.buildTimeSource
  }), client.version)
}

export const getServerBuildInfo = (value: AboutInfo | undefined) => (
  parseAppBuildInfoJson(
    JSON.stringify(value?.build ?? { version: value?.version }),
    value?.version
  )
)

const hasServerBuildIdentity = (value: AboutInfo | undefined) => (
  value?.build != null || normalizeText(value?.version) != null
)

export const getAboutBuildMismatch = (
  client: AppBuildInfo,
  server: AppBuildInfo,
  serverStatus: AboutServerStatus
): AboutBuildMismatch => {
  if (serverStatus !== 'connected') return undefined
  if (!areSemverVersionsCompatible(client.version, server.version)) return 'version'
  if (client.commit != null && server.commit != null && client.commit !== server.commit) {
    return 'commit'
  }
  return undefined
}

export const buildAboutDiagnosticText = ({
  client,
  mismatch,
  server,
  serverStatus
}: AboutDiagnosticInput) => {
  const safeClient = client
  const safeServer = server
  return [
    'One Works diagnostics',
    `Client version: ${safeClient.version}`,
    `Client commit: ${safeClient.commit ?? 'unavailable'}`,
    `Client build time: ${safeClient.buildTime ?? 'unavailable'}`,
    `Client build time source: ${safeClient.buildTimeSource}`,
    `Server connection: ${serverStatus}`,
    `Server version: ${safeServer.version}`,
    `Server commit: ${safeServer.commit ?? 'unavailable'}`,
    `Server build time: ${safeServer.buildTime ?? 'unavailable'}`,
    `Server build time source: ${safeServer.buildTimeSource}`,
    `Build mismatch: ${mismatch ?? 'none'}`
  ].join('\n')
}

export const AboutSection = ({
  onRetryServer,
  serverStatus,
  value
}: AboutSectionProps) => {
  const { message } = App.useApp()
  const { t } = useTranslation()
  const desktopApi = window.oneworksDesktop
  const [desktopBuildSource, setDesktopBuildSource] = useState<DesktopBuildSourceInfo>()
  const aboutInfo = (value != null && typeof value === 'object')
    ? value
    : undefined
  const urls = aboutInfo?.urls
  const lastReleaseAt = aboutInfo?.lastReleaseAt
  const clientBuild = useMemo(
    () => mergeDesktopBuildSource(getClientBuildInfo(), desktopBuildSource),
    [desktopBuildSource]
  )
  const serverBuild = useMemo(() => getServerBuildInfo(aboutInfo), [aboutInfo])
  const resolvedServerStatus = serverStatus ??
    (hasServerBuildIdentity(aboutInfo) ? 'connected' : 'unavailable')
  const mismatch = getAboutBuildMismatch(clientBuild, serverBuild, resolvedServerStatus)

  useEffect(() => {
    let disposed = false
    const settingsPromise = desktopApi?.getDesktopSettings?.()
    if (settingsPromise == null) {
      setDesktopBuildSource(undefined)
      return
    }

    void settingsPromise.then((settings) => {
      if (!disposed) {
        setDesktopBuildSource(normalizeDesktopBuildSource(
          isRecord(settings) ? settings.buildSource : undefined
        ))
      }
    }).catch((error) => {
      console.error('[config-about] failed to load desktop build source', error)
      if (!disposed) {
        setDesktopBuildSource(undefined)
      }
    })

    const dispose = desktopApi?.onDesktopSettingsChange?.((settings) => {
      if (!disposed) {
        setDesktopBuildSource(normalizeDesktopBuildSource(
          isRecord(settings) ? settings.buildSource : undefined
        ))
      }
    })

    return () => {
      disposed = true
      dispose?.()
    }
  }, [desktopApi])

  const handleCopyDiagnostics = () => {
    void copyTextWithFeedback({
      failureMessage: t('config.about.copyFailed'),
      messageApi: message,
      successMessage: t('config.about.copySuccess'),
      text: buildAboutDiagnosticText({
        client: clientBuild,
        mismatch,
        server: serverBuild,
        serverStatus: resolvedServerStatus
      })
    })
  }

  const serverStatusLabel = t(`config.about.connection.${resolvedServerStatus}`)

  return (
    <div className='config-about'>
      <div className='config-about__card'>
        <div className='config-about__app'>
          <div className='config-about__app-icon'>
            <span className='material-symbols-rounded'>auto_awesome</span>
          </div>
          <div className='config-about__app-info'>
            <div className='config-about__app-title'>
              {t('config.about.software')}
            </div>
            {lastReleaseAt != null && (
              <div className='config-about__app-date'>
                {t('config.about.lastRelease')}: {lastReleaseAt}
              </div>
            )}
          </div>
        </div>
        <div className='config-about__actions'>
          <button
            type='button'
            className='config-about__secondary'
            aria-label={t('config.about.copyDiagnostics')}
            onClick={handleCopyDiagnostics}
          >
            <span className='material-symbols-rounded' aria-hidden='true'>content_copy</span>
            <span>{t('config.about.copyDiagnostics')}</span>
          </button>
          <a
            className='config-about__primary'
            href={urls?.releases ?? urls?.repo}
            target='_blank'
            rel='noreferrer'
          >
            {t('config.about.checkUpdate')}
          </a>
        </div>
      </div>

      <div className='config-about__fingerprints'>
        <ConfigAboutFingerprint
          build={clientBuild}
          buildTimeLabel={t('config.about.fingerprint.buildTime')}
          commitLabel={t('config.about.fingerprint.commit')}
          commitTimeSourceLabel={t('config.about.fingerprint.commitTimeSource')}
          label={t('config.about.client')}
          unknownLabel={t('config.about.unknown')}
          versionLabel={t('config.about.fingerprint.version')}
        />
        <ConfigAboutFingerprint
          build={serverBuild}
          buildTimeLabel={t('config.about.fingerprint.buildTime')}
          commitLabel={t('config.about.fingerprint.commit')}
          commitTimeSourceLabel={t('config.about.fingerprint.commitTimeSource')}
          label={t('config.about.server')}
          status={resolvedServerStatus}
          statusLabel={serverStatusLabel}
          unknownLabel={t('config.about.unknown')}
          versionLabel={t('config.about.fingerprint.version')}
        />
      </div>

      {(resolvedServerStatus === 'error' || resolvedServerStatus === 'unavailable') && (
        <div className='config-about__connection-message' role='alert'>
          <span className='material-symbols-rounded' aria-hidden='true'>cloud_off</span>
          <span>{t(`config.about.connection.${resolvedServerStatus}Description`)}</span>
          {onRetryServer != null && (
            <button type='button' onClick={onRetryServer}>
              <span className='material-symbols-rounded' aria-hidden='true'>refresh</span>
              {t('config.about.retry')}
            </button>
          )}
        </div>
      )}

      {resolvedServerStatus === 'loading' && (
        <div className='config-about__connection-message' role='status'>
          <span className='material-symbols-rounded config-about__spin' aria-hidden='true'>progress_activity</span>
          <span>{t('config.about.connection.loadingDescription')}</span>
        </div>
      )}

      {mismatch != null && (
        <div className='config-about__mismatch' role='alert' data-testid='about-build-mismatch'>
          <span className='material-symbols-rounded' aria-hidden='true'>warning</span>
          <span>{t(`config.about.mismatch.${mismatch}`)}</span>
        </div>
      )}

      <div className='config-about__list'>
        <a
          className='config-about__item-row'
          href={urls?.docs ?? urls?.repo}
          target='_blank'
          rel='noreferrer'
        >
          <span className='config-about__item-left'>
            <span className='material-symbols-rounded config-about__item-icon'>menu_book</span>
            <span>{t('config.about.docs')}</span>
          </span>
          <span className='material-symbols-rounded config-about__arrow'>open_in_new</span>
        </a>
        <a
          className='config-about__item-row'
          href={urls?.contact ?? urls?.repo}
          target='_blank'
          rel='noreferrer'
        >
          <span className='config-about__item-left'>
            <span className='material-symbols-rounded config-about__item-icon'>mail</span>
            <span>{t('config.about.contact')}</span>
          </span>
          <span className='material-symbols-rounded config-about__arrow'>open_in_new</span>
        </a>
        <a
          className='config-about__item-row'
          href={urls?.issues ?? urls?.repo}
          target='_blank'
          rel='noreferrer'
        >
          <span className='config-about__item-left'>
            <span className='material-symbols-rounded config-about__item-icon'>bug_report</span>
            <span>{t('config.about.feedback')}</span>
          </span>
          <span className='material-symbols-rounded config-about__arrow'>open_in_new</span>
        </a>
      </div>
    </div>
  )
}
