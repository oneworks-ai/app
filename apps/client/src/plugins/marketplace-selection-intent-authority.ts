import type {
  MarketplaceSelectionIntentAuthority,
  MarketplaceSelectionMutation,
  MarketplaceSourceIntentAuthority
} from './marketplace-mutation-authority-types'

const intentRevisions = new Map<string, number>()
interface MarketplaceIntentState {
  activeSelectionRevisions: Set<number>
  activeSourceRevisions: Set<number>
  latestSourceRevision: number
}

const marketplaceIntentStates = new Map<string, MarketplaceIntentState>()
let nextIntentRevision = 0

const createMarketplaceIntentKey = (serverKey: string, marketplace: string) => (
  JSON.stringify([serverKey, marketplace])
)

const getMarketplaceIntentState = (key: string) => {
  const current = marketplaceIntentStates.get(key)
  if (current != null) return current
  const created: MarketplaceIntentState = {
    activeSelectionRevisions: new Set(),
    activeSourceRevisions: new Set(),
    latestSourceRevision: 0
  }
  marketplaceIntentStates.set(key, created)
  return created
}

const retireMarketplaceIntentState = (key: string, state: MarketplaceIntentState) => {
  if (marketplaceIntentStates.get(key) !== state) return
  if (state.activeSelectionRevisions.size !== 0 || state.activeSourceRevisions.size !== 0) return
  marketplaceIntentStates.delete(key)
}

export const createMarketplaceSelectionAuthorityKey = (
  serverKey: string,
  selection: Pick<MarketplaceSelectionMutation, 'marketplace' | 'plugin' | 'target'>
) => JSON.stringify([serverKey, selection.marketplace, selection.plugin, selection.target])

export const claimMarketplaceSelectionIntentAuthority = (
  serverKey: string,
  selection: Pick<MarketplaceSelectionMutation, 'marketplace' | 'plugin' | 'target'>
): MarketplaceSelectionIntentAuthority => {
  const key = createMarketplaceSelectionAuthorityKey(serverKey, selection)
  const marketplaceKey = createMarketplaceIntentKey(serverKey, selection.marketplace)
  const marketplaceState = getMarketplaceIntentState(marketplaceKey)
  const revision = ++nextIntentRevision
  intentRevisions.set(key, revision)
  marketplaceState.activeSelectionRevisions.add(revision)
  let active = true
  return {
    isCurrent: () =>
      intentRevisions.get(key) === revision &&
      (marketplaceIntentStates.get(marketplaceKey)?.latestSourceRevision ?? 0) <= revision,
    key,
    release: () => {
      if (!active) return
      active = false
      if (intentRevisions.get(key) === revision) intentRevisions.delete(key)
      if (marketplaceIntentStates.get(marketplaceKey) !== marketplaceState) return
      marketplaceState.activeSelectionRevisions.delete(revision)
      retireMarketplaceIntentState(marketplaceKey, marketplaceState)
    },
    revision,
    serverKey
  }
}

export const claimMarketplaceSourceIntentAuthority = (
  serverKey: string,
  marketplace: string
): MarketplaceSourceIntentAuthority => {
  const key = createMarketplaceIntentKey(serverKey, marketplace)
  const state = getMarketplaceIntentState(key)
  const revision = ++nextIntentRevision
  state.activeSourceRevisions.add(revision)
  state.latestSourceRevision = revision
  let active = true
  return {
    isCurrent: () => marketplaceIntentStates.get(key) === state && state.latestSourceRevision === revision,
    key,
    marketplace,
    release: () => {
      if (!active) return
      active = false
      if (marketplaceIntentStates.get(key) !== state) return
      state.activeSourceRevisions.delete(revision)
      retireMarketplaceIntentState(key, state)
    },
    revision,
    serverKey
  }
}
