import type { SqliteDatabase } from '../sqlite'
import { createChannelAccountsRepo } from './accounts-repo'
import { createAuthorizationRequestsRepo } from './authorization-requests-repo'
import { createCredentialsRepo } from './credentials-repo'
import { createIdentityLinkCodesRepo } from './link-codes-repo'
import { createLegacyChannelIdentityMigration } from './migration'

export type {
  CanonicalUserRow,
  ChannelAccountRow,
  ChannelIdentityLinkRow,
  ChannelIdentityLinkStatus
} from './account-record'
export type { ChannelAuthorizationRequestRow, ChannelAuthorizationRequestStatus } from './authorization-request-record'
export type { ChannelCredentialStatus, ChannelUserCredentialRow } from './credential-record'
export type { JsonRecord } from './json'
export type {
  ChannelIdentityLinkCodeConsumeResult,
  ChannelIdentityLinkCodeConsumeStatus,
  ChannelIdentityLinkCodeRow,
  ChannelIdentityLinkCodeStatus
} from './link-code-record'

export function createChannelIdentitiesRepo(db: SqliteDatabase) {
  const accounts = createChannelAccountsRepo(db)
  const linkCodes = createIdentityLinkCodesRepo(db, accounts)
  const credentials = createCredentialsRepo(db)
  const authorizationRequests = createAuthorizationRequestsRepo(db)
  const migrateLegacyNamespace = createLegacyChannelIdentityMigration(db)

  return {
    consumeIdentityLinkCode: linkCodes.consumeIdentityLinkCode,
    createAuthorizationRequest: authorizationRequests.createAuthorizationRequest,
    createIdentityLinkCode: linkCodes.createIdentityLinkCode,
    ensureCanonicalUser: accounts.ensureCanonicalUser,
    getAccount: accounts.getAccount,
    getAuthorizationRequest: authorizationRequests.getAuthorizationRequest,
    getCanonicalUser: accounts.getCanonicalUser,
    getCredential: credentials.getCredential,
    getIdentityLink: accounts.getIdentityLink,
    getIdentityLinkCode: linkCodes.getIdentityLinkCode,
    linkAccountToUser: accounts.linkAccountToUser,
    listAccountsForUser: accounts.listAccountsForUser,
    listCredentialsForUser: credentials.listCredentialsForUser,
    listPendingAuthorizationRequestsForAccount: authorizationRequests.listPendingAuthorizationRequestsForAccount,
    listPendingAuthorizationRequestsForUser: authorizationRequests.listPendingAuthorizationRequestsForUser,
    migrateLegacyNamespace,
    resolveAuthorizationRequest: authorizationRequests.resolveAuthorizationRequest,
    resolveUserByAccount: accounts.resolveUserByAccount,
    updateAuthorizationRequest: authorizationRequests.updateAuthorizationRequest,
    upsertAccount: accounts.upsertAccount,
    upsertCredential: credentials.upsertCredential
  }
}
