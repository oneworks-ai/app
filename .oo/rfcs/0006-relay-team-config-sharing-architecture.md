# RFC 0006 Details: Relay 团队配置共享架构

返回入口：[RFC 0006: Relay 团队配置共享](./0006-relay-team-config-sharing.md)

## Data Model

```ts
interface RelayTeam {
  id: string
  slug: string
  name: string
  description?: string
  createdByUserId: string
  archivedAt?: string
  createdAt: string
  updatedAt?: string
}

interface RelayTeamMember {
  teamId: string
  userId: string
  role: 'owner' | 'admin' | 'editor' | 'member' | 'viewer'
  createdByUserId: string
  createdAt: string
  updatedAt?: string
}

interface RelayConfigProfile {
  id: string
  teamId: string
  name: string
  description?: string
  status: 'draft' | 'published' | 'disabled'
  activeVersionId?: string
  createdByUserId: string
  updatedByUserId?: string
  createdAt: string
  updatedAt?: string
}

interface RelayConfigProfileVersion {
  id: string
  profileId: string
  version: number
  allowedFields: RelayConfigSafeField[]
  configPatch: RelayConfigPatch
  secretRefs?: Record<string, string>
  sourceHash: string
  createdByUserId: string
  changeNote?: string
  createdAt: string
}

interface RelayConfigProfileAssignment {
  id: string
  profileId: string
  versionId?: string
  priority: number
  target: { userIds?: string[]; teamIds?: string[] }
  project?: { allow?: string[]; deny?: string[] }
  mode: 'default' | 'override'
  enabled: boolean
  createdAt: string
  updatedAt?: string
}
```

Storage driver 第一阶段继续共享 normalized Relay store。Postgres 和 SQLite 后续可以把这些对象拆成表，但 route/service 不能依赖具体 driver。

## Snapshot Semantics

Snapshot calculation is deterministic:

1. Resolve authenticated user.
2. Resolve active team memberships and team roles.
3. Filter profile assignments by `team.configs.consume`.
4. Filter by device project context.
5. Sort by `priority`, then `updatedAt`, then `id`.
6. Merge patches in order.
7. Attach conflict diagnostics and provenance.

Snapshot response adds:

```ts
interface RelayConfigSnapshotProvenance {
  teamId: string
  teamName?: string
  profileId: string
  profileName: string
  versionId: string
  version: number
  assignmentId: string
  mode: 'default' | 'override'
  fields: RelayConfigSafeField[]
}
```

Every applied field should be traceable to team, profile, version, and assignment. This is required for plugin UI, audit review, and support debugging.

## API Surface

Team API:

- `GET/POST /api/relay/teams`
- `GET/PATCH /api/relay/teams/:teamId`
- `POST /api/relay/teams/:teamId/archive`
- `GET/POST /api/relay/teams/:teamId/members`
- `PATCH/DELETE /api/relay/teams/:teamId/members/:userId`

Config sharing API:

- `GET/POST /api/relay/teams/:teamId/config-profiles`
- `GET/PATCH /api/relay/config-profiles/:profileId`
- `POST /api/relay/config-profiles/:profileId/versions`
- `POST /api/relay/config-profiles/:profileId/publish`
- `POST /api/relay/config-profiles/:profileId/assignments`
- `PATCH /api/relay/config-assignments/:assignmentId`
- `POST /api/relay/config-profiles/:profileId/secrets/rotate`

Admin API may mirror these under `/api/admin/*` for tenant admins. User-owned flows should use `/api/relay/*` with session auth and team-scoped authorization.

## Validation

Share draft validation:

- Only safe fields are accepted.
- `env`, hooks, MCP servers, shell permissions, local paths, unknown config roots, and adapter-native secret blocks are rejected.
- `modelServices` entries are normalized into display metadata plus secret references.
- `defaultModelService` must point to a shared or already-visible service key.
- `recommendedModels` must reference visible service keys.

The server must validate again even if the plugin UI already filtered fields.

## Secret Handling

Secret store requirements:

- Store encrypted payloads only.
- Include `secretVersion`, `createdByUserId`, `rotatedAt`, and `revokedAt`.
- Redact secrets from all list/detail responses.
- Record upload, rotate, revoke, and snapshot delivery events.

Explicit share mode:

- Relay decrypts secret for snapshot generation.
- Snapshot sends plaintext only to authorized consuming devices.
- Snapshot carries bounded TTL.
- Plugin cache must drop expired secrets.

Proxy mode:

- Snapshot points model service `apiBaseUrl` to Relay proxy.
- Device receives an ephemeral relay credential, not the provider API key.
- Relay forwards model API traffic with server-side secret.
- This mode needs separate rate limit, audit, and cost controls.

## Cache And Revocation

Plugin cache behavior:

- Non-secret snapshots may be used offline with warning.
- Secret-bearing snapshots require a bounded TTL, default 24 hours or less.
- If `mustRefreshAfter` is in the past and refresh fails, the hook must stop applying secret-bearing config unless policy explicitly allows grace mode.
- UI must distinguish synced, applied, expired, revoked, and project-miss states.

Revocation triggers:

- Team member removal, team archive, profile disable, replacement publish, secret rotate/revoke, user disable, or device disable.

## Admin UI

Relay Admin adds these domains:

- Teams: searchable list, members, role filters, archive action, audit summary.
- Config profiles: profile list, version history, assignment table, publish/disable, secret rotation.
- User detail: team memberships and inherited config profiles.

Admin list pages must follow existing Admin table conventions: search, filters, columns, batch action affordance, sticky header, bottom pagination, icon action buttons, and detail links on primary identifiers.

## Relay Plugin UI

Relay plugin adds:

- current remote config source team/profile/version;
- share draft builder with team selector, safe field preview, API key warning, and secret mode selector;
- refresh/apply status with expiration and revocation warnings.

The plugin should never upload config automatically. Sharing starts from an explicit user action, and the final submit screen must show all fields and secrets that will leave the machine.

## Migration Notes

- Existing `user.teamIds` can be transformed into synthetic `RelayTeamMember` rows.
- Existing raw `configAssignments` remain readable for private deployments using hand-authored store data.
- Once profile assignments exist, Admin should stop exposing raw assignment JSON editing.
- Snapshot contract should remain backward compatible for existing Relay plugin versions by keeping `assignments`, `hash`, `version`, and safe config fields.

## Service Boundaries

Routes handle auth, request parsing, and responses only; team membership and config profile logic belongs in server services; storage drivers stay permission-agnostic; Relay plugin owns local preview/cache application; Relay Admin owns management UI and never reimplements server validation.
