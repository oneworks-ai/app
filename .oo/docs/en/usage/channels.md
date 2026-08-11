# Channel Session Binding

Channels connect external messaging systems to One Works sessions. A channel receives inbound messages, resolves access rules, starts or resumes a session, and sends the agent response back to the external service.

## Configuration Shape

Channel configuration lives in project config:

```yaml
channels:
  <channelKey>:
    type: ...
```

Each channel type defines its own credentials and transport settings. Shared concepts include:

- access control for admins or allowed users
- session binding between an external conversation and a One Works session
- optional multimodal model selection for image-capable inbound messages
- webhook secrets for public HTTP callbacks
- channel-level `serverBaseUrl` overrides when the global public server URL is not enough

## Public Server URL

Webhook channels need a URL that the external platform can reach. The server can build it from:

```json
{
  "server": {
    "public": {
      "schema": "https",
      "domain": "bot.example.com",
      "port": 443
    }
  }
}
```

Channel-level `serverBaseUrl` can override it for a specific channel.

Public hosts allow `/channels/*/*/webhook` by default. Additional public paths should be configured with `server.publicPaths`.

## Agent-Side Channel Memory

Channel-triggered agents receive the current binding and message context in their adapter environment. They can use the narrow `oneworks mem` CLI to read and write files under the server data directory's `channel-memory/v1/` tree; these files are not written into the user's workspace.

Before each dispatch, the server synchronizes the default `README.md` for the current `entity`, `channel`, `conversation`, and `user` into the structured Memory Resolver. Channel and user files are isolated by channel key, and user files are further isolated by `direct` versus `group`, so a later group write cannot reclassify private content. The resolver filters by organization, entity, channel, canonical user/account, source conversation type, visibility, sensitivity, and expiry before creating a budgeted MemorySnapshot. At child-session termination it checks the files again, commits changed structured memories, and records a terminal audit even when nothing changed. Linked accounts can therefore reuse structured canonical-user memory across platforms, while one entity can reuse entity memory across its ChannelLinks.

```bash
oneworks mem get
oneworks mem patch "Channel convention: keep release summaries concise."
oneworks mem patch -s entity "Restart a long connection only after checking app ownership."
oneworks mem patch -s conversation "Next step: verify the callback after deployment."
oneworks mem patch -s user "The current sender prefers short replies."
```

Supported scopes are `global`, `entity`, `channel`, `conversation`, `session`, and `user`. `conversation` follows the stable conversation state across fresh physical ChildSessions; `session` is intentionally limited to one physical ChildSession. `global`, `session`, and custom reference paths are explicit CLI files and are not automatically injected into resolver snapshots; automatic synchronization only reads each supported durable scope's default `README.md`. User files are keyed by issuer, platform sender, and conversation type, then attributed to the canonical user during structured writeback when an identity binding exists. The CLI uses the narrow `bash-oneworks-mem` permission and does not grant arbitrary shell access.

## Channel Links

Project `channels` declare platform connections and credentials. A concrete group/direct entry lives in `.oo/channels/<link>/channel.json` and binds that external conversation to exactly one entity:

```json
{
  "channel": "lark:team",
  "entity": "support-assistant",
  "external": {
    "type": "chat",
    "chatId": "oc_xxx"
  },
  "authorization": {
    "deliveryThrottleMs": 1200000,
    "resume": {
      "mode": "immediate",
      "delayMs": 0
    }
  }
}
```

- One channel link maps to one entity.
- After administrator bootstrap, direct messages must also match a direct ChannelLink. `allowPrivateChat` controls transport access only; it does not replace entity binding. An unbound direct message fails closed instead of creating an entity-less ChildSession.
- `authorization.deliveryThrottleMs` controls how often the same authorization request may be delivered again, in milliseconds. The default is `1200000` (20 minutes).
- `authorization.resume.mode` controls what happens after grant / deny. `immediate` creates a `system_resume` child run automatically, `manual` only records the resolved pending intent until an admin or agent explicitly resumes it with `channel.auth.resume`, and `next_message` waits for the next related inbound message from the same owner in the same thread, then injects the resume context into that child run. `authorization.resume.delayMs` adds a minimum delay for `immediate` resume.
- Delivered authorization requests record `delivery` and the platform `deliveryMessageId`; grant / deny closes the linked pending intent.
- During the current single-login compatibility phase, automatic resume creates a fresh ChildSession with the original session as its parent and workspace source; it does not append to the old runtime or grant the external sender's personal login state. User-level APIs must still check the `credentialSubjectUserId` credential and otherwise request authorization, degrade, or deny.

