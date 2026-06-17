import { DeviceDetailPage } from '../devices/DeviceDetailPage'
import { DevicePanel } from '../devices/DevicePanel'
import { InvitePanel } from '../invites/InvitePanel'
import { MessageCenterPage } from '../messages/MessageCenterPage'
import { ProfilePage } from '../profile/ProfilePage'
import { SsoProviderPanel } from '../sso/SsoProviderPanel'
import { TeamDetailPage } from '../teams/TeamDetailPage'
import { TeamDetailSettingsPage } from '../teams/TeamDetailSettingsPage'
import { TeamPanel } from '../teams/TeamPanel'
import { TeamSettingsPage } from '../teams/TeamSettingsPage'
import { UserDetailPage } from '../users/UserDetailPage'
import { UserPanel } from '../users/UserPanel'
import { AdminStatusBar } from './AdminStatusBar'
import type { RelayAdminDashboardState } from './useRelayAdminDashboard'

export type AdminDashboardSectionId =
  | 'device-detail'
  | 'devices'
  | 'profile'
  | 'user-detail'
  | 'users'
  | 'invites'
  | 'messages'
  | 'sso'
  | 'team-detail'
  | 'team-detail-settings'
  | 'team-settings'
  | 'teams'
export type AdminDashboardCreateSectionId = Extract<AdminDashboardSectionId, 'invites' | 'sso' | 'teams' | 'users'>

export interface AdminDashboardProps {
  createSectionId?: AdminDashboardCreateSectionId
  dashboard: RelayAdminDashboardState
  messageId?: string
  openMessageComposerSignal?: number
  resetTeamDetailSettingsSignal?: number
  sectionId: AdminDashboardSectionId
  onCreateSectionChange?: (sectionId: AdminDashboardCreateSectionId | undefined) => void
}

export const AdminDashboard = ({
  createSectionId,
  dashboard,
  messageId,
  openMessageComposerSignal,
  resetTeamDetailSettingsSignal,
  sectionId,
  onCreateSectionChange
}: AdminDashboardProps) => {
  const disabled = dashboard.loading || !dashboard.canLoad
  const statusBar = (
    <AdminStatusBar
      authError={dashboard.authError}
      authStatus={dashboard.authStatus}
      currentUser={dashboard.currentUser}
      error={dashboard.error}
      loginUrl={dashboard.loginUrl}
      loading={dashboard.loading}
    />
  )

  if (dashboard.authStatus === 'missing') {
    return <div className='relay-admin__content'>{statusBar}</div>
  }

  return (
    <div className='relay-admin__content'>
      {statusBar}

      {sectionId === 'devices' && (
        <DevicePanel
          devices={dashboard.devices}
        />
      )}
      {sectionId === 'device-detail' && (
        <DeviceDetailPage
          currentUser={dashboard.currentUser}
          devices={dashboard.devices}
          loading={dashboard.loading || dashboard.authStatus === 'checking'}
          token={dashboard.token}
          users={dashboard.users}
        />
      )}
      {sectionId === 'users' && (
        <UserPanel
          currentUser={dashboard.currentUser}
          disabled={disabled}
          isCreateOpen={createSectionId === 'users'}
          onCreateUser={dashboard.createUser}
          onCreateOpenChange={open => onCreateSectionChange?.(open ? 'users' : undefined)}
          onSetDisabled={dashboard.setUserDisabled}
          onSetMaxDevices={dashboard.setUserMaxDevices}
          onSetPassword={dashboard.setUserPassword}
          onSetRole={dashboard.setUserRole}
          users={dashboard.users}
        />
      )}
      {sectionId === 'user-detail' && (
        <UserDetailPage
          currentUser={dashboard.currentUser}
          devices={dashboard.devices}
          disabled={disabled}
          invites={dashboard.invites}
          loading={dashboard.loading || dashboard.authStatus === 'checking'}
          teams={dashboard.teams}
          token={dashboard.token}
          onSetMaxDevices={dashboard.setUserMaxDevices}
          onSetRole={dashboard.setUserRole}
          users={dashboard.users}
        />
      )}
      {sectionId === 'profile' && (
        <ProfilePage
          accounts={dashboard.accounts}
          activeToken={dashboard.token}
          currentUser={dashboard.currentUser}
        />
      )}
      {sectionId === 'messages' && (
        <MessageCenterPage
          accounts={dashboard.accounts}
          activeToken={dashboard.token}
          currentUser={dashboard.currentUser}
          messageId={messageId}
          openComposerSignal={openMessageComposerSignal}
          teams={dashboard.teams}
          token={dashboard.token}
          users={dashboard.users}
          onTeamInvitationChanged={dashboard.refresh}
        />
      )}
      {sectionId === 'invites' && (
        <InvitePanel
          disabled={disabled}
          isCreateOpen={createSectionId === 'invites'}
          invites={dashboard.invites}
          onCreateInvite={dashboard.createInvite}
          onCreateOpenChange={open => onCreateSectionChange?.(open ? 'invites' : undefined)}
          onDeleteInvite={dashboard.deleteInvite}
          onSetRevoked={dashboard.setInviteRevoked}
        />
      )}
      {sectionId === 'sso' && (
        <SsoProviderPanel
          disabled={disabled}
          isCreateOpen={createSectionId === 'sso'}
          onCreateProvider={dashboard.createSsoProvider}
          onCreateOpenChange={open => onCreateSectionChange?.(open ? 'sso' : undefined)}
          onDeleteProvider={dashboard.deleteSsoProvider}
          onSetEnabled={dashboard.setSsoProviderEnabled}
          onUpdateProvider={dashboard.updateSsoProvider}
          providers={dashboard.ssoProviders}
        />
      )}
      {sectionId === 'teams' && (
        <TeamPanel
          disabled={disabled}
          isCreateOpen={createSectionId === 'teams'}
          teams={dashboard.teams}
          onCreateOpenChange={open => onCreateSectionChange?.(open ? 'teams' : undefined)}
          onCreateTeam={dashboard.createTeam}
          onSetArchived={dashboard.setTeamArchived}
        />
      )}
      {sectionId === 'team-settings' && (
        <TeamSettingsPage
          disabled={disabled}
          policy={dashboard.teamPolicy}
          onUpdatePolicy={dashboard.updateTeamPolicy}
        />
      )}
      {sectionId === 'team-detail' && (
        <TeamDetailPage
          disabled={disabled}
          loading={dashboard.loading || dashboard.authStatus === 'checking'}
          policy={dashboard.teamPolicy}
          teams={dashboard.teams}
          token={dashboard.token}
        />
      )}
      {sectionId === 'team-detail-settings' && (
        <TeamDetailSettingsPage
          disabled={disabled}
          loading={dashboard.loading || dashboard.authStatus === 'checking'}
          resetSignal={resetTeamDetailSettingsSignal}
          teams={dashboard.teams}
          onUpdateTeam={dashboard.updateTeam}
        />
      )}
    </div>
  )
}
