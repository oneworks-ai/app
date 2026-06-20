/* eslint-disable max-lines -- password manager panel keeps grouped overview, detail editing, and settings together. */
import './SavedPasswordManagerPanel.scss'

import { App, Button, Empty, Form, Input, Modal, Pagination, Spin, Switch } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { InlineActionButton } from '#~/components/inline-action-button'

import { FieldRow } from '../config/ConfigFieldRow'
import { ConfigSectionFrame } from '../config/ConfigSectionFrame'
import { emptyDesktopSettings, normalizeDesktopSettings } from '../config/desktop-settings-model'

interface SavedPasswordGroup {
  displayUrl: string
  key: string
  records: DesktopSavedPasswordRecord[]
  title: string
}

interface SavedPasswordFormValues {
  note?: string
  originUrl: string
  password: string
  username: string
}

const savedPasswordPageSize = 18
const savedPasswordAuthenticationTimeoutMinutes = 5
const commonSecondLevelDomains = new Set(['ac', 'co', 'com', 'edu', 'gov', 'net', 'org'])
const fallbackChromePasswordSource: DesktopBrowserPasswordImportSource = {
  icon: 'public',
  id: 'google-chrome',
  name: 'Google Chrome',
  profiles: 0
}

const isIpAddress = (value: string) => (
  /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(value) ||
  /^\[[0-9a-f:]+\]$/iu.test(value) ||
  (value.includes(':') && /^[0-9a-f:]+$/iu.test(value))
)

const parseUrl = (value: string) => {
  try {
    return new URL(value)
  } catch {
    return undefined
  }
}

const getRecordUrl = (record: DesktopSavedPasswordRecord) => (
  parseUrl(record.originUrl) ??
    parseUrl(record.actionUrl ?? '') ??
    parseUrl(record.signonRealm ?? '')
)

const getOriginLabel = (record: DesktopSavedPasswordRecord) => {
  const url = getRecordUrl(record)
  if (url == null) return record.originUrl
  return url.origin
}

const getHostLabel = (record: DesktopSavedPasswordRecord) => {
  const url = getRecordUrl(record)
  return url?.host || record.originUrl
}

const getSiteGroupTitle = (record: DesktopSavedPasswordRecord) => {
  const url = getRecordUrl(record)
  const hostname = url?.hostname.replace(/^\[(.*)\]$/u, '$1').toLowerCase()
  if (hostname == null || hostname === '' || hostname === 'localhost' || isIpAddress(hostname)) {
    return getHostLabel(record)
  }

  const labels = hostname.split('.').filter(Boolean)
  if (labels.length <= 2) return hostname

  const [thirdFromLast, secondFromLast, last] = labels.slice(-3)
  if (last != null && secondFromLast != null && commonSecondLevelDomains.has(secondFromLast) && last.length === 2) {
    return `${thirdFromLast}.${secondFromLast}.${last}`
  }
  return labels.slice(-2).join('.')
}

const getGroupKey = (record: DesktopSavedPasswordRecord) => getSiteGroupTitle(record).toLowerCase()

const matchesRecordQuery = (record: DesktopSavedPasswordRecord, query: string) => {
  const normalizedQuery = query.trim().toLowerCase()
  if (normalizedQuery === '') return true
  return [
    getSiteGroupTitle(record),
    getOriginLabel(record),
    record.originUrl,
    record.actionUrl ?? '',
    record.signonRealm ?? '',
    record.username,
    record.note ?? '',
    record.sourceProfile
  ].some(value => value.toLowerCase().includes(normalizedQuery))
}

