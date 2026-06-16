import './TeamPanel.css'

import { Drawer } from 'antd'

import { DataPanel } from '../../shared/ui/DataPanel'
import { TeamCreateForm } from './TeamCreateForm'
import { TeamPolicyForm } from './TeamPolicyForm'
import { TeamTable } from './TeamTable'
import type { CreateTeamInput, RelayAdminTeam, RelayAdminTeamPolicy, UpdateTeamPolicyInput } from './teamTypes'

export interface TeamPanelProps {
  disabled: boolean
  isCreateOpen: boolean
  policy?: RelayAdminTeamPolicy
  teams: RelayAdminTeam[]
  onCreateOpenChange: (open: boolean) => void
  onCreateTeam: (input: CreateTeamInput) => Promise<void>
  onUpdatePolicy: (input: UpdateTeamPolicyInput) => Promise<void>
}

export const TeamPanel = ({
  disabled,
  isCreateOpen,
  onCreateOpenChange,
  onCreateTeam,
  onUpdatePolicy,
  policy,
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
        <div className='relay-team-panel__list-layout'>
          <section className='relay-team-panel__section'>
            <div className='relay-team-panel__section-header'>
              <h3>站点策略</h3>
            </div>
            <TeamPolicyForm
              disabled={disabled}
              policy={policy}
              onUpdatePolicy={onUpdatePolicy}
            />
          </section>
          <section className='relay-team-panel__section relay-team-panel__team-list-section'>
            <div className='relay-team-panel__section-header'>
              <h3>团队</h3>
            </div>
            <TeamTable teams={teams} />
          </section>
        </div>
      </div>
    </DataPanel>
  )
}
