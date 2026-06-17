# @oneworks/channel-wecom

WeCom channel for OneWorks.

## Supported Scope

This package supports WeCom enterprise applications:

- Incoming text messages through the WeCom application callback URL.
- GET URL verification using `msg_signature`, `timestamp`, `nonce`, and encrypted `echostr`.
- Signature verification and AES decrypt using the application's callback `Token` and `EncodingAESKey`.
- Outbound text or markdown messages through `/cgi-bin/message/send`.
- Outbound text or markdown messages to app-created chats through `/cgi-bin/appchat/send`.

It does not implement WeCom group robot inbound messages. WeCom group robots expose a webhook-send endpoint for pushing messages into a group, but they are not a two-way callback channel. Use an enterprise application when OneWorks needs to receive user messages and bind sessions.

## Configuration

```ts
export default {
  channels: {
    work: {
      type: 'wecom',
      title: 'OneWorks',
      corpId: 'wwxxxxxxxxxxxxxxxx',
      corpSecret: process.env.WECOM_CORP_SECRET,
      agentId: 1000002,
      token: process.env.WECOM_CALLBACK_TOKEN,
      encodingAesKey: process.env.WECOM_ENCODING_AES_KEY
    }
  }
}
```

Configure the WeCom application callback URL as:

```text
https://your-oneworks-server.example.com/channels/wecom/work/webhook
```

The route is served by the OneWorks channel webhook router. Signature validation, AES decrypt, XML parsing, and inbound normalization are handled inside this package.

## Sending

`oneworks channel send` can target WeCom users, parties, tags, all visible users, or an app-created chat:

```bash
oneworks channel work send --receive-id zhangsan --receive-id-type user "hello"
oneworks channel work send --receive-id '@all' --receive-id-type all "hello everyone"
oneworks channel work send --receive-id CHATID --receive-id-type appchat '{"msgtype":"markdown","text":"## Status\\nDone"}'
```

`receiveIdType` values:

- `user`: sends to `touser`.
- `party`: sends to `toparty`.
- `tag`: sends to `totag`.
- `all`: sends to `touser: "@all"`.
- `appchat`: sends to `/cgi-bin/appchat/send` with `chatid`.

## Official References

- WeCom receive-message callback overview: <https://open.work.weixin.qq.com/api/doc/90000/90135/90238>
- WeCom callback configuration and URL verification: <https://developer.work.weixin.qq.com/document/path/90930>
- WeCom get access token: <https://developer.work.weixin.qq.com/document/path/91039>
- WeCom send application messages: <https://developer.work.weixin.qq.com/document/path/90372>
- WeCom app chat messages: <https://developer.work.weixin.qq.com/document/path/90248>
- WeCom group robot webhook send: <https://developer.work.weixin.qq.com/document/path/91770>
