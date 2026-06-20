import { Empty } from 'antd'
import { useNavigate, useParams } from 'react-router-dom'

import type {
  CreateAccessGroupInput,
  RelayAdminAccessGroup,
  UpdateAccessGroupInput
} from '../../shared/model/adminTypes'
import { DataPanel } from '../../shared/ui/DataPanel'
import { AccessGroupForm } from './AccessGroupPanel'

export interface AccessGroupEditorPageProps {
  disabled: boolean
  groups: RelayAdminAccessGroup[]
  mode: 'create' | 'edit'
  onCreateGroup: (input: CreateAccessGroupInput) => Promise<void>
  onUpdateGroup: (input: UpdateAccessGroupInput) => Promise<void>
}

export const AccessGroupEditorPage = ({
  disabled,
  groups,
  mode,
  onCreateGroup,
  onUpdateGroup
}: AccessGroupEditorPageProps) => {
  const { groupId } = useParams()
  const navigate = useNavigate()
  const group = mode === 'edit'
    ? groups.find(item => item.scope === 'platform' && item.id === groupId)
    : undefined
  const navigateBack = () => void navigate('/access-groups')

  if (mode === 'edit' && group == null) {
    return (
      <DataPanel id='access-group-editor'>
        <section className='relay-access-groups__editor'>
          <Empty description='用户组不存在' />
        </section>
      </DataPanel>
    )
  }

  return (
    <DataPanel id='access-group-editor'>
      <section className='relay-access-groups__editor'>
        <AccessGroupForm
          disabled={disabled}
          group={group}
          groups={groups}
          mode={mode}
          scope='platform'
          onCancel={navigateBack}
          onCreateGroup={onCreateGroup}
          onUpdateGroup={onUpdateGroup}
        />
      </section>
    </DataPanel>
  )
}
