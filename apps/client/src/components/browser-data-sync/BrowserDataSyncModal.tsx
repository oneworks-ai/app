import { Alert, App, Button, Modal, Space } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BrowserDataSyncDataList } from './BrowserDataSyncDataList'
import {
  emptyBrowserDataSyncState,
  fallbackChromePasswordSource,
  useBrowserDataSyncModalDataTypes
} from './BrowserDataSyncModalDataTypes'

export function BrowserDataSyncModal({ onClose, open }: { onClose: () => void; open: boolean }) {
  const { message } = App.useApp()
  const { t } = useTranslation()
  const desktopApi = window.oneworksDesktop
  const [state, setState] = useState<DesktopBrowserDataSyncState>(emptyBrowserDataSyncState)
  const [loading, setLoading] = useState(false)
  const [passwordSources, setPasswordSources] = useState<DesktopBrowserPasswordImportSource[]>([])
  const [importingAuthenticator, setImportingAuthenticator] = useState(false)
  const [importingPasswordCsv, setImportingPasswordCsv] = useState(false)
  const [importingPasswordSourceId, setImportingPasswordSourceId] = useState<
    DesktopBrowserPasswordImportSourceId | null
  >(null)
  const canImportAuthenticator = desktopApi?.importAuthenticatorBackup != null
  const canImportPasswords = desktopApi?.importBrowserPasswords != null || desktopApi?.importChromePasswords != null
  const canImportPasswordCsv = desktopApi?.importPasswordCsv != null
  const visiblePasswordSources = useMemo(() => {
    if (passwordSources.some(source => source.id === fallbackChromePasswordSource.id)) {
      return passwordSources
    }
    return [fallbackChromePasswordSource, ...passwordSources]
  }, [passwordSources])

  const loadState = useCallback(() => {
    if (desktopApi?.getBrowserDataSyncState == null) {
      setState(emptyBrowserDataSyncState)
      return
    }

    setLoading(true)
    void desktopApi.getBrowserDataSyncState()
      .then(value => setState(value ?? emptyBrowserDataSyncState))
      .catch((error) => {
        console.error('[browser-data-sync] failed to load state', error)
        setState(emptyBrowserDataSyncState)
      })
      .finally(() => setLoading(false))
  }, [desktopApi])

  const loadPasswordSources = useCallback(() => {
    if (desktopApi?.listBrowserPasswordImportSources == null) {
      setPasswordSources([])
      return
    }
    void desktopApi.listBrowserPasswordImportSources()
      .then(sources => setPasswordSources(sources ?? []))
      .catch((error) => {
        console.error('[browser-data-sync] failed to load browser password sources', error)
        setPasswordSources([])
      })
  }, [desktopApi])

  useEffect(() => {
    if (!open) return
    loadState()
    loadPasswordSources()
  }, [loadPasswordSources, loadState, open])

  const handleImportAuthenticator = useCallback(() => {
    if (!canImportAuthenticator || desktopApi?.importAuthenticatorBackup == null) {
      void message.warning(t('common.notSupportedYet'))
      return
    }

    setImportingAuthenticator(true)
    void desktopApi.importAuthenticatorBackup()
      .then((result) => {
        if (result.canceled) return
        void message.success(t('browserDataSync.authenticator.importSuccess', {
          imported: result.imported,
          skipped: result.skipped,
          updated: result.updated
        }))
        loadState()
      })
      .catch((error) => {
        console.error('[browser-data-sync] failed to import authenticator backup', error)
        void message.error(t('browserDataSync.authenticator.importFailed'))
      })
      .finally(() => setImportingAuthenticator(false))
  }, [canImportAuthenticator, desktopApi, loadState, message, t])

  const handleImportPasswords = useCallback((source: DesktopBrowserPasswordImportSource) => {
    if (
      !canImportPasswords ||
      desktopApi == null ||
      (desktopApi.importBrowserPasswords == null && desktopApi.importChromePasswords == null)
    ) {
      void message.warning(t('browserDataSync.savedPasswords.desktopRestartRequired'))
      return
    }

    setImportingPasswordSourceId(source.id)
    const importPromise = desktopApi.importBrowserPasswords == null
      ? desktopApi.importChromePasswords!()
      : desktopApi.importBrowserPasswords({ sourceId: source.id })
    void importPromise
      .then((result) => {
        if (result.canceled) return
        void message.success(t('browserDataSync.savedPasswords.importSourceSuccess', {
          duplicates: result.duplicates,
          failed: result.failed,
          imported: result.imported,
          profiles: result.profiles,
          source: result.sourceName ?? source.name,
          skipped: result.skipped,
          updated: result.updated
        }))
        loadState()
        loadPasswordSources()
      })
      .catch((error) => {
        console.error('[browser-data-sync] failed to import browser passwords', error)
        void message.error(t('browserDataSync.savedPasswords.importSourceFailed', {
          source: source.name
        }))
      })
      .finally(() => setImportingPasswordSourceId(null))
  }, [canImportPasswords, desktopApi, loadPasswordSources, loadState, message, t])

  const handleImportPasswordCsv = useCallback(() => {
    if (!canImportPasswordCsv || desktopApi?.importPasswordCsv == null) {
      void message.warning(t('browserDataSync.savedPasswords.desktopRestartRequired'))
      return
    }

    setImportingPasswordCsv(true)
    void desktopApi.importPasswordCsv()
      .then((result) => {
        if (result.canceled) return
        void message.success(t('browserDataSync.savedPasswords.importCsvSuccess', {
          duplicates: result.duplicates,
          imported: result.imported,
          skipped: result.skipped,
          updated: result.updated
        }))
        loadState()
        loadPasswordSources()
      })
      .catch((error) => {
        console.error('[browser-data-sync] failed to import password CSV', error)
        void message.error(t('browserDataSync.savedPasswords.importCsvFailed'))
      })
      .finally(() => setImportingPasswordCsv(false))
  }, [canImportPasswordCsv, desktopApi, loadPasswordSources, loadState, message, t])

  const dataTypes = useBrowserDataSyncModalDataTypes({
    canImportAuthenticator,
    importingAuthenticator,
    importingPasswordCsv,
    importingPasswordSourceId,
    onImportAuthenticator: handleImportAuthenticator,
    onImportPasswordCsv: handleImportPasswordCsv,
    onImportPasswords: handleImportPasswords,
    state,
    visiblePasswordSources
  })

  return (
    <Modal
      destroyOnClose
      open={open}
      title={t('browserDataSync.title')}
      width={640}
      footer={[
        <Button key='close' onClick={onClose}>
          {t('common.close')}
        </Button>
      ]}
      onCancel={onClose}
    >
      <Space direction='vertical' size={14} style={{ width: '100%' }}>
        <Alert
          showIcon
          type='info'
          message={t('browserDataSync.summaryTitle')}
          description={t('browserDataSync.summaryDescription')}
        />
        <BrowserDataSyncDataList loading={loading} dataSource={dataTypes} />
        <Alert
          showIcon
          type='warning'
          message={t('browserDataSync.securityTitle')}
          description={t('browserDataSync.securityDescription')}
        />
      </Space>
    </Modal>
  )
}
