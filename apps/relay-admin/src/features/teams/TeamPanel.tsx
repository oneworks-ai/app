import './TeamPanel.css'

import { Drawer } from 'antd'
import { useEffect, useMemo, useState } from 'react'

import { DataPanel } from '../../shared/ui/DataPanel'
import { TeamConfigProfiles } from './TeamConfigProfiles'
import { TeamCreateForm } from './TeamCreateForm'
import { TeamPolicyForm } from './TeamPolicyForm'
import { TeamTable } from './TeamTable'
import type { CreateTeamInput, RelayAdminTeam, RelayAdminTeamPolicy, UpdateTeamPolicyInput } from './teamTypes'

export interface TeamPanelProps {
  disabled: boolean
  isCreateOpen: boolean
  policy?: RelayAdminTeamPolicy
  teams: RelayAdminTeam[]
  token: string
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
  teams,
  token
}: TeamPanelProps) => {
  const [selectedTeamId, setSelectedTeamId] = useState<string | undefined>()
  const selectedTeam = useMemo(
    () => teams.find(team => team.id === selectedTeamId) ?? teams[0],
    [selectedTeamId, teams]
  )

  useEffect(() => {
    if (selectedTeamId != null && teams.some(team => team.id === selectedTeamId)) return
    setSelectedTeamId(teams[0]?.id)
  }, [selectedTeamId, teams])

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
        <div className='relay-team-panel__layout'>
          <div className='relay-team-panel__left'>
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
            <section className='relay-team-panel__section'>
              <div className='relay-team-panel__section-header'>
                <h3>团队</h3>
              </div>
              <TeamTable
                selectedTeamId={selectedTeam?.id}
                teams={teams}
                onSelectTeam={setSelectedTeamId}
              />
            </section>
          </div>
          <section className='relay-team-panel__section relay-team-panel__right'>
            <TeamConfigProfiles
              disabled={disabled || policy?.teamsEnabled === false}
              team={selectedTeam}
              token={token}
            />
          </section>
        </div>
      </div>
    </DataPanel>
  )
}
