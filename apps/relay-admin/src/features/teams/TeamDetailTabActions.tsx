import type { ReactNode } from 'react'
import { createContext, useContext, useEffect } from 'react'

export type TeamDetailTabKey = 'members' | 'profiles' | 'secrets'

export interface TeamDetailTabActionsContextValue {
  registerTabActions: (key: TeamDetailTabKey, actions: ReactNode | undefined) => () => void
}

export const TeamDetailTabActionsContext = createContext<TeamDetailTabActionsContextValue | undefined>(undefined)

export const useTeamDetailTabActions = (key: TeamDetailTabKey, actions: ReactNode | undefined) => {
  const context = useContext(TeamDetailTabActionsContext)

  useEffect(() => {
    if (context == null) return undefined
    return context.registerTabActions(key, actions)
  }, [actions, context, key])
}
