/* eslint-disable max-lines -- desktop settings panel keeps launcher shortcut form and persistence together. */
import '../ConfigView.scss'

import { App, Button, Segmented, Space, Spin, Switch, Tooltip } from 'antd'
import { useEffect, useMemo, useState } from 'react'

import { emptyDesktopUpdateStatus, normalizeDesktopUpdateStatus } from '#~/desktop/update-status'
import { useResolvedThemeMode } from '#~/hooks/use-resolved-theme-mode'
import { getDesktopShortcutFromEvent, parseShortcut } from '#~/utils/shortcutUtils'

import { BrowserDataSyncModal } from '../browser-data-sync/BrowserDataSyncModal'
import { FieldRow } from './ConfigFieldRow'
import { ConfigSectionFrame } from './ConfigSectionFrame'
import { ShortcutInput } from './ConfigShortcutInput'
import { ProjectThemeColorSettingsControls } from './ProjectThemeColorSettingsControls'
import { normalizeDesktopIconSettings } from './app-icon-settings-model'
import type { DesktopIconBackground, DesktopIconSync, DesktopIconTheme } from './app-icon-settings-model'
import type { TranslationFn } from './configUtils'
import { emptyDesktopSettings, fallbackLauncherShortcut, normalizeDesktopSettings } from './desktop-settings-model'
import { getSyncAppIconCopy } from './project-theme-color-settings-model'
import { useProjectThemePreviewSources } from './use-project-theme-preview-sources'

type DesktopUpdateChannel = DesktopSettings['updateChannel']
const desktopUpdateChannels = ['stable', 'rc', 'beta', 'alpha'] as const satisfies readonly DesktopUpdateChannel[]

