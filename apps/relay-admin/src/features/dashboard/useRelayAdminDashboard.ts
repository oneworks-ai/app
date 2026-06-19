import { useCallback, useEffect, useMemo, useState } from 'react'

import { canManageRelayAdmin, isRelayAdminRole } from '../../shared/model/adminPermissions'
import type {
  CreateInviteInput,
  CreateSsoProviderInput,
  CreateUserInput,
  RelayAdminCurrentUser,
  RelayAdminDevice,
  RelayAdminInvite,
  RelayAdminRole,
  RelayAdminSsoProvider,
  RelayAdminUser,
  UpdateSsoProviderInput
} from '../../shared/model/adminTypes'
import {
  buildAdminLoginUrl,
  clearAdminSessionToken,
  listAdminSessionAccounts,
  readInitialAdminSession,
  redirectToAdminLogin,
  removeAdminSessionAccount,
  saveAdminSession,
  selectAdminSessionAccount
} from '../auth/adminSessionStorage'
import type { AdminSessionAccount } from '../auth/adminSessionStorage'
import { fetchRelayAdminMe } from '../auth/authApi'
import { resolveAdminSessionUserAvatar } from '../auth/rememberedLoginAccounts'
import { createRelayAdminInvite, deleteRelayAdminInvite, updateRelayAdminInvite } from '../invites/invitesApi'
import {
  createRelayAdminSsoProvider,
  deleteRelayAdminSsoProvider,
  updateRelayAdminSsoProvider
} from '../sso/ssoProvidersApi'
import type {
  CreateTeamInput,
  RelayAdminTeam,
  RelayAdminTeamPolicy,
  UpdateTeamInput,
  UpdateTeamPolicyInput
} from '../teams/teamTypes'
import {
  archiveRelayAdminTeam,
  createRelayAdminTeam,
  restoreRelayAdminTeam,
  updateRelayAdminTeam,
  updateRelayAdminTeamPolicy
} from '../teams/teamsApi'
import { createRelayAdminUser, updateRelayAdminUser } from '../users/usersApi'
import { fetchRelayAdminSnapshot } from './adminSnapshot'

export type RelayAdminAuthStatus = 'authorized' | 'checking' | 'forbidden' | 'missing'

