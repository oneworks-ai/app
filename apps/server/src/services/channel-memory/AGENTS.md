# Channel Memory Service

`index.ts` owns deterministic memory selection, snapshot persistence, prompt rendering and writeback audit. `file-sync.ts` bridges the agent-facing `oneworks mem` files into structured entity/channel/conversation/canonical-user memory before dispatch and at terminal lifecycle. Keep SQL in `db/channelMemories`; do not bypass resolver filtering from dispatch or session code.

The first version is keyword + recency + importance ranking only. It must filter issuer scope, entity, channel key/id, canonical user/account, sensitivity, visibility and expiry before applying item/token budgets.

Memory loading is group-aware. Organization visibility is mandatory; values inside one visibility group use OR semantics and different groups use AND semantics. Candidate caps and final item/token budgets must reserve a fair share for each exact visibility-group signature before filling remaining global capacity. Prompt rendering must preserve both the visibility group and the structured source for every selected memory so the entity can distinguish where a memory came from and where it is allowed to apply.

Entity memory hard policy is snapshotted on the child run. Initial loading and terminal file writeback must use the same policy so TTL, evidence, writable scope and sensitivity behavior cannot drift during one run. Sensitive memory is denied by default; it may enter context only when the entity explicitly enables it and every source, scope, visibility and expiry check also passes.

`entity` visibility may omit channel ids so one entity can reuse experience across its ChannelLinks. Omitted dimensions are wildcards only after organization visibility is explicitly present. Direct-source canonical-user memory must remain blocked from group prompts. Physical `session` file memory is scratch state; stable continuity uses `conversation` scope.

Entity and Room files have a mandatory visibility partition below their id: `direct/` contains direct-only content and `organization/` contains organization-visible continuity. Sync derives visibility from this directory, never from mutable sidecar metadata, and intentionally ignores the former unpartitioned location.
