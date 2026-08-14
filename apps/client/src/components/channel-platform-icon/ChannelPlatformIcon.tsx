import './ChannelPlatformIcon.scss'

import { DiscordFilled } from '@ant-design/icons'

import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'

const channelAssetPathByType: Record<string, string> = {
  imessage: new URL('../../../../../assets/brand/channels/imessage.svg', import.meta.url).href,
  lark: new URL('../../../../relay-admin/src/login/assets/feishu-logo.png', import.meta.url).href,
  oneworks: new URL('../../../../../assets/brand/channels/oneworks.svg', import.meta.url).href,
  qq: new URL('../../../../../assets/brand/channels/qq.svg', import.meta.url).href,
  'qq-channel': new URL('../../../../../assets/brand/channels/qq.svg', import.meta.url).href,
  telegram: new URL('../../../../../assets/brand/channels/telegram.svg', import.meta.url).href,
  tg: new URL('../../../../../assets/brand/channels/telegram.svg', import.meta.url).href,
  wechat: new URL('../../../../../assets/brand/channels/wechat.svg', import.meta.url).href,
  wecom: new URL('../../../../../assets/brand/channels/wecom.svg', import.meta.url).href
}

export interface ChannelPlatformIconProps {
  channelType: string
  className?: string
}

export const ChannelPlatformIcon = ({ channelType, className }: ChannelPlatformIconProps) => {
  const normalizedType = channelType.toLowerCase()
  const classes = ['channel-platform-icon', className].filter(Boolean).join(' ')
  const assetUrl = channelAssetPathByType[normalizedType]

  if (assetUrl != null) {
    return (
      <img
        alt=''
        aria-hidden='true'
        className={classes}
        draggable={false}
        src={assetUrl}
      />
    )
  }

  if (normalizedType === 'discord') {
    return <DiscordFilled aria-hidden='true' className={classes} />
  }

  return <MaterialSymbol className={classes} name='hub' />
}
