import type { ConfigSource } from '@oneworks/types'
import { useState } from 'react'

import { ActionSearchToolbar } from '#~/components/action-search-toolbar/ActionSearchToolbar'
import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'
import { MobileAwareSelect } from '#~/components/mobile-aware-select/MobileAwareSelect'

import { AdapterImportDialog } from './AdapterImportDialog'
import type { AdapterImportAction } from './AdapterImportRow'
import { ConfigRecordCreateRow } from './ConfigRecordList'
import type { TranslationFn } from './configUtils'
import { getModelServiceConfigSessionActionKey } from './modelServiceConfigSession'
import type { ModelServiceConfigSessionRequest } from './modelServiceConfigSession'

export function ModelServiceCollectionToolbar({
  createKindOptions,
  creatingModelServiceSessionKey,
  existingKeys,
  modelServiceImportAction,
  newRecordKey,
  newRecordKind,
  onCreateManual,
  onCreateModelServiceSession,
  onNewRecordKeyChange,
  onNewRecordKindChange,
  onQueryChange,
  onShowAvailableChange,
  onShowConfiguredChange,
  onShowCreateRowChange,
  query,
  showAvailable,
  showConfigured,
  showCreateRow,
  source,
  t
}: {
  createKindOptions: Array<{ label: string; value: string }>
  creatingModelServiceSessionKey?: string | null
  existingKeys: Set<string>
  modelServiceImportAction?: AdapterImportAction
  newRecordKey: string
  newRecordKind: string
  onCreateManual: (recordKey: string) => void
  onCreateModelServiceSession?: (request: ModelServiceConfigSessionRequest) => void | Promise<void>
  onNewRecordKeyChange: (value: string) => void
  onNewRecordKindChange: (value: string) => void
  onQueryChange: (value: string) => void
  onShowAvailableChange: (value: boolean) => void
  onShowConfiguredChange: (value: boolean) => void
  onShowCreateRowChange: (value: boolean) => void
  query: string
  showAvailable: boolean
  showConfigured: boolean
  showCreateRow: boolean
  source: ConfigSource
  t: TranslationFn
}) {
  const [isImportDialogOpen, setImportDialogOpen] = useState(false)
  const normalizedRecordKey = newRecordKey.trim()
  const invalidRecordKey = normalizedRecordKey === '' ||
    normalizedRecordKey.includes('/') ||
    existingKeys.has(normalizedRecordKey)
  const createSessionActionKey = getModelServiceConfigSessionActionKey({ mode: 'create', source })

  return (
    <>
      <ActionSearchToolbar
        className='model-service-collection__toolbar'
        query={query}
        onQueryChange={onQueryChange}
        placeholder={t('config.modelServices.collection.searchPlaceholder')}
        actions={[
          ...(modelServiceImportAction == null
            ? []
            : [{
              ariaLabel: modelServiceImportAction.actionLabel,
              disabled: modelServiceImportAction.disabled || modelServiceImportAction.loading ||
                modelServiceImportAction.optionsLoading,
              icon: 'file_download',
              key: 'import',
              loading: modelServiceImportAction.loading,
              onClick: () => setImportDialogOpen(true),
              title: modelServiceImportAction.title ?? modelServiceImportAction.actionLabel
            }]),
          {
            active: showConfigured,
            ariaLabel: t('config.modelServices.collection.filters.configured'),
            icon: 'check_circle',
            key: 'configured',
            onClick: () => onShowConfiguredChange(!showConfigured),
            pressed: showConfigured,
            title: t('config.modelServices.collection.filters.configured')
          },
          {
            active: showAvailable,
            ariaLabel: t('config.modelServices.collection.filters.available'),
            icon: 'add_circle',
            key: 'available',
            onClick: () => onShowAvailableChange(!showAvailable),
            pressed: showAvailable,
            title: t('config.modelServices.collection.filters.available')
          },
          {
            active: showCreateRow,
            ariaLabel: t('config.modelServices.collection.actions.addCustom'),
            icon: 'add',
            key: 'add',
            onClick: () => onShowCreateRowChange(!showCreateRow),
            pressed: showCreateRow,
            title: t('config.modelServices.collection.actions.addCustom')
          }
        ]}
      />

      {showCreateRow && (
        <ConfigRecordCreateRow
          className='model-service-collection__create'
          value={newRecordKey}
          onValueChange={onNewRecordKeyChange}
          placeholder={t('config.editor.newModelServiceName')}
          onSubmit={() => {
            if (!invalidRecordKey) onCreateManual(normalizedRecordKey)
          }}
          actions={[
            ...(onCreateModelServiceSession == null
              ? []
              : [{
                ariaLabel: t('config.actions.createModelServiceWithSession'),
                disabled: creatingModelServiceSessionKey != null &&
                  creatingModelServiceSessionKey !== createSessionActionKey,
                icon: <MaterialSymbol name='forum' />,
                key: 'session',
                loading: creatingModelServiceSessionKey === createSessionActionKey,
                onClick: () => void onCreateModelServiceSession({ mode: 'create', source }),
                title: t('config.actions.createModelServiceWithSession')
              }]),
            {
              ariaLabel: t('common.confirm'),
              disabled: invalidRecordKey,
              icon: <MaterialSymbol name='check' />,
              key: 'confirm',
              onClick: () => onCreateManual(normalizedRecordKey),
              title: t('common.confirm'),
              type: 'primary'
            }
          ]}
          hint={createKindOptions.length > 0
            ? (
              <MobileAwareSelect
                className='model-service-collection__create-kind'
                value={newRecordKind}
                options={createKindOptions}
                onChange={onNewRecordKindChange}
                aria-label={t('config.modelServices.createKinds.label')}
              />
            )
            : undefined}
        />
      )}

      {modelServiceImportAction != null && (
        <AdapterImportDialog
          action={modelServiceImportAction}
          cancelLabel={t('common.cancel')}
          open={isImportDialogOpen}
          title={modelServiceImportAction.actionLabel}
          onClose={() => setImportDialogOpen(false)}
        />
      )}
    </>
  )
}
