# @oneworks/channel-imessage

Local macOS Messages channel for OneWorks.

This package intentionally implements a narrow, user-authorized bridge:

- outbound text send through the local macOS Messages app
- no cloud webhook
- no background inbound listener
- no direct reads from `~/Library/Messages/chat.db`

## Why This Is Local-Only

Apple does not provide a public iMessage bot or webhook API for server-side integrations. The supported local automation surface is macOS app automation: Messages exposes a scripting dictionary with a `send` command for participants and chats, and macOS requires the user to approve apps that automate other apps.

The bridge therefore only works on the Mac where:

1. Messages is signed in and can send to the target.
2. The invoking process can run `osascript`.
3. The user has allowed that process to control Messages in System Settings > Privacy & Security > Automation.

## Configuration

```ts
export default defineConfig({
  channels: {
    imessage: {
      type: 'imessage',
      title: 'Local iMessage',
      enableWebhook: false,
      serviceType: 'iMessage'
    }
  }
})
```

Options:

- `serviceType`: `iMessage`, `SMS`, or `RCS`; defaults to `iMessage`.
- `accountId`: optional Messages account id. If omitted, the first account matching `serviceType` is used.
- `defaultReceiveIdType`: `handle` or `chat`; defaults to `handle`. This lets the generic `oneworks channel ... --to` path treat a bare recipient as a phone/email handle.
- `osascriptPath`: optional path to `osascript`.
- `sendTimeoutMs`: AppleScript timeout, default `30000`.
- `inboundMode`: only `disabled` is supported.

## Manual Send

Send to a phone number or email handle:

```bash
oneworks channel imessage send "hello" --to "+15555550123" --receive-id-type handle
```

Send to a known Messages chat id:

```bash
oneworks channel imessage send "hello group" --to "iMessage;-;chat..." --receive-id-type chat
```

Messages does not return a stable message id through AppleScript, so OneWorks cannot update or attach follow-up UI to a sent iMessage.

## Capability Boundaries

- Inbound messages are not implemented. Shortcuts on Apple devices can trigger automations for received messages, and macOS Shortcuts can be run from the command line, but a durable OneWorks inbound bridge needs an explicit user-created automation and should be designed separately.
- The local Messages database is not used. Polling private SQLite storage would require sensitive local file access, is not an Apple platform contract, and can expose unrelated personal conversations.
- Automation permission is per invoking app/process. Terminal, a packaged OneWorks desktop app, and a background service can each require separate approval.

## References

- Messages scripting definition: `/System/Applications/Messages.app/Contents/Resources/Messages.sdef` on macOS. It exposes the `send` command for `participant` and `chat`, plus `account`, `participant`, `chat`, and `file transfer` classes.
- Apple Support: [Allow apps to automate and control other apps](https://support.apple.com/guide/mac-help/allow-apps-to-automate-and-control-other-apps-mchl108e1718/mac)
- Apple Support: [Run shortcuts from the command line](https://support.apple.com/guide/shortcuts-mac/run-shortcuts-from-the-command-line-apd455c82f02/mac)
- Apple Support: [Communication triggers in Shortcuts](https://support.apple.com/guide/shortcuts/communication-triggers-apdd711f9dff/ios)