export const useRelayAdminDashboard = () => {
  const initialSession = useMemo(readInitialAdminSession, [])
  const [token, setTokenState] = useState(initialSession.token)
  const [accounts, setAccounts] = useState<AdminSessionAccount[]>(listAdminSessionAccounts)
  const [authError, setAuthError] = useState<string | undefined>(initialSession.error)
  const [authStatus, setAuthStatus] = useState<RelayAdminAuthStatus>(
    initialSession.token === '' ? 'missing' : 'checking'
  )
  const [currentUser, setCurrentUser] = useState<RelayAdminCurrentUser | undefined>()
  const [devices, setDevices] = useState<RelayAdminDevice[]>([])
  const [users, setUsers] = useState<RelayAdminUser[]>([])
  const [invites, setInvites] = useState<RelayAdminInvite[]>([])
  const [ssoProviders, setSsoProviders] = useState<RelayAdminSsoProvider[]>([])
  const [teams, setTeams] = useState<RelayAdminTeam[]>([])
  const [teamPolicy, setTeamPolicy] = useState<RelayAdminTeamPolicy | undefined>()
  const [snapshotLoaded, setSnapshotLoaded] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [loginUrl] = useState(buildAdminLoginUrl)

  const canLoad = authStatus === 'authorized'
  const canManageAdmin = canManageRelayAdmin(currentUser?.role)

  const run = useCallback(async (action: () => Promise<void>) => {
    setLoading(true)
    setError(undefined)
    try {
      await action()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }, [])

  const loadSnapshot = useCallback(async () => {
    const snapshot = await fetchRelayAdminSnapshot(token, {
      includeAdminResources: canManageAdmin
    })
    setDevices(snapshot.devices)
    setUsers(snapshot.users)
    setInvites(snapshot.invites)
    setSsoProviders(snapshot.ssoProviders)
    setTeams(snapshot.teams)
    setTeamPolicy(snapshot.teamPolicy)
    setSnapshotLoaded(true)
  }, [canManageAdmin, token])

  const refresh = useCallback(async () => {
    if (!canLoad) {
      setUsers([])
      setDevices([])
      setInvites([])
      setSsoProviders([])
      setTeams([])
      setTeamPolicy(undefined)
      setSnapshotLoaded(false)
      return
    }
    await run(loadSnapshot)
  }, [canLoad, loadSnapshot, run])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (authStatus === 'missing') redirectToAdminLogin(loginUrl)
  }, [authStatus, loginUrl])

  useEffect(() => {
    let active = true
    const nextToken = token.trim()
    if (nextToken === '') {
      clearAdminSessionToken()
      setAuthStatus('missing')
      setCurrentUser(undefined)
      setSnapshotLoaded(false)
      return
    }

    setAuthStatus('checking')
    setAuthError(undefined)
    setSnapshotLoaded(false)
    void fetchRelayAdminMe(nextToken)
      .then(body => {
        if (!active) return
        const user = resolveAdminSessionUserAvatar(body.user)
        setAccounts(saveAdminSession(nextToken, user))
        setCurrentUser(user)
        setAuthStatus(isRelayAdminRole(user.role) ? 'authorized' : 'forbidden')
      })
      .catch(reason => {
        if (!active) return
        setAccounts(removeAdminSessionAccount(nextToken))
        setTokenState('')
        setCurrentUser(undefined)
        setAuthStatus('missing')
        setSnapshotLoaded(false)
        setAuthError(reason instanceof Error ? reason.message : String(reason))
      })

    return () => {
      active = false
    }
  }, [token])

  const selectAccount = useCallback((accountToken: string) => {
    const account = selectAdminSessionAccount(accountToken)
    if (account == null) return
    setTokenState(account.token)
    setCurrentUser(account.user)
    setAuthStatus('checking')
    setAuthError(undefined)
    setSnapshotLoaded(false)
  }, [])

  const logout = useCallback(() => {
    setAccounts(removeAdminSessionAccount(token))
    setTokenState('')
    setCurrentUser(undefined)
    setAuthStatus('missing')
    setAuthError(undefined)
    setSnapshotLoaded(false)
  }, [token])

  const createUser = useCallback(async (input: CreateUserInput) => {
    await run(async () => {
      await createRelayAdminUser(token, input)
      await loadSnapshot()
    })
  }, [loadSnapshot, run, token])

  const setUserRole = useCallback(async (user: RelayAdminUser, role: RelayAdminRole) => {
    if (currentUser?.id === user.id) return
    await run(async () => {
      await updateRelayAdminUser(token, { id: user.id, role })
      await loadSnapshot()
    })
  }, [currentUser?.id, loadSnapshot, run, token])

  const setUserDisabled = useCallback(async (user: RelayAdminUser, disabled: boolean) => {
    await run(async () => {
      await updateRelayAdminUser(token, { disabled, id: user.id })
      await loadSnapshot()
    })
  }, [loadSnapshot, run, token])

  const setUserPassword = useCallback(async (user: RelayAdminUser, password: string) => {
    await run(async () => {
      await updateRelayAdminUser(token, { id: user.id, password })
      await loadSnapshot()
    })
  }, [loadSnapshot, run, token])

  const setUserMaxDevices = useCallback(async (user: RelayAdminUser, maxDevices: number | null) => {
    await run(async () => {
      await updateRelayAdminUser(token, { id: user.id, maxDevices })
      await loadSnapshot()
    })
  }, [loadSnapshot, run, token])

  const setUserLoginId = useCallback(async (user: RelayAdminUser, loginId: string | null) => {
    await run(async () => {
      await updateRelayAdminUser(token, { id: user.id, loginId })
      await loadSnapshot()
    })
  }, [loadSnapshot, run, token])

  const createInvite = useCallback(async (input: CreateInviteInput) => {
    await run(async () => {
      await createRelayAdminInvite(token, input)
      await loadSnapshot()
    })
  }, [loadSnapshot, run, token])

  const setInviteRevoked = useCallback(async (invite: RelayAdminInvite, revoked: boolean) => {
    await run(async () => {
      await updateRelayAdminInvite(token, { code: invite.code, revoked })
      await loadSnapshot()
    })
  }, [loadSnapshot, run, token])

  const deleteInvite = useCallback(async (invite: RelayAdminInvite) => {
    await run(async () => {
      await deleteRelayAdminInvite(token, invite.code)
      await loadSnapshot()
    })
  }, [loadSnapshot, run, token])

  const createSsoProvider = useCallback(async (input: CreateSsoProviderInput) => {
    await run(async () => {
      await createRelayAdminSsoProvider(token, input)
      await loadSnapshot()
    })
  }, [loadSnapshot, run, token])

  const updateSsoProvider = useCallback(async (input: UpdateSsoProviderInput) => {
    await run(async () => {
      await updateRelayAdminSsoProvider(token, input)
      await loadSnapshot()
    })
  }, [loadSnapshot, run, token])

  const setSsoProviderEnabled = useCallback(async (provider: RelayAdminSsoProvider, enabled: boolean) => {
    await run(async () => {
      await updateRelayAdminSsoProvider(token, { enabled, id: provider.id })
      await loadSnapshot()
    })
  }, [loadSnapshot, run, token])

  const deleteSsoProvider = useCallback(async (provider: RelayAdminSsoProvider) => {
    await run(async () => {
      await deleteRelayAdminSsoProvider(token, provider.id)
      await loadSnapshot()
    })
  }, [loadSnapshot, run, token])

  const createTeam = useCallback(async (input: CreateTeamInput) => {
    await run(async () => {
      await createRelayAdminTeam(token, input)
      await loadSnapshot()
    })
  }, [loadSnapshot, run, token])

  const setTeamArchived = useCallback(async (team: RelayAdminTeam, archived: boolean) => {
    await run(async () => {
      if (archived) {
        await archiveRelayAdminTeam(token, team.id)
      } else {
        await restoreRelayAdminTeam(token, team.id)
      }
      await loadSnapshot()
    })
  }, [loadSnapshot, run, token])

  const updateTeam = useCallback(async (team: RelayAdminTeam, input: UpdateTeamInput) => {
    await run(async () => {
      await updateRelayAdminTeam(token, team, input)
      await loadSnapshot()
    })
  }, [loadSnapshot, run, token])

  const updateTeamPolicy = useCallback(async (input: UpdateTeamPolicyInput) => {
    await run(async () => {
      const body = await updateRelayAdminTeamPolicy(token, input)
      setTeamPolicy(body.policy)
      await loadSnapshot()
    })
  }, [loadSnapshot, run, token])

  return {
    canLoad,
    accounts,
    createInvite,
    createSsoProvider,
    createTeam,
    createUser,
    authError,
    authStatus,
    currentUser,
    devices,
    deleteInvite,
    deleteSsoProvider,
    error,
    invites,
    loginUrl,
    loading,
    logout,
    refresh,
    selectAccount,
    setInviteRevoked,
    setTeamArchived,
    setUserMaxDevices,
    setSsoProviderEnabled,
    setUserDisabled,
    setUserLoginId,
    setUserPassword,
    setUserRole,
    snapshotLoaded,
    ssoProviders,
    teamPolicy,
    teams,
    token,
    updateTeam,
    updateTeamPolicy,
    updateSsoProvider,
    users
  }
}

export type RelayAdminDashboardState = ReturnType<typeof useRelayAdminDashboard>
