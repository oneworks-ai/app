import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { InlineActionButton } from '#~/components/inline-action-button'

import type { BrowserDataSyncDataType } from './BrowserDataSyncDataList'

export const fallbackChromePasswordSource: DesktopBrowserPasswordImportSource = {
  icon: 'public',
  id: 'google-chrome',
  name: 'Google Chrome',
  profiles: 0
}

export const emptyBrowserDataSyncState: DesktopBrowserDataSyncState = {
  authenticator: {
    total: 0
  },
  savedPasswords: {
    total: 0
  }
}

interface UseBrowserDataSyncModalDataTypesInput {
  canImportAuthenticator: boolean
  importingAuthenticator: boolean
  importingPasswordCsv: boolean
  importingPasswordSourceId: DesktopBrowserPasswordImportSourceId | null
  state: DesktopBrowserDataSyncState
  visiblePasswordSources: DesktopBrowserPasswordImportSource[]
  onImportAuthenticator: () => void
  onImportPasswordCsv: () => void
  onImportPasswords: (source: DesktopBrowserPasswordImportSource) => void
}

export function useBrowserDataSyncModalDataTypes({
  canImportAuthenticator,
  importingAuthenticator,
  importingPasswordCsv,
  importingPasswordSourceId,
  onImportAuthenticator,
  onImportPasswordCsv,
  onImportPasswords,
  state,
  visiblePasswordSources
}: UseBrowserDataSyncModalDataTypesInput) {
  const { t } = useTranslation()

  return useMemo<BrowserDataSyncDataType[]>(() => [
    {
      action: (
        <InlineActionButton
          loading={importingPasswordCsv}
          icon='upload_file'
          onClick={onImportPasswordCsv}
        >
          {t('browserDataSync.actions.chooseFile')}
        </InlineActionButton>
      ),
      description: t('browserDataSync.savedPasswords.csvDescription'),
      icon: 'file_upload',
      status: t('browserDataSync.status.available'),
      title: t('browserDataSync.savedPasswords.csvTitle')
    },
    ...visiblePasswordSources.map(source => ({
      action: (
        <InlineActionButton
          loading={importingPasswordSourceId === source.id}
          disabled={importingPasswordSourceId != null && importingPasswordSourceId !== source.id}
          icon='sync'
          onClick={() => onImportPasswords(source)}
        >
          {t('browserDataSync.actions.sync')}
        </InlineActionButton>
      ),
      description: t(
        source.profiles > 0
          ? 'browserDataSync.savedPasswords.sourceDescription'
          : 'browserDataSync.savedPasswords.sourceFallbackDescription',
        {
          profiles: source.profiles,
          source: source.name
        }
      ),
      icon: source.icon,
      status: t('browserDataSync.status.available'),
      title: t('browserDataSync.savedPasswords.sourceTitle', {
        source: source.name
      })
    })),
    {
      action: (
        <InlineActionButton icon='hourglass_empty' disabled>
          {t('browserDataSync.actions.comingSoon')}
        </InlineActionButton>
      ),
      description: t('browserDataSync.passwordManagerExtensions.description'),
      icon: 'extension',
      status: t('browserDataSync.status.planned'),
      title: t('browserDataSync.passwordManagerExtensions.title')
    },
    {
      action: (
        <InlineActionButton
          loading={importingAuthenticator}
          disabled={!canImportAuthenticator}
          icon='upload_file'
          onClick={onImportAuthenticator}
        >
          {t('browserDataSync.actions.importBackup')}
        </InlineActionButton>
      ),
      description: t('browserDataSync.authenticator.description', {
        count: state.authenticator.total
      }),
      icon: 'pin',
      status: t('browserDataSync.status.available'),
      title: t('browserDataSync.authenticator.title')
    }
  ], [
    canImportAuthenticator,
    importingAuthenticator,
    importingPasswordCsv,
    importingPasswordSourceId,
    onImportAuthenticator,
    onImportPasswordCsv,
    onImportPasswords,
    state.authenticator.total,
    t,
    visiblePasswordSources
  ])
}
