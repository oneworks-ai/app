import './InvitePanel.css'

import { Drawer } from 'antd'

import type { CreateInviteInput, RelayAdminInvite } from '../../shared/model/adminTypes'
import { DataPanel } from '../../shared/ui/DataPanel'
import { InviteCreateForm } from './InviteCreateForm'
import { InviteTable } from './InviteTable'

export interface InvitePanelProps {
  disabled: boolean
  isCreateOpen: boolean
  invites: RelayAdminInvite[]
  onCreateInvite: (input: CreateInviteInput) => Promise<void>
  onCreateOpenChange: (open: boolean) => void
  onDeleteInvite: (invite: RelayAdminInvite) => Promise<void>
  onSetRevoked: (invite: RelayAdminInvite, revoked: boolean) => Promise<void>
}

export const InvitePanel = ({
  disabled,
  isCreateOpen,
  invites,
  onCreateInvite,
  onCreateOpenChange,
  onDeleteInvite,
  onSetRevoked
}: InvitePanelProps) => {
  return (
    <DataPanel id='invites'>
      <Drawer
        destroyOnHidden
        open={isCreateOpen}
        title='新建邀请码'
        width={420}
        onClose={() => onCreateOpenChange(false)}
      >
        <InviteCreateForm
          disabled={disabled}
          onCreated={() => onCreateOpenChange(false)}
          onCreateInvite={onCreateInvite}
        />
      </Drawer>
      <InviteTable
        disabled={disabled}
        invites={invites}
        onDeleteInvite={onDeleteInvite}
        onSetRevoked={onSetRevoked}
      />
    </DataPanel>
  )
}
