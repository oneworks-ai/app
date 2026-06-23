import { useTranslation } from 'react-i18next'

import type { OpenInteractionPanelIframeUrlOptions } from './interaction-panel-iframe-pages'

interface MobileDebugTargetGroup {
  appKey: string
  appLabel: string
  targets: DesktopMobileDebugTarget[]
}

const getSocketLabelKey = (socketType: DesktopMobileDebugTarget['socketType']) => {
  if (socketType === 'chrome') return 'chat.interactionPanel.mobileDebugChrome'
  if (socketType === 'webview') return 'chat.interactionPanel.mobileDebugWebView'
  return 'chat.interactionPanel.mobileDebugOther'
}

export function InteractionPanelMobileDebugTargetGroup({
  group,
  isOpen,
  onOpenDebugUrl,
  onToggle
}: {
  group: MobileDebugTargetGroup
  isOpen: boolean
  onOpenDebugUrl: (url: string, options?: OpenInteractionPanelIframeUrlOptions) => void
  onToggle: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className={`chat-interaction-panel-mobile-debug__target-group ${isOpen ? 'is-open' : ''}`}>
      <button type='button' className='chat-interaction-panel-mobile-debug__target-group-header' onClick={onToggle}>
        <span className='material-symbols-rounded chat-interaction-panel-mobile-debug__target-group-chevron'>
          keyboard_arrow_right
        </span>
        <span className='chat-interaction-panel-mobile-debug__target-group-title'>{group.appLabel}</span>
        <span className='chat-interaction-panel-mobile-debug__target-group-count'>{group.targets.length}</span>
      </button>
      <div className='chat-interaction-panel-mobile-debug__target-group-body'>
        <div className='chat-interaction-panel-mobile-debug__target-list'>
          {group.targets.map(target => (
            <button
              key={target.id}
              type='button'
              className='chat-interaction-panel-mobile-debug__target'
              onClick={() =>
                onOpenDebugUrl(target.inspectUrl, {
                  faviconUrl: target.faviconUrl,
                  openMode: 'new-tab',
                  title: target.title,
                  variant: 'mobile-debug-devtools'
                })}
            >
              <span className='material-symbols-rounded chat-interaction-panel-mobile-debug__target-icon'>
                {target.socketType === 'webview' ? 'web_asset' : 'language'}
              </span>
              <span className='chat-interaction-panel-mobile-debug__target-copy'>
                <span className='chat-interaction-panel-mobile-debug__target-title'>{target.title}</span>
                <span className='chat-interaction-panel-mobile-debug__target-url'>{target.url || target.type}</span>
              </span>
              <span className='chat-interaction-panel-mobile-debug__target-meta'>
                {target.deviceLabel} · {target.source === 'network'
                  ? t('chat.interactionPanel.mobileDebugNetwork')
                  : t(getSocketLabelKey(target.socketType))}
              </span>
              <span
                className='material-symbols-rounded chat-interaction-panel-mobile-debug__target-open-icon'
                aria-hidden='true'
              >
                open_in_new
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
