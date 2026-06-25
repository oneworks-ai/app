# @oneworks/channel-sms

Twilio SMS channel implementation for receiving Twilio webhooks and replying through the Twilio Messages REST API.

## Platform References

- Twilio Programmable Messaging: https://www.twilio.com/docs/messaging
- Twilio Messages API: https://www.twilio.com/docs/messaging/api/message-resource
- Twilio webhook signatures: https://www.twilio.com/docs/usage/security#validating-requests

## Minimal Config

```json
{
  "server": {
    "public": {
      "schema": "https",
      "domain": "bot.example.com",
      "port": 443
    }
  },
  "channels": {
    "sms": {
      "type": "sms",
      "accountSid": "AC...",
      "authToken": "twilio-auth-token",
      "fromNumber": "+15550000000",
      "webhookUrl": "https://bot.example.com/channels/sms/sms/webhook",
      "access": {
        "admins": ["+15551112222"]
      }
    }
  }
}
```

`webhookUrl` should match the full URL configured in the Twilio console. If it is omitted, OneWorks derives it from `server.public` / channel `serverBaseUrl` and the channel key.

Do not commit real Twilio credentials. Keep local values in `.oo.dev.config.json` or another private config layer.

## Runtime Behavior

- Incoming callback path: `POST /channels/sms/<channelKey>/webhook`.
- Signature check: `X-Twilio-Signature`, enabled by default. Set `verifyWebhookSignature: false` only for local development.
- Inbound SMS messages are direct sessions keyed by the sender phone number.
- MMS media URLs are preserved as structured text summaries. OneWorks does not download Twilio media in this first implementation.
- Outbound replies call `POST /Accounts/{AccountSid}/Messages.json` with `From`, `To`, and `Body`.
- SMS text is split at 1600 characters before sending.
- Tool-call summaries are rendered from structured metadata into SMS text.

## Manual Sends

```bash
oneworks channel sms send --to '+15551112222' --receive-id-type phone 'Deployment finished'
```

## Troubleshooting

- `invalid twilio signature`: make sure `webhookUrl` exactly matches the public URL in Twilio, including scheme, host, path, and query if any.
- Replies fail with authentication errors: verify `accountSid` and `authToken`.
- Replies fail with sender errors: verify `fromNumber` is a Twilio number allowed to send to the destination country.