export function DesktopSettingsPanel({
  showHeader = true,
  t
}: {
  showHeader?: boolean
  t: TranslationFn
}) {
  const { message } = App.useApp()
  const desktopApi = window.oneworksDesktop
  const isMac = desktopApi?.platform === 'darwin'
  const { resolvedThemeMode } = useResolvedThemeMode()
  const [settings, setSettings] = useState<DesktopSettings>(emptyDesktopSettings)
  const [updateStatus, setUpdateStatus] = useState<DesktopUpdateStatus>(emptyDesktopUpdateStatus)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [browserDataSyncOpen, setBrowserDataSyncOpen] = useState(false)
  const canUpdate = desktopApi?.updateDesktopSettings != null
  const canCheckUpdates = desktopApi?.checkForUpdates != null
  const canOpenKeyboardSettings = isMac && desktopApi?.openKeyboardShortcutsSettings != null
  const canRetryShortcutRegistration = desktopApi?.retryLauncherShortcutRegistration != null
  const updateCheckInProgress = checkingUpdates || updateStatus.status === 'checking'
  const desktopIconSettings = normalizeDesktopIconSettings(settings)
  const appIconLabel = t('config.desktopSettings.appIcon.label')
  const appIconDescription = t('config.desktopSettings.appIcon.desc')
  const appIconPreviewSources = useProjectThemePreviewSources({
    desktopApi,
    iconAppearance: desktopIconSettings.iconAppearance,
    iconBackground: desktopIconSettings.iconBackground,
    iconMode: resolvedThemeMode,
    t
  })
  const selectedAppIconPreviewSrc = appIconPreviewSources[desktopIconSettings.iconTheme]
  const syncAppIconCopy = getSyncAppIconCopy(desktopApi?.platform, t)

  useEffect(() => {
    let disposed = false
    const settingsPromise = desktopApi?.getDesktopSettings?.()
    if (settingsPromise == null) {
      setLoading(false)
      return
    }

    void settingsPromise.then((value) => {
      if (!disposed) {
        setSettings(normalizeDesktopSettings(value))
        setLoading(false)
      }
    }).catch((error) => {
      console.error('[desktop-settings] failed to load settings', error)
      if (!disposed) {
        setLoading(false)
      }
    })

    const dispose = desktopApi?.onDesktopSettingsChange?.((value) => {
      setSettings(normalizeDesktopSettings(value))
    })

    return () => {
      disposed = true
      dispose?.()
    }
  }, [desktopApi])

  useEffect(() => {
    let disposed = false
    const statusPromise = desktopApi?.getUpdateStatus?.()
    if (statusPromise == null) {
      setUpdateStatus(emptyDesktopUpdateStatus)
      return
    }

    void statusPromise.then((value) => {
      if (!disposed) {
        setUpdateStatus(normalizeDesktopUpdateStatus(value))
      }
    }).catch((error) => {
      console.error('[desktop-settings] failed to load update status', error)
    })

    const dispose = desktopApi?.onUpdateStatusChange?.((value) => {
      setUpdateStatus(normalizeDesktopUpdateStatus(value))
    })

    return () => {
      disposed = true
      dispose?.()
    }
  }, [desktopApi])

  const normalizeLauncherShortcut = useMemo(() => (
    (shortcut: string) => {
      const parsed = parseShortcut(shortcut, isMac)
      if (
        parsed == null ||
        (!parsed.metaKey && !parsed.ctrlKey && !parsed.altKey)
      ) {
        void message.warning(t('config.desktopSettings.launcherShortcut.invalid'))
        return null
      }
      return shortcut
    }
  ), [isMac, message, t])

  const updateLauncherShortcut = (launcherShortcut: string) => {
    const previousSettings = settings
    setSettings(prev => ({ ...prev, launcherShortcut }))
    if (desktopApi?.updateDesktopSettings == null) return

    setSaving(true)
    void desktopApi.updateDesktopSettings({ launcherShortcut })
      .then(value => setSettings(normalizeDesktopSettings(value)))
      .catch((error) => {
        console.error('[desktop-settings] failed to update launcher shortcut', error)
        setSettings(previousSettings)
        void message.error(t('config.desktopSettings.saveFailed'))
      })
      .finally(() => setSaving(false))
  }

  const updateDesktopIconSettings = (
    patch: Partial<Pick<DesktopSettings, 'iconAppearance' | 'iconBackground' | 'iconTheme' | 'syncAppIcon'>>
  ) => {
    const previousSettings = settings
    setSettings(prev => normalizeDesktopSettings({ ...prev, ...patch }))
    if (desktopApi?.updateDesktopSettings == null) return

    setSaving(true)
    void desktopApi.updateDesktopSettings(patch)
      .then(value => setSettings(normalizeDesktopSettings(value)))
      .catch((error) => {
        console.error('[desktop-settings] failed to update app icon settings', error)
        setSettings(previousSettings)
        void message.error(t('config.desktopSettings.appIcon.saveFailed'))
      })
      .finally(() => setSaving(false))
  }

  const updateIconTheme = (iconTheme: DesktopIconTheme) => {
    updateDesktopIconSettings({
      iconAppearance: desktopIconSettings.iconAppearance,
      iconBackground: desktopIconSettings.iconBackground,
      iconTheme
    })
  }

  const updateIconBackground = (iconBackground: DesktopIconBackground) => {
    updateDesktopIconSettings({
      iconAppearance: desktopIconSettings.iconAppearance,
      iconBackground,
      iconTheme: desktopIconSettings.iconTheme
    })
  }

  const updateSyncAppIcon = (syncAppIcon: DesktopIconSync) => {
    updateDesktopIconSettings({
      iconAppearance: desktopIconSettings.iconAppearance,
      iconBackground: desktopIconSettings.iconBackground,
      iconTheme: desktopIconSettings.iconTheme,
      syncAppIcon
    })
  }

  const handleOpenKeyboardSettings = () => {
    void desktopApi?.openKeyboardShortcutsSettings?.().catch((error) => {
      console.error('[desktop-settings] failed to open keyboard settings', error)
      void message.error(t('config.desktopSettings.openKeyboardSettingsFailed'))
    })
  }

  const handleRetryLauncherShortcutRegistration = () => {
    if (desktopApi?.retryLauncherShortcutRegistration == null) return

    setSaving(true)
    void desktopApi.retryLauncherShortcutRegistration()
      .then((value) => {
        const nextSettings = normalizeDesktopSettings(value)
        setSettings(nextSettings)
        if (nextSettings.launcherShortcutRegistered) {
          void message.success(t('config.desktopSettings.launcherShortcut.registered'))
        }
      })
      .catch((error) => {
        console.error('[desktop-settings] failed to retry launcher shortcut registration', error)
        void message.error(t('config.desktopSettings.saveFailed'))
      })
      .finally(() => setSaving(false))
  }

  const handleCheckForUpdates = () => {
    if (desktopApi?.checkForUpdates == null) return

    setCheckingUpdates(true)
    void desktopApi.checkForUpdates({ interactive: true })
      .then(value => setUpdateStatus(normalizeDesktopUpdateStatus(value)))
      .catch((error) => {
        console.error('[desktop-settings] failed to check for updates', error)
        void message.error(t('config.desktopSettings.updates.checkFailed'))
      })
      .finally(() => setCheckingUpdates(false))
  }

  const updateStatusDescription = useMemo(() => {
    const updateVersion = updateStatus.updateVersion ?? updateStatus.currentVersion
    if (!settings.autoUpdate && updateStatus.status === 'idle') {
      return t('config.desktopSettings.updates.status.autoUpdateOff', { version: updateStatus.currentVersion })
    }
    switch (updateStatus.status) {
      case 'available':
        return t('config.desktopSettings.updates.status.available', { version: updateVersion })
      case 'checking':
        return t('config.desktopSettings.updates.status.checking')
      case 'downloaded':
        return t('config.desktopSettings.updates.status.downloaded', { version: updateVersion })
      case 'downloading':
        return t('config.desktopSettings.updates.status.downloading', {
          progress: `${Math.round(updateStatus.progress ?? 0)}%`
        })
      case 'error':
        return t('config.desktopSettings.updates.status.error', {
          message: updateStatus.errorMessage ?? t('common.operationFailed')
        })
      case 'idle':
        return t('config.desktopSettings.updates.status.idle', { version: updateStatus.currentVersion })
      case 'unavailable':
        return updateStatus.reason === 'disabled'
          ? t('config.desktopSettings.updates.status.disabled')
          : t('config.desktopSettings.updates.status.unavailable')
    }
  }, [settings.autoUpdate, t, updateStatus])

  const updateCheckButtonLabel = updateStatus.status === 'downloaded'
    ? t('config.desktopSettings.updates.restart')
    : updateStatus.status === 'available'
    ? t('config.desktopSettings.updates.update')
    : updateCheckInProgress
    ? t('config.desktopSettings.updates.checking')
    : t('config.desktopSettings.updates.check')
  const updateChannelOptions = useMemo(() =>
    desktopUpdateChannels.map(updateChannel => ({
      label: t(`config.desktopSettings.updates.channel.options.${updateChannel}`),
      value: updateChannel
    })), [t])

  const updateDesktopUpdateChannel = (updateChannel: DesktopUpdateChannel) => {
    const previousSettings = settings
    setSettings(prev => normalizeDesktopSettings({ ...prev, updateChannel }))
    if (desktopApi?.updateDesktopSettings == null) return

    setSaving(true)
    void desktopApi.updateDesktopSettings({ updateChannel })
      .then(value => setSettings(normalizeDesktopSettings(value)))
      .catch((error) => {
        console.error('[desktop-settings] failed to update desktop update channel', error)
        setSettings(previousSettings)
        void message.error(t('config.desktopSettings.saveFailed'))
      })
      .finally(() => setSaving(false))
  }

  const updateDesktopAutoUpdate = (autoUpdate: boolean) => {
    const previousSettings = settings
    setSettings(prev => normalizeDesktopSettings({ ...prev, autoUpdate }))
    if (desktopApi?.updateDesktopSettings == null) return

    setSaving(true)
    void desktopApi.updateDesktopSettings({ autoUpdate })
      .then(value => setSettings(normalizeDesktopSettings(value)))
      .catch((error) => {
        console.error('[desktop-settings] failed to update desktop auto-update setting', error)
        setSettings(previousSettings)
        void message.error(t('config.desktopSettings.saveFailed'))
      })
      .finally(() => setSaving(false))
  }

  return (
    <ConfigSectionFrame
      icon={showHeader ? 'desktop_windows' : undefined}
      title={showHeader ? t('config.sections.desktop') : undefined}
    >
      {loading
        ? (
          <div className='config-view__state'>
            <Spin />
          </div>
        )
        : (
          <div className='config-view__app-settings-list'>
            <div
              className='config-view__field-row config-view__project-theme-field-row'
              aria-label={appIconLabel}
            >
              <div className='config-view__field-meta config-view__project-theme-field-meta'>
                <Tooltip title={`${appIconLabel}: ${appIconDescription}`}>
                  <div
                    className='config-view__project-theme-preview'
                    role='img'
                    aria-label={t('config.desktopSettings.appIcon.previewAlt')}
                  >
                    {selectedAppIconPreviewSrc != null && (
                      <img
                        className='config-view__project-theme-preview-image'
                        src={selectedAppIconPreviewSrc}
                        alt=''
                      />
                    )}
                  </div>
                </Tooltip>
              </div>
              <div className='config-view__field-control config-view__project-theme-field-control'>
                <ProjectThemeColorSettingsControls
                  backgroundAriaLabel={t('config.desktopSettings.appIcon.background')}
                  backgroundOptionTranslationPrefix='config.desktopSettings.appIcon.backgroundStyle.options'
                  canUpdateDesktopIcon={canUpdate}
                  iconBackground={desktopIconSettings.iconBackground}
                  previewSources={appIconPreviewSources}
                  saving={saving || !canUpdate}
                  selectedTheme={desktopIconSettings.iconTheme}
                  syncAppIcon={desktopIconSettings.syncAppIcon}
                  syncAppIconDescription={syncAppIconCopy.description}
                  syncAppIconLabel={syncAppIconCopy.label}
                  t={t}
                  themeAriaLabel={appIconLabel}
                  onIconBackgroundChange={updateIconBackground}
                  onSyncAppIconChange={updateSyncAppIcon}
                  onThemeChange={updateIconTheme}
                />
              </div>
            </div>
            <FieldRow
              title={t('browserDataSync.settingsTitle')}
              description={t('browserDataSync.settingsDescription')}
              icon='sync'
            >
              <Button
                size='small'
                icon={<span className='material-symbols-rounded'>sync</span>}
                onClick={() => setBrowserDataSyncOpen(true)}
              >
                {t('browserDataSync.open')}
              </Button>
            </FieldRow>
            <FieldRow
              title={t('config.desktopSettings.launcherShortcut.label')}
              description={t('config.desktopSettings.launcherShortcut.desc')}
              icon='keyboard'
            >
              <ShortcutInput
                value={settings.launcherShortcut}
                placeholder={t('config.desktopSettings.launcherShortcut.placeholder')}
                getShortcutFromEvent={getDesktopShortcutFromEvent}
                normalizeShortcut={normalizeLauncherShortcut}
                isMac={isMac}
                t={t}
                onChange={updateLauncherShortcut}
              />
            </FieldRow>
            <FieldRow
              title={t('config.desktopSettings.updates.label')}
              description={t('config.desktopSettings.updates.desc')}
              icon='system_update_alt'
            >
              <Space direction='vertical' size={6}>
                <Space size={8}>
                  <Switch
                    size='small'
                    checked={settings.autoUpdate}
                    disabled={!canUpdate}
                    aria-label={t('config.desktopSettings.updates.autoUpdate')}
                    onChange={updateDesktopAutoUpdate}
                  />
                  <span className='config-view__field-desc'>{t('config.desktopSettings.updates.autoUpdate')}</span>
                </Space>
                <Segmented<DesktopUpdateChannel>
                  size='small'
                  disabled={!canUpdate}
                  options={updateChannelOptions}
                  value={settings.updateChannel}
                  onChange={updateDesktopUpdateChannel}
                />
                <Button
                  size='small'
                  disabled={!canCheckUpdates || updateStatus.status === 'downloading'}
                  loading={updateCheckInProgress}
                  icon={<span className='material-symbols-rounded'>sync</span>}
                  onClick={handleCheckForUpdates}
                >
                  {updateCheckButtonLabel}
                </Button>
                <div className='config-view__field-desc'>{updateStatusDescription}</div>
              </Space>
            </FieldRow>
            {!canUpdate && (
              <div className='config-view__field-desc'>{t('config.desktopSettings.unavailable')}</div>
            )}
            {saving && (
              <div className='config-view__field-desc'>{t('config.desktopSettings.saving')}</div>
            )}
            {settings.launcherShortcutError != null && (
              <div className='config-view__field-desc'>
                <div>
                  {t('config.desktopSettings.launcherShortcut.registerFailed', {
                    message: settings.launcherShortcutError
                  })}
                </div>
                <Space size={8} wrap>
                  {canOpenKeyboardSettings && (
                    <Button size='small' onClick={handleOpenKeyboardSettings}>
                      {t('config.desktopSettings.launcherShortcut.openKeyboardSettings')}
                    </Button>
                  )}
                  {canRetryShortcutRegistration && (
                    <Button size='small' onClick={handleRetryLauncherShortcutRegistration}>
                      {t('config.desktopSettings.launcherShortcut.retry')}
                    </Button>
                  )}
                  {settings.launcherShortcut !== fallbackLauncherShortcut && (
                    <Button size='small' onClick={() => updateLauncherShortcut(fallbackLauncherShortcut)}>
                      {t('config.desktopSettings.launcherShortcut.useFallback')}
                    </Button>
                  )}
                </Space>
              </div>
            )}
            <BrowserDataSyncModal
              open={browserDataSyncOpen}
              onClose={() => setBrowserDataSyncOpen(false)}
            />
          </div>
        )}
    </ConfigSectionFrame>
  )
}
