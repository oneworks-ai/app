import { describe, expect, it } from 'vitest'

import { buildChannelContextPrompt } from '#~/channels/middleware/dispatch/prompt/context.js'

const makeInbound = (overrides: Record<string, unknown> = {}) => ({
  channelType: 'lark',
  channelId: 'ch1',
  sessionType: 'direct' as const,
  messageId: 'm1',
  ...overrides
})

describe('buildChannelContextPrompt', () => {
  it('always includes the platform line', () => {
    const result = buildChannelContextPrompt(makeInbound() as any, undefined)
    expect(result).toContain('你正在通过 飞书（Lark） 频道进行对话。')
  })

  it('uses channelType directly for unknown platforms', () => {
    const result = buildChannelContextPrompt(makeInbound({ channelType: 'wecom' }) as any, undefined)
    expect(result).toContain('你正在通过 wecom 频道进行对话。')
  })

  it('includes bot name when config.title is set', () => {
    const result = buildChannelContextPrompt(makeInbound() as any, { title: 'MyBot' } as any)
    expect(result).toContain('你在此频道上的名字是「MyBot」。')
  })

  it('omits bot name line when config.title is absent', () => {
    const result = buildChannelContextPrompt(makeInbound() as any, {} as any)
    expect(result).not.toContain('名字')
  })

  it('includes admin IDs when admins are configured', () => {
    const config: any = { access: { admins: ['u1', 'u2'] } }
    const result = buildChannelContextPrompt(makeInbound() as any, config)
    expect(result).toContain('u1')
    expect(result).toContain('u2')
    expect(result).toContain('管理员')
  })

  it('omits admin line when admins list is empty', () => {
    const config: any = { access: { admins: [] } }
    const result = buildChannelContextPrompt(makeInbound() as any, config)
    expect(result).not.toContain('管理员')
  })

  it('omits admin line when access is undefined', () => {
    const result = buildChannelContextPrompt(makeInbound() as any, {} as any)
    expect(result).not.toContain('管理员')
  })

  it('returns undefined when config is undefined but platform line is still present', () => {
    // function always returns a string (platform line is always pushed)
    const result = buildChannelContextPrompt(makeInbound() as any, undefined)
    expect(typeof result).toBe('string')
    expect(result!.length).toBeGreaterThan(0)
  })

  it('joins all lines with newline', () => {
    const config: any = { title: 'Bot', access: { admins: ['a1'] } }
    const result = buildChannelContextPrompt(makeInbound() as any, config)!
    const lines = result.split('\n')
    expect(lines.length).toBeGreaterThan(3)
  })

  it('tells group channel agents to send final visible replies with oneworks channel', () => {
    const result = buildChannelContextPrompt(
      makeInbound({
        channelType: 'wechat',
        channelId: 'group-1@chatroom',
        sessionType: 'group',
        senderId: 'wxid-user'
      }) as any,
      { title: '二介' } as any
    )!

    expect(result).toContain('群聊')
    expect(result).toContain('最终可见答复必须')
    expect(result).toContain('oneworks channel send')
    expect(result).toContain('oneworks channel send --br')
    expect(result).toContain('不要只在 OneWorks UI 中回答')
  })

  it('frames channel chat history as internal notes instead of external replies', () => {
    const result = buildChannelContextPrompt(
      makeInbound({
        channelType: 'wechat',
        channelId: 'group-1@chatroom',
        sessionType: 'group',
        senderId: 'wxid-user'
      }) as any,
      { title: '二介' } as any
    )!

    expect(result).toContain('OneWorks Chat History 是你的内部工作记录')
    expect(result).toContain('不等同于已经发送给外部频道用户的消息')
    expect(result).toContain('都必须通过 `oneworks channel` CLI 触发')
    expect(result).toContain('结束/stop 时不要再复述同一条消息')
    expect(result).toContain('不要把面向外部用户的完整话术留在这里自说自话')
    expect(result).toContain('最终 assistant/stop 文本只做内部收尾摘要')
  })

  it('tells channel agents not to probe built-in CLI availability first', () => {
    const result = buildChannelContextPrompt(
      makeInbound({
        channelType: 'wechat',
        channelId: 'group-1@chatroom',
        sessionType: 'group'
      }) as any,
      { title: '二介' } as any
    )!

    expect(result).toContain('这些 CLI 已经作为 channel session 的环境能力注入')
    expect(result).toContain('不要为了确认是否存在而先执行 `which oneworks`')
  })

  it('tells channel agents to actively read and write memory when context is unfamiliar', () => {
    const result = buildChannelContextPrompt(
      makeInbound({
        channelType: 'wechat',
        channelId: 'group-1@chatroom',
        sessionType: 'group',
        senderId: 'wxid-user'
      }) as any,
      { title: '二介' } as any
    )!

    expect(result).toContain('先用 `oneworks mem get`、`oneworks mem get -s user` 或 `oneworks mem list` 查小本本')
    expect(result).toContain('不要只靠猜')
    expect(result).toContain(
      '结束前用 `oneworks mem patch`、`oneworks mem patch -s user` 或 `oneworks mem patch -s session` 写一条简短记录'
    )
    expect(result).toContain('Chat History 里应该能看到真实的 `oneworks mem` CLI 调用记录')
  })

  it('tells channel agents to react naturally to image-only emoji messages', () => {
    const result = buildChannelContextPrompt(
      makeInbound({
        channelType: 'wechat',
        channelId: 'wxid-user',
        sessionType: 'direct'
      }) as any,
      { title: '二介' } as any
    )!

    expect(result).toContain('这些图片已经作为视觉附件随消息一起发送给你')
    expect(result).toContain('像在 IM 里自然对话')
    expect(result).toContain('当用户只发送 emoji、表情包、贴图或图片时')
    expect(result).toContain('像真人聊天一样接住情绪和语境')
    expect(result).toContain('群聊闲聊默认短、快、有梗')
    expect(result).toContain('面对轻度调侃、玩笑挑衅、威胁式玩笑')
    expect(result).toContain('说要裁了你/开除你/把你打回去')
    expect(result).toContain('用户发图片/截图/转述内容但没有明确要求你分析')
    expect(result).toContain('优先用一个表情或一句调皮短句回应')
    expect(result).toContain('不要主动把表情包解释成“这是一张……图片”或“它的意思是……”')
    expect(result).toContain('表情包是频道人格的一部分')
    expect(result).toContain('被轻度冒犯、被玩笑威胁、被催、被吐槽')
    expect(result).toContain('channel-emoji-mood-hint')
    expect(result).toContain('当前可发表情候选小抄')
    expect(result).toContain('根据聊天气氛自己挑')
    expect(result).toContain('如果最合适的表情查到了但 `sendable=no`')
    expect(result).toContain('逐步形成自己的“口癖表情”')
    expect(result).toContain('oneworks channel emoji list --platform <platform> --sendable --tag <标签>')
    expect(result).toContain('必要时只发一个表情也可以')
    expect(result).toContain('贴合语气的 Unicode emoji')
    expect(result).toContain('不是用户要求你汇报处理过程或解释图片内容')
    expect(result).toContain('本地图片附件')
    expect(result).toContain('data:image')
    expect(result).toContain('不要因为看见文件名、帧名或“已抽取”摘要就声称无法读取图片')
  })

  it('tells WeChat agents how to send @ mentions through oneworks channel', () => {
    const result = buildChannelContextPrompt(
      makeInbound({
        channelType: 'wechat',
        channelId: 'room@chatroom',
        sessionType: 'group'
      }) as any,
      { title: '二介' } as any
    )!

    expect(result).toContain('微信频道专属发送规则')
    expect(result).toContain('oneworks channel send --at <wxid> "..."')
    expect(result).toContain('--ats wxid_1,wxid_2')
    expect(result).toContain('--at-all')
    expect(result).toContain('文本里写可见的 `@所有人`')
    expect(result).toContain('只传 `--at` 但文本里没有可见 @')
    expect(result).toContain('oneworks channel emoji list --platform <platform>')
    expect(result).toContain('oneworks channel emoji send <id> --platform <platform>')
    expect(result).toContain('oneworks channel emoji annotate <id> --platform <platform>')
    expect(result).toContain('oneworks channel emoji list --platform <platform> --recent --limit 5')
  })
})
