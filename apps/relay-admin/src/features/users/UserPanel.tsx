import './UserPanel.css'

import { Drawer } from 'antd'

import type {
  CreateUserInput,
  RelayAdminCurrentUser,
  RelayAdminRole,
  RelayAdminUser
} from '../../shared/model/adminTypes'
import { DataPanel } from '../../shared/ui/DataPanel'
import { UserCreateForm } from './UserCreateForm'
import { UserTable } from './UserTable'

export interface UserPanelProps {
  currentUser?: RelayAdminCurrentUser
  disabled: boolean
  isCreateOpen: boolean
  onCreateUser: (input: CreateUserInput) => Promise<void>
  onCreateOpenChange: (open: boolean) => void
  onSetDisabled: (user: RelayAdminUser, disabled: boolean) => Promise<void>
  onSetMaxDevices: (user: RelayAdminUser, maxDevices: number | null) => Promise<void>
  onSetPassword: (user: RelayAdminUser, password: string) => Promise<void>
  onSetRole: (user: RelayAdminUser, role: RelayAdminRole) => Promise<void>
  users: RelayAdminUser[]
}

export const UserPanel = ({
  currentUser,
  disabled,
  isCreateOpen,
  onCreateUser,
  onCreateOpenChange,
  onSetDisabled,
  onSetMaxDevices,
  onSetPassword,
  onSetRole,
  users
}: UserPanelProps) => {
  return (
    <DataPanel id='users'>
      <Drawer
        destroyOnHidden
        open={isCreateOpen}
        title='新建用户'
        width={420}
        onClose={() => onCreateOpenChange(false)}
      >
        <UserCreateForm
          disabled={disabled}
          onCreated={() => onCreateOpenChange(false)}
          onCreateUser={onCreateUser}
        />
      </Drawer>
      <UserTable
        currentUser={currentUser}
        disabled={disabled}
        onSetDisabled={onSetDisabled}
        onSetMaxDevices={onSetMaxDevices}
        onSetPassword={onSetPassword}
        onSetRole={onSetRole}
        users={users}
      />
    </DataPanel>
  )
}