## Agent-Side Channel Command Tools

When a channel agent needs to inspect or update channel-internal state, it should use the sender-scoped typed command CLI instead of sending slash commands such as `/auth`, `/session`, or `/access` into the external chat:

```bash
oneworks channel command list
oneworks channel command invoke channel.whoami
oneworks channel command invoke channel.auth.list
oneworks channel command invoke channel.auth.list '{ "scope": "resumable" }'
oneworks channel command invoke channel.auth.grant '{ "id": "auth-1" }'
oneworks channel command invoke channel.auth.resume '{ "id": "auth-1" }'
oneworks channel command invoke channel.identity.link
oneworks channel command invoke channel.identity.link '{ "code": "ABCD1234" }'
oneworks channel command invoke channel.identity.accounts
```

- `oneworks channel command list` shows available `channel.*` typed tools, slash usage, and permission level.
- `oneworks channel command invoke <toolName> [jsonInput]` carries a short-lived token for the current child run. The server reconstructs authority from the token-linked actor snapshot and immutable delivery binding, then applies sender, channel admin, identity-link, and authorization-request rules. The CLI cannot claim or switch to the bot, owner, enterprise admin, desktop login, or active CLI profile.
- Command output returns only to the shell and Chat History. It is not automatically posted to the external channel. Send a short visible summary separately with `oneworks channel send "..."` when the channel should see the result.
- The CLI and Agent Tool share the same `channel.send` command kernel. One ChildSession may call it repeatedly; each call creates one external delivery and does not create another ChildSession.
- In a Room, the default target is the source ChannelLink of the current inbound message. Cross-provider and same-provider cross-account sends must explicitly select an available Room ChannelLink for the current entity. The runtime never broadcasts implicitly.
- Successful and failed sends are both projected into the owner-local Room timeline with provider, account, conversation, provider message reference, navigation capability, and error status. The UI keeps the default provenance display to compact platform icons.
- One Works does not currently provide a complete multi-account login loop. `actor identity` and `actor credential` stay separate: sender identity can drive permissions, audit, and authorization ownership; user-level API execution still requires an explicit credential/authorization request and must not borrow the desktop login, CLI app, or bot app secret.
- When a typed command is invoked from a channel session, the server accepts only the invocation token, tool name, and input from the current message context file. Caller-provided sender, channel, session, or reply-target fields do not participate in authorization. Expired, cross-channel, or inconsistent tokens are rejected.
- When debugging permission ownership, start with slash `/whoami` or typed `channel.whoami` to inspect the sender, channel account, canonical user, identity link, and credential count. A canonical user only means the identity is linked; zero credentials or non-active credentials still cannot execute user-level APIs for that person.
- Cross-channel account linking uses `/identity link`: generate a short-lived code from an account the user controls, then run `/identity link <code>` from the other account. This only proves both channel accounts belong to the same canonical user; it does not copy credentials or grant the new account the old account's API login state.
- Authorization requests keep the same split: `requesterUserId/requesterAccountId` is the sender that triggered the work, while `credentialSubjectUserId` is the user whose executable credential is missing. When they differ, the pending intent belongs to the credential subject so resource-owner approval is not confused with requester approval.
- `channel.auth.list` lists the current sender's pending authorization requests by default. With `{ "scope": "resumable" }`, it lists resolved pending intents that can still be resumed. Regular users only see their own tasks; admins can see all resumable tasks for the current channel type and resume them with `channel.auth.resume`.

Without a complete multi-account login loop, read permissions as `single-login runner mode`:

