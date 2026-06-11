import type { RelayAdminCurrentUser } from '../../shared/model/adminTypes'
import { AdminIcon } from '../../shared/ui/AdminIcon'
import { StatusBadge } from '../../shared/ui/StatusBadge'
import type { RelayAdminAuthStatus } from './useRelayAdminDashboard'

export interface AdminStatusBarProps {
  authError?: string
  authStatus: RelayAdminAuthStatus
  currentUser?: RelayAdminCurrentUser
  error?: string
  loginUrl: string
  loading: boolean
}

export const AdminStatusBar = ({
  authError,
  authStatus,
  currentUser,
  error,
  loginUrl,
  loading
}: AdminStatusBarProps) => {
  if (authStatus === 'missing') return null
  if (!loading && error == null && authError == null && authStatus === 'authorized') return null

  const showLoginAction = authStatus === 'forbidden'

  return (
    <div className='relay-admin__status' aria-live='polite'>
      {loading ? <StatusBadge tone='muted'>loading</StatusBadge> : null}
      {error == null ? null : <StatusBadge tone='danger'>{error}</StatusBadge>}
      {authError == null ? null : <StatusBadge tone='danger'>{authError}</StatusBadge>}
      {authStatus === 'checking' ? <StatusBadge tone='muted'>checking session</StatusBadge> : null}
      {authStatus === 'forbidden'
        ? (
          <StatusBadge tone='danger'>
            {currentUser == null ? 'admin account required' : `${currentUser.email} is not an admin`}
          </StatusBadge>
        )
        : null}
      {showLoginAction
        ? (
          <a className='relay-admin__status-action' href={loginUrl}>
            <AdminIcon name='login' />
            <span>Switch account</span>
          </a>
        )
        : null}
    </div>
  )
}
