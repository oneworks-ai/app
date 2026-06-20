import './TeamPanel.css'

import { DataPanel } from '../../shared/ui/DataPanel'
import { TeamPolicyForm } from './TeamPolicyForm'
import type { RelayAdminTeamPolicy, UpdateTeamPolicyInput } from './teamTypes'

export interface TeamSettingsPageProps {
  disabled: boolean
  policy?: RelayAdminTeamPolicy
  onUpdatePolicy: (input: UpdateTeamPolicyInput) => Promise<void>
}

export const TeamSettingsPage = ({ disabled, onUpdatePolicy, policy }: TeamSettingsPageProps) => (
  <DataPanel id='team-settings'>
    <div className='relay-team-panel relay-team-panel--settings'>
      <TeamPolicyForm
        disabled={disabled}
        policy={policy}
        onUpdatePolicy={onUpdatePolicy}
      />
    </div>
  </DataPanel>
)