- The desktop login / CLI profile is only the local runner principal, used to start sessions, access the project, and schedule runtime work.
- The bot app secret is a service principal, used for bot messaging and app-level channel capabilities.
- The channel sender is the actor identity, used for policy decisions, audit, memory ownership, and authorization ownership.
- Only an explicitly authorized credential principal can execute user-level APIs for that user.

When a tool needs a user credential and the actor or resource owner has no active credential, create an authorization request, degrade, or deny. Do not borrow the desktop user, CLI app, bot app, or room owner permission.

## Platform Integrations

See [Channel Platform Integrations](./channel-platforms.md) for Lark, OneWorks Native, and WeChat setup and operational notes.

## OneWorks Channel And Chat Rooms

OneWorks' built-in Channel configuration continues to own provider connections, credentials, and ChannelLinks. A second plugin for “managing every channel” is neither required nor installed. The OneWorks product is split into two independently runnable parts:

- `@oneworks/channel-oneworks` is a first-party Channel provider beside Lark and WeChat. It owns standard send/receive behavior, signed webhooks, platform references, and navigation capabilities, and keeps working without the product plugin.
- `@oneworks/plugin-channel-oneworks` is the OneWorks Chat Rooms product entry. It exposes local Rooms, explicit sharing, OneWorks simulations, redacted traces, and message-navigation preferences. It does not manage Lark/WeChat connections or replace session management.

One Room may attach multiple ChannelLinks across providers and multiple accounts of the same provider. Every inbound message keeps its source and every Agent send keeps its target. Full messages, runs, memories, and deliveries stay only on the Room owner's node. Only explicitly shared Rooms publish a descriptor and ACL to Relay. When the owner is offline, remote users can see that the Room exists but cannot read its transcript or enqueue messages; Relay stores neither.

The first share binds an ownerless Room to a currently online Relay owner account; the only online account is selected automatically, while multiple accounts require an explicit choice. Live remote projections contain message content, user-facing labels, and opaque references only. They omit provider channel, account, message, thread, session, and raw delivery-target identifiers. Every remote mutation must provide a stable `x-oneworks-room-operation-id` and reuse it after a transport failure. The owner claims that operation before calling an external session, so retries cannot repeat the same side effect. Chat Rooms product APIs derive their principal from the host request: authenticated Web accounts and auth-disabled loopback workspaces receive workspace read/manage permissions, while auth-disabled remote requests receive no principal and fail closed.

The Shared view aggregates public Room relationships visible to every enabled Relay account with a valid login. One unreachable account does not suppress successful accounts. Availability comes from the owner's live tunnel rather than local configuration or a stale descriptor; reconnecting republishes explicit shares. Directory results expose no account key, session token, owner identifier, owner-local Room identifier, or transcript.

Navigation order is stored in the OneWorks Chat Rooms plugin settings and may override individual providers or channel accounts. Providers contribute only the message, conversation, web, native-app, or app-home references they can actually resolve. Users can prefer the right-side WebView, external browser, native app, or app home.

Each OneWorks simulation creates a fresh nonce, timestamp, and webhook signature before using the normal OneWorks webhook, connection, and inbound middleware path. Administrator and participant scenarios both use isolated synthetic principals. The scenario role is prompt and audit context only: it grants no real administrator privilege and never borrows a configured administrator ID. Commands such as `/access` and `/availability` still exercise sender-scoped authorization and are denied unless the synthetic principal is explicitly configured as a channel administrator. The interface exposes only safe fingerprints, counts, status, and reasons; it never shows channel or actor IDs, signatures, credential fields, or raw payloads. Removing the product plugin does not affect any channel transport.

Use the read-only acceptance command to validate a delivery matrix:

```bash
pnpm tools channel-acceptance --workspace . --channel-type lark --expect-channels 10 --expect-entities 10 --expect-groups 6 --expect-links 20 --require-admins --require-credentials --require-group-allowlist --json
```

Add `--db <runtime.sqlite>` only when runtime evidence should be included. The command emits matrix counts, grouped statuses, short fingerprints, and violation codes; it does not emit app secrets, chat IDs, user IDs, real names, raw messages, or the database path.
