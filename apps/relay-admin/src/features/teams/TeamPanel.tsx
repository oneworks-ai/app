import './TeamPanel.css'

import { Drawer } from 'antd'

import { DataPanel } from '../../shared/ui/DataPanel'
import { TeamCreateForm } from './TeamCreateForm'
import { TeamTable } from './TeamTable'
import type { CreateTeamInput, RelayAdminTeam } from './teamTypes'

export interface TeamPanelProps {
  disabled: boolean
  isCreateOpen: boolean
  teams: RelayAdminTeam[]
  onCreateOpenChange: (open: boolean) => void
  onCreateTeam: (input: CreateTeamInput) => Promise<void>
}

export const TeamPanel = ({
  disabled,
  isCreateOpen,
  onCreateOpenChange,
  onCreateTeam,
  teams
}: TeamPanelProps) => {
  return (
    <DataPanel id='teams'>
      <Drawer
        destroyOnHidden
        open={isCreateOpen}
        title='新建团队'
        width={420}
        onClose={() => onCreateOpenChange(false)}
      >
        <TeamCreateForm
          disabled={disabled}
          onCreateTeam={onCreateTeam}
          onCreated={() => onCreateOpenChange(false)}
        />
      </Drawer>
      <div className='relay-team-panel'>
        <TeamTable teams={teams} />
      </div>
    </DataPanel>
  )
}
