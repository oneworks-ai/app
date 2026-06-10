import './SsoProviderPanel.css'

import { Drawer } from 'antd'
import { useMemo, useState } from 'react'

import type {
  CreateSsoProviderInput,
  RelayAdminSsoProvider,
  UpdateSsoProviderInput
} from '../../shared/model/adminTypes'
import { DataPanel } from '../../shared/ui/DataPanel'
import { SsoProviderCreateForm } from './SsoProviderCreateForm'
import { SsoProviderEditForm } from './SsoProviderEditForm'
import { SsoProviderTable } from './SsoProviderTable'

export interface SsoProviderPanelProps {
  disabled: boolean
  isCreateOpen: boolean
  onCreateProvider: (input: CreateSsoProviderInput) => Promise<void>
  onCreateOpenChange: (open: boolean) => void
  onDeleteProvider: (provider: RelayAdminSsoProvider) => Promise<void>
  onSetEnabled: (provider: RelayAdminSsoProvider, enabled: boolean) => Promise<void>
  onUpdateProvider: (input: UpdateSsoProviderInput) => Promise<void>
  providers: RelayAdminSsoProvider[]
}

export const SsoProviderPanel = ({
  disabled,
  isCreateOpen,
  onCreateProvider,
  onCreateOpenChange,
  onDeleteProvider,
  onSetEnabled,
  onUpdateProvider,
  providers
}: SsoProviderPanelProps) => {
  const [editingProviderId, setEditingProviderId] = useState<string | undefined>()
  const editingProvider = useMemo(
    () => providers.find(provider => provider.id === editingProviderId),
    [editingProviderId, providers]
  )

  return (
    <DataPanel id='sso'>
      <Drawer
        destroyOnHidden
        open={isCreateOpen}
        title='新建 SSO'
        width={520}
        onClose={() => onCreateOpenChange(false)}
      >
        <SsoProviderCreateForm
          disabled={disabled}
          onCreated={() => onCreateOpenChange(false)}
          onCreateProvider={onCreateProvider}
        />
      </Drawer>
      <Drawer
        destroyOnHidden
        open={editingProvider != null}
        title={editingProvider == null ? '编辑 SSO' : `编辑 ${editingProvider.name}`}
        width={520}
        onClose={() => setEditingProviderId(undefined)}
      >
        {editingProvider == null ? null : (
          <SsoProviderEditForm
            key={editingProvider.id}
            disabled={disabled}
            onCancel={() => setEditingProviderId(undefined)}
            onUpdateProvider={onUpdateProvider}
            provider={editingProvider}
          />
        )}
      </Drawer>
      <SsoProviderTable
        disabled={disabled}
        onDeleteProvider={onDeleteProvider}
        onEditProvider={provider => setEditingProviderId(provider.id)}
        onSetEnabled={onSetEnabled}
        providers={providers}
      />
    </DataPanel>
  )
}