const groupSavedPasswords = (records: DesktopSavedPasswordRecord[], query: string) => {
  const groupsByKey = new Map<string, SavedPasswordGroup>()
  records
    .filter(record => matchesRecordQuery(record, query))
    .forEach((record) => {
      const key = getGroupKey(record)
      const group = groupsByKey.get(key)
      if (group == null) {
        groupsByKey.set(key, {
          displayUrl: getOriginLabel(record),
          key,
          records: [record],
          title: getSiteGroupTitle(record)
        })
        return
      }
      group.records.push(record)
      if (group.displayUrl.length > getOriginLabel(record).length) {
        group.displayUrl = getOriginLabel(record)
      }
    })

  return [...groupsByKey.values()]
    .map(group => ({
      ...group,
      records: [...group.records].sort((left, right) =>
        getOriginLabel(left).localeCompare(getOriginLabel(right)) ||
        left.username.localeCompare(right.username)
      )
    }))
    .sort((left, right) => left.title.localeCompare(right.title))
}

const getRecordEditInitialValues = (record: DesktopSavedPasswordRecord): SavedPasswordFormValues => ({
  note: record.note ?? '',
  originUrl: record.originUrl,
  password: '',
  username: record.username
})

const renderIconText = (icon: string, label: string) => (
  <span className='saved-password-manager__icon-text'>
    <span className='material-symbols-rounded' aria-hidden='true'>{icon}</span>
    <span>{label}</span>
  </span>
)

