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

## Channel Links

Project `channels` declare platform connections and credentials. A concrete group/direct entry lives in `.oo/channels/<link>/channel.json` and binds that external conversation to exactly one entity:

```json
{
  "channel": "lark:team",
  "entity": "owo-demo",
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
