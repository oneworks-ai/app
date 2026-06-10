import './ConfigAboutSection.scss'

import type { AboutInfo } from '@oneworks/types'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getClientCommitHash, getClientVersion } from '#~/client-build-info'

type DesktopBuildSourceInfo = NonNullable<DesktopSettings['buildSource']>

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const normalizeText = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const normalizeDesktopBuildSource = (value: unknown): DesktopBuildSourceInfo | undefined => {
  if (!isRecord(value)) return undefined

  const branch = normalizeText(value.branch)
  const buildTime = normalizeText(value.buildTime)
  const gitHash = normalizeText(value.gitHash)
  if (branch == null || buildTime == null || gitHash == null) {
    return undefined
  }

  return {
    branch,
    buildTime,
    gitHash
  }
}

const formatBuildTime = (buildTime: string) => {
  const date = new Date(buildTime)
  if (Number.isNaN(date.getTime())) {
    return buildTime
  }
  return date.toLocaleString()
}

export const AboutSection = ({ value }: { value?: AboutInfo }) => {
  const { t } = useTranslation()
  const desktopApi = window.oneworksDesktop
  const [showCommitHash, setShowCommitHash] = useState(false)
  const [desktopBuildSource, setDesktopBuildSource] = useState<DesktopBuildSourceInfo>()
  const aboutInfo = (value != null && typeof value === 'object')
    ? value
    : undefined
  const urls = aboutInfo?.urls
  const serverVersion = aboutInfo?.version
  const clientVersion = getClientVersion()
  const clientCommitHash = getClientCommitHash()
  const lastReleaseAt = aboutInfo?.lastReleaseAt
  const formattedBuildTime = desktopBuildSource == null ? undefined : formatBuildTime(desktopBuildSource.buildTime)

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
      setDesktopBuildSource(normalizeDesktopBuildSource(
        isRecord(settings) ? settings.buildSource : undefined
      ))
    })

    return () => {
      disposed = true
      dispose?.()
    }
  }, [desktopApi])

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
            <div className='config-about__app-meta'>
              <span
                className='config-about__app-version'
                title={t('config.about.commitHash')}
                onDoubleClick={() => setShowCommitHash(true)}
              >
                {t('config.about.clientVersion')}: {clientVersion}
              </span>
              {showCommitHash && (
                <span className='config-about__app-commit'>
                  {t('config.about.commitHash')}: {clientCommitHash ?? t('config.about.unknown')}
                </span>
              )}
              <span className='config-about__app-server-version'>
                {t('config.about.serverVersion')}: {serverVersion ?? t('config.about.unknown')}
              </span>
              <span className='config-about__app-date'>
                {lastReleaseAt ?? t('config.about.unknown')}
              </span>
            </div>
          </div>
        </div>
        <a
          className='config-about__primary'
          href={urls?.releases ?? urls?.repo}
          target='_blank'
          rel='noreferrer'
        >
          {t('config.about.checkUpdate')}
        </a>
      </div>

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

      {desktopBuildSource != null && (
        <div className='config-about__build-source'>
          <div className='config-about__build-source-title'>
            <span className='material-symbols-rounded config-about__item-icon'>commit</span>
            <span>{t('config.about.buildSource.title')}</span>
          </div>
          <div className='config-about__build-source-list'>
            <div className='config-about__build-source-row'>
              <span>{t('config.about.buildSource.gitHash')}</span>
              <code title={desktopBuildSource.gitHash}>{desktopBuildSource.gitHash}</code>
            </div>
            <div className='config-about__build-source-row'>
              <span>{t('config.about.buildSource.branch')}</span>
              <code title={desktopBuildSource.branch}>{desktopBuildSource.branch}</code>
            </div>
            <div className='config-about__build-source-row'>
              <span>{t('config.about.buildSource.buildTime')}</span>
              <code title={desktopBuildSource.buildTime}>{formattedBuildTime ?? desktopBuildSource.buildTime}</code>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