export function SavedPasswordManagerPanel({
  selectedGroupKey,
  settingsOpen = false,
  showHeader = true,
  onDetailTitleChange,
  onSelectedGroupKeyChange,
  onSettingsOpenChange
}: {
  selectedGroupKey: string | null
  settingsOpen?: boolean
  showHeader?: boolean
  onDetailTitleChange?: (title: string | null) => void
  onSelectedGroupKeyChange: (key: string | null) => void
  onSettingsOpenChange?: (open: boolean) => void
}) {
  const desktopApi = window.oneworksDesktop
  const { message, modal } = App.useApp()
  const { t } = useTranslation()
  const [form] = Form.useForm<SavedPasswordFormValues>()
  const timeoutModalOpenRef = useRef(false)
  const [overviewQuery, setOverviewQuery] = useState('')
  const [detailQuery, setDetailQuery] = useState('')
  const [records, setRecords] = useState<DesktopSavedPasswordRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [authExpiresAtMs, setAuthExpiresAtMs] = useState<number | null>(null)
  const [authenticatingGroupKey, setAuthenticatingGroupKey] = useState<string | null>(null)
  const [passwordSources, setPasswordSources] = useState<DesktopBrowserPasswordImportSource[]>([])
  const [desktopSettings, setDesktopSettings] = useState<DesktopSettings>(emptyDesktopSettings)
  const [revealedPasswords, setRevealedPasswords] = useState<Record<string, string>>({})
  const [editingRecord, setEditingRecord] = useState<DesktopSavedPasswordRecord | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [importingPasswordCsv, setImportingPasswordCsv] = useState(false)
  const [importingPasswordSourceId, setImportingPasswordSourceId] = useState<
    DesktopBrowserPasswordImportSourceId | null
  >(
    null
  )
  const canListPasswords = desktopApi?.listSavedPasswords != null
  const canImportPasswords = desktopApi?.importBrowserPasswords != null || desktopApi?.importChromePasswords != null
  const canUpdateSettings = desktopApi?.updateDesktopSettings != null

  const overviewGroups = useMemo(() => groupSavedPasswords(records, overviewQuery), [overviewQuery, records])
  const visiblePasswordSources = useMemo(() => {
    if (passwordSources.some(source => source.id === fallbackChromePasswordSource.id)) {
      return passwordSources
    }
    return [fallbackChromePasswordSource, ...passwordSources]
  }, [passwordSources])
  const allGroups = useMemo(() => groupSavedPasswords(records, ''), [records])
  const selectedGroup = useMemo(
    () => allGroups.find(group => group.key === selectedGroupKey) ?? null,
    [allGroups, selectedGroupKey]
  )
  const detailRecords = useMemo(
    () => selectedGroup?.records.filter(record => matchesRecordQuery(record, detailQuery)) ?? [],
    [detailQuery, selectedGroup?.records]
  )
  const [page, setPage] = useState(1)
  const visibleGroups = useMemo(() => {
    const start = (page - 1) * savedPasswordPageSize
    return overviewGroups.slice(start, start + savedPasswordPageSize)
  }, [overviewGroups, page])

  const loadRecords = useCallback(() => {
    if (desktopApi?.listSavedPasswords == null) {
      setRecords([])
      return
    }
    setLoading(true)
    void desktopApi.listSavedPasswords()
      .then(setRecords)
      .catch((error) => {
        console.error('[browser-data-sync] failed to list saved passwords', error)
        void message.error(t('browserDataSync.savedPasswords.managerLoadFailed'))
      })
      .finally(() => setLoading(false))
  }, [desktopApi, message, t])

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
    loadRecords()
  }, [loadRecords])

  useEffect(() => {
    if (!settingsOpen) return
    loadPasswordSources()
  }, [loadPasswordSources, settingsOpen])

  useEffect(() => {
    if (!settingsOpen || desktopApi?.getDesktopSettings == null) return
    void desktopApi.getDesktopSettings()
      .then(value => setDesktopSettings(normalizeDesktopSettings(value)))
      .catch((error) => {
        console.error('[browser-data-sync] failed to load desktop password settings', error)
      })
  }, [desktopApi, settingsOpen])

  useEffect(() => {
    const dispose = desktopApi?.onDesktopSettingsChange?.((value) => {
      setDesktopSettings(normalizeDesktopSettings(value))
    })
    return () => {
      dispose?.()
    }
  }, [desktopApi])

  useEffect(() => {
    setPage(1)
  }, [overviewQuery])

  useEffect(() => {
    setDetailQuery('')
    setRevealedPasswords({})
  }, [selectedGroupKey, settingsOpen])

  useEffect(() => {
    if (settingsOpen) {
      onDetailTitleChange?.(t('browserDataSync.savedPasswords.settingsTitle'))
      return
    }
    onDetailTitleChange?.(selectedGroup?.title ?? null)
  }, [onDetailTitleChange, selectedGroup?.title, settingsOpen, t])

  useEffect(() => {
    if (editingRecord == null) return
    form.setFieldsValue(getRecordEditInitialValues(editingRecord))
  }, [editingRecord, form])

  const handleAuthenticationExpired = useCallback(() => {
    setAuthExpiresAtMs(null)
    setAuthenticatingGroupKey(null)
    setDetailQuery('')
    setEditingRecord(null)
    setRevealedPasswords({})
    setSavingEdit(false)
    onSelectedGroupKeyChange(null)
    onSettingsOpenChange?.(false)

    if (timeoutModalOpenRef.current) return
    timeoutModalOpenRef.current = true
    modal.warning({
      content: t('browserDataSync.savedPasswords.timeoutDescription', {
        minutes: savedPasswordAuthenticationTimeoutMinutes
      }),
      okText: t('browserDataSync.savedPasswords.timeoutOk'),
      title: t('browserDataSync.savedPasswords.timeoutTitle'),
      afterClose: () => {
        timeoutModalOpenRef.current = false
      }
    })
  }, [modal, onSelectedGroupKeyChange, onSettingsOpenChange, t])

  useEffect(() => {
    if (authExpiresAtMs == null) return

    const delayMs = authExpiresAtMs - Date.now()
    if (delayMs <= 0) {
      handleAuthenticationExpired()
      return
    }

    const timeoutId = window.setTimeout(handleAuthenticationExpired, delayMs)
    return () => window.clearTimeout(timeoutId)
  }, [authExpiresAtMs, handleAuthenticationExpired])

  const ensureAuthenticated = useCallback(async () => {
    if (desktopApi?.authenticateSavedPasswordsAccess == null) {
      void message.error(t('browserDataSync.savedPasswords.authenticationUnavailable'))
      return false
    }
    try {
      const result = await desktopApi.authenticateSavedPasswordsAccess(
        t('browserDataSync.savedPasswords.authenticationReason')
      )
      const expiresAtMs = Date.parse(result.expiresAt)
      if (Number.isFinite(expiresAtMs)) {
        setAuthExpiresAtMs(expiresAtMs)
      }
      return result.authenticated
    } catch (error) {
      console.error('[browser-data-sync] failed to authenticate saved password access', error)
      void message.error(t('browserDataSync.savedPasswords.authenticationFailed'))
      return false
    }
  }, [desktopApi, message, t])

  const copyField = (record: DesktopSavedPasswordRecord, field: 'username' | 'password') => {
    if (desktopApi?.copySavedPasswordField == null) return
    void ensureAuthenticated().then((authenticated) => {
      if (!authenticated) return
      void desktopApi.copySavedPasswordField?.(record.id, field)
        .then(() => {
          void message.success(t(
            field === 'password'
              ? 'browserDataSync.savedPasswords.passwordCopied'
              : 'browserDataSync.savedPasswords.usernameCopied'
          ))
        })
        .catch((error) => {
          console.error('[browser-data-sync] failed to copy saved password field', error)
          void message.error(t('browserDataSync.savedPasswords.copyFailed'))
        })
    })
  }

  const toggleReveal = (record: DesktopSavedPasswordRecord) => {
    if (revealedPasswords[record.id] != null) {
      setRevealedPasswords(current => {
        const next = { ...current }
        delete next[record.id]
        return next
      })
      return
    }
    if (desktopApi?.revealSavedPassword == null) return
    void ensureAuthenticated().then((authenticated) => {
      if (!authenticated) return
      void desktopApi.revealSavedPassword?.(record.id)
        .then(password => setRevealedPasswords(current => ({ ...current, [record.id]: password })))
        .catch((error) => {
          console.error('[browser-data-sync] failed to reveal saved password', error)
          void message.error(t('browserDataSync.savedPasswords.revealFailed'))
        })
    })
  }

  const openGroup = (group: SavedPasswordGroup) => {
    setAuthenticatingGroupKey(group.key)
    void ensureAuthenticated()
      .then((authenticated) => {
        if (!authenticated) return
        onSettingsOpenChange?.(false)
        onSelectedGroupKeyChange(group.key)
      })
      .finally(() => setAuthenticatingGroupKey(null))
  }

  const handleEditRecord = (record: DesktopSavedPasswordRecord) => {
    setEditingRecord(record)
  }

  const handleSaveEdit = (values: SavedPasswordFormValues) => {
    if (editingRecord == null || desktopApi?.updateSavedPassword == null) return
    setSavingEdit(true)
    void ensureAuthenticated().then((authenticated) => {
      if (!authenticated) return
      return desktopApi.updateSavedPassword?.(editingRecord.id, {
        note: values.note ?? '',
        originUrl: values.originUrl,
        ...(values.password === '' ? {} : { password: values.password }),
        username: values.username
      }).then((updatedRecord) => {
        void message.success(t('browserDataSync.savedPasswords.updateSuccess'))
        setEditingRecord(null)
        setRevealedPasswords(current => {
          const next = { ...current }
          delete next[editingRecord.id]
          return next
        })
        onSelectedGroupKeyChange(getGroupKey(updatedRecord))
        loadRecords()
      })
    })
      .catch((error) => {
        console.error('[browser-data-sync] failed to update saved password', error)
        void message.error(t('browserDataSync.savedPasswords.updateFailed'))
      })
      .finally(() => setSavingEdit(false))
  }

  const handleDeleteRecord = (record: DesktopSavedPasswordRecord) => {
    if (desktopApi?.deleteSavedPassword == null) return
    modal.confirm({
      cancelText: t('common.cancel'),
      className: 'saved-password-manager__delete-confirm-modal',
      content: (
        <div className='saved-password-manager__delete-confirm'>
          <div className='saved-password-manager__delete-confirm-target'>
            <span className='material-symbols-rounded' aria-hidden='true'>language</span>
            <span className='saved-password-manager__delete-confirm-main'>
              <span className='saved-password-manager__delete-confirm-title'>
                {getHostLabel(record)}
              </span>
              <span className='saved-password-manager__delete-confirm-subtitle'>
                {record.username || t('browserDataSync.savedPasswords.noUsername')}
              </span>
            </span>
          </div>
          <p className='saved-password-manager__delete-confirm-description'>
            {t('browserDataSync.savedPasswords.deleteConfirmDescription')}
          </p>
        </div>
      ),
      icon: null,
      okButtonProps: {
        className: 'saved-password-manager__confirm-danger-button',
        danger: true
      },
      okText: t('common.delete'),
      title: renderIconText('delete', t('browserDataSync.savedPasswords.deleteConfirmTitle')),
      onOk: async () => {
        const authenticated = await ensureAuthenticated()
        if (!authenticated) return
        await desktopApi.deleteSavedPassword?.(record.id)
        void message.success(t('browserDataSync.savedPasswords.deleteSuccess'))
        setRevealedPasswords(current => {
          const next = { ...current }
          delete next[record.id]
          return next
        })
        if ((selectedGroup?.records.length ?? 0) <= 1) {
          onSelectedGroupKeyChange(null)
        }
        loadRecords()
      }
    })
  }

  const handleImportPasswords = (source: DesktopBrowserPasswordImportSource) => {
    if (desktopApi == null || (desktopApi.importBrowserPasswords == null && desktopApi.importChromePasswords == null)) {
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
        loadRecords()
        loadPasswordSources()
      })
      .catch((error) => {
        console.error('[browser-data-sync] failed to import browser passwords', error)
        void message.error(t('browserDataSync.savedPasswords.importSourceFailed', {
          source: source.name
        }))
      })
      .finally(() => setImportingPasswordSourceId(null))
  }

  const handleImportPasswordCsv = () => {
    if (desktopApi?.importPasswordCsv == null) {
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
        loadRecords()
        loadPasswordSources()
      })
      .catch((error) => {
        console.error('[browser-data-sync] failed to import password CSV', error)
        void message.error(t('browserDataSync.savedPasswords.importCsvFailed'))
      })
      .finally(() => setImportingPasswordCsv(false))
  }

  const updateSavedPasswordSetting = (
    patch: Pick<
      Partial<DesktopSettings>,
      'savedPasswordsAutoSignIn' | 'savedPasswordsOfferToSave' | 'savedPasswordsRequireAuth'
    >
  ) => {
    const previousSettings = desktopSettings
    setDesktopSettings(current => normalizeDesktopSettings({ ...current, ...patch }))
    if (desktopApi?.updateDesktopSettings == null) {
      void message.warning(t('browserDataSync.savedPasswords.desktopRestartRequired'))
      return
    }
    void desktopApi.updateDesktopSettings(patch)
      .then(value => setDesktopSettings(normalizeDesktopSettings(value)))
      .catch((error) => {
        console.error('[browser-data-sync] failed to save password settings', error)
        setDesktopSettings(previousSettings)
        void message.error(t('browserDataSync.savedPasswords.settingsSaveFailed'))
      })
  }

  const renderSearch = () => {
    if (settingsOpen) return null
    const isDetail = selectedGroup != null
    return (
      <div className='saved-password-manager__toolbar'>
        <Input
          allowClear
          className='saved-password-manager__search'
          disabled={!canListPasswords}
          prefix={<span className='material-symbols-rounded'>search</span>}
          placeholder={t(
            isDetail
              ? 'browserDataSync.savedPasswords.detailSearchPlaceholder'
              : 'browserDataSync.savedPasswords.searchPlaceholder'
          )}
          value={isDetail ? detailQuery : overviewQuery}
          onChange={event =>
            isDetail
              ? setDetailQuery(event.currentTarget.value)
              : setOverviewQuery(event.currentTarget.value)}
        />
      </div>
    )
  }

  const renderOverview = () => (
    <div className='saved-password-manager__overview'>
      {loading
        ? (
          <div className='config-view__state saved-password-manager__state'>
            <Spin />
          </div>
        )
        : overviewGroups.length === 0
        ? (
          <div className='config-view__field-row saved-password-manager__empty'>
            <Empty
              description={t(
                canListPasswords
                  ? 'browserDataSync.savedPasswords.empty'
                  : 'browserDataSync.savedPasswords.unavailable'
              )}
            />
          </div>
        )
        : (
          <div className='config-view__app-settings-list saved-password-manager__group-list'>
            {visibleGroups.map(group => (
              <button
                key={group.key}
                className='config-view__field-row saved-password-manager__group-row'
                type='button'
                disabled={authenticatingGroupKey != null}
                onClick={() => openGroup(group)}
              >
                <span className='config-view__field-meta'>
                  <span className='material-symbols-rounded config-view__field-icon'>language</span>
                  <span className='config-view__field-text'>
                    <span className='config-view__field-title'>{group.title}</span>
                    <span className='config-view__field-desc'>{group.displayUrl}</span>
                  </span>
                </span>
                <span className='config-view__field-control saved-password-manager__group-control'>
                  <span className='config-view__field-desc'>
                    {group.records.length > 1
                      ? t('browserDataSync.savedPasswords.groupCredentialCount', {
                        count: group.records.length
                      })
                      : ''}
                  </span>
                  {authenticatingGroupKey === group.key
                    ? <span className='material-symbols-rounded config-view__select-chevron is-loading'>
                      sync
                    </span>
                    : <span className='material-symbols-rounded config-view__select-chevron'>
                      chevron_right
                    </span>}
                </span>
              </button>
            ))}
          </div>
        )}
      {overviewGroups.length > savedPasswordPageSize && (
        <Pagination
          className='saved-password-manager__pagination'
          current={page}
          pageSize={savedPasswordPageSize}
          showSizeChanger={false}
          size='small'
          total={overviewGroups.length}
          onChange={setPage}
        />
      )}
    </div>
  )

  const renderDetail = () => (
    <div className='saved-password-manager__detail'>
      <div className='saved-password-manager__detail-list'>
        {detailRecords.length === 0
          ? (
            <div className='config-view__field-row saved-password-manager__empty'>
              <Empty description={t('browserDataSync.savedPasswords.emptyDetail')} />
            </div>
          )
          : detailRecords.map(record => (
            <div
              key={record.id}
              className='config-view__app-settings-group saved-password-manager__credential-group'
            >
              <FieldRow
                icon='person'
                title={t('browserDataSync.savedPasswords.usernameLabel')}
              >
                <div className='saved-password-manager__inline-value'>
                  <span className='saved-password-manager__text-value'>
                    {record.username || t('browserDataSync.savedPasswords.noUsername')}
                  </span>
                  <Button
                    type='text'
                    size='small'
                    icon={<span className='material-symbols-rounded'>content_copy</span>}
                    disabled={record.username === ''}
                    aria-label={t('browserDataSync.savedPasswords.copyUsername')}
                    onClick={() => copyField(record, 'username')}
                  />
                </div>
              </FieldRow>
              <FieldRow
                icon='language'
                title={t('browserDataSync.savedPasswords.websiteLabel')}
              >
                <a
                  className='saved-password-manager__text-value'
                  href={record.originUrl}
                  target='_blank'
                  rel='noreferrer'
                >
                  {getHostLabel(record)}
                </a>
              </FieldRow>
              <FieldRow
                icon='password'
                title={t('browserDataSync.savedPasswords.passwordLabel')}
              >
                <div className='saved-password-manager__inline-value'>
                  <span className='saved-password-manager__text-value saved-password-manager__password'>
                    {revealedPasswords[record.id] ?? '••••••••••••'}
                  </span>
                  <Button
                    type='text'
                    size='small'
                    icon={
                      <span className='material-symbols-rounded'>
                        {revealedPasswords[record.id] == null ? 'visibility' : 'visibility_off'}
                      </span>
                    }
                    aria-label={t(
                      revealedPasswords[record.id] == null
                        ? 'browserDataSync.savedPasswords.reveal'
                        : 'browserDataSync.savedPasswords.hide'
                    )}
                    onClick={() => toggleReveal(record)}
                  />
                  <Button
                    type='text'
                    size='small'
                    icon={<span className='material-symbols-rounded'>content_copy</span>}
                    aria-label={t('browserDataSync.savedPasswords.copyPassword')}
                    onClick={() => copyField(record, 'password')}
                  />
                </div>
              </FieldRow>
              <FieldRow
                icon='notes'
                title={t('browserDataSync.savedPasswords.noteLabel')}
              >
                <span className='config-view__field-desc saved-password-manager__text-value'>
                  {record.note?.trim() || t('browserDataSync.savedPasswords.noNote')}
                </span>
              </FieldRow>
              <div className='saved-password-manager__credential-actions'>
                <InlineActionButton
                  icon='edit'
                  onClick={() => handleEditRecord(record)}
                >
                  {t('browserDataSync.savedPasswords.edit')}
                </InlineActionButton>
                <InlineActionButton
                  icon='delete'
                  tone='danger'
                  onClick={() => handleDeleteRecord(record)}
                >
                  {t('browserDataSync.savedPasswords.delete')}
                </InlineActionButton>
              </div>
            </div>
          ))}
      </div>
    </div>
  )

  const renderSettings = () => (
    <div className='saved-password-manager__settings'>
      <div className='config-view__app-settings-group'>
        <FieldRow
          icon='key'
          title={t('browserDataSync.savedPasswords.settingsOfferToSaveTitle')}
          description={t('browserDataSync.savedPasswords.settingsOfferToSaveDescription')}
        >
          <Switch
            size='small'
            checked={desktopSettings.savedPasswordsOfferToSave}
            disabled={!canUpdateSettings}
            onChange={checked => updateSavedPasswordSetting({ savedPasswordsOfferToSave: checked })}
          />
        </FieldRow>
        <FieldRow
          icon='login'
          title={t('browserDataSync.savedPasswords.settingsAutoSignInTitle')}
          description={t('browserDataSync.savedPasswords.settingsAutoSignInDescription')}
        >
          <Switch
            size='small'
            checked={desktopSettings.savedPasswordsAutoSignIn}
            disabled={!canUpdateSettings}
            onChange={checked => updateSavedPasswordSetting({ savedPasswordsAutoSignIn: checked })}
          />
        </FieldRow>
        <FieldRow
          icon='lock'
          title={t('browserDataSync.savedPasswords.settingsRequireAuthTitle')}
          description={t('browserDataSync.savedPasswords.settingsRequireAuthDescription')}
        >
          <Switch
            size='small'
            checked={desktopSettings.savedPasswordsRequireAuth}
            disabled={!canUpdateSettings}
            onChange={checked => updateSavedPasswordSetting({ savedPasswordsRequireAuth: checked })}
          />
        </FieldRow>
      </div>
      <div className='config-view__app-settings-group'>
        <FieldRow
          icon='file_upload'
          title={t('browserDataSync.savedPasswords.settingsCsvImportTitle')}
          description={t('browserDataSync.savedPasswords.settingsCsvImportDescription')}
        >
          <InlineActionButton
            loading={importingPasswordCsv}
            icon='upload_file'
            onClick={handleImportPasswordCsv}
          >
            {t('browserDataSync.actions.chooseFile')}
          </InlineActionButton>
        </FieldRow>
        {visiblePasswordSources.map(source => (
          <FieldRow
            key={source.id}
            icon={source.icon}
            title={t('browserDataSync.savedPasswords.settingsImportSourceTitle', {
              source: source.name
            })}
            description={t(
              source.profiles > 0
                ? 'browserDataSync.savedPasswords.settingsImportSourceDescription'
                : 'browserDataSync.savedPasswords.settingsImportSourceFallbackDescription',
              {
                profiles: source.profiles,
                source: source.name
              }
            )}
          >
            <InlineActionButton
              loading={importingPasswordSourceId === source.id}
              disabled={importingPasswordSourceId != null && importingPasswordSourceId !== source.id}
              icon='sync'
              onClick={() => handleImportPasswords(source)}
            >
              {t('browserDataSync.actions.sync')}
            </InlineActionButton>
          </FieldRow>
        ))}
        <FieldRow
          icon='timer'
          title={t('browserDataSync.savedPasswords.settingsAuthCacheTitle')}
          description={t('browserDataSync.savedPasswords.settingsAuthCacheDescription')}
        >
          <span className='config-view__field-desc saved-password-manager__settings-value'>
            {t('browserDataSync.savedPasswords.settingsAuthCacheValue')}
          </span>
        </FieldRow>
      </div>
    </div>
  )

  return (
    <ConfigSectionFrame
      className='saved-password-manager'
      icon={showHeader ? 'password' : undefined}
      title={showHeader ? t('browserDataSync.savedPasswords.managerTitle') : undefined}
    >
      <div className='saved-password-manager__content'>
        {renderSearch()}
        {settingsOpen ? renderSettings() : selectedGroup == null ? renderOverview() : renderDetail()}
      </div>
      <Modal
        destroyOnClose
        className='saved-password-manager__edit-modal'
        open={editingRecord != null}
        title={renderIconText('edit_square', t('browserDataSync.savedPasswords.editTitle'))}
        okText={t('browserDataSync.savedPasswords.save')}
        cancelText={t('common.cancel')}
        confirmLoading={savingEdit}
        onCancel={() => setEditingRecord(null)}
        onOk={() => form.submit()}
      >
        <div className='saved-password-manager__edit-sheet'>
          {editingRecord != null && (
            <div className='saved-password-manager__edit-summary'>
              <span className='material-symbols-rounded' aria-hidden='true'>language</span>
              <span className='saved-password-manager__edit-summary-text'>
                <span className='saved-password-manager__edit-summary-title'>
                  {getHostLabel(editingRecord)}
                </span>
                <span className='saved-password-manager__edit-summary-subtitle'>
                  {editingRecord.username || t('browserDataSync.savedPasswords.noUsername')}
                </span>
              </span>
            </div>
          )}
          <Form
            className='saved-password-manager__edit-form'
            form={form}
            layout='vertical'
            requiredMark={false}
            onFinish={handleSaveEdit}
          >
            <Form.Item
              name='originUrl'
              label={renderIconText('language', t('browserDataSync.savedPasswords.websiteLabel'))}
              rules={[{ required: true, message: t('browserDataSync.savedPasswords.websiteRequired') }]}
            >
              <Input />
            </Form.Item>
            <Form.Item
              name='username'
              label={renderIconText('person', t('browserDataSync.savedPasswords.usernameLabel'))}
            >
              <Input />
            </Form.Item>
            <Form.Item
              name='password'
              label={renderIconText('password', t('browserDataSync.savedPasswords.passwordLabel'))}
              tooltip={t('browserDataSync.savedPasswords.passwordEditHint')}
            >
              <Input.Password autoComplete='new-password' />
            </Form.Item>
            <Form.Item
              name='note'
              label={renderIconText('notes', t('browserDataSync.savedPasswords.noteLabel'))}
            >
              <Input.TextArea autoSize={{ maxRows: 4, minRows: 2 }} />
            </Form.Item>
          </Form>
        </div>
      </Modal>
    </ConfigSectionFrame>
  )
}
