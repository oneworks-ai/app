import { Button, Dropdown, Tooltip } from 'antd'
import { useTranslation } from 'react-i18next'

import { captureMobileDeviceScreenshot } from '#~/api/mobile-debug'

import { useMobileDeviceMoreMenu } from './InteractionPanelMobileDeviceActions'

const downloadScreenshotDataUrl = (deviceId: string, imageDataUrl: string) => {
  const link = document.createElement('a')
  const safeDeviceId = deviceId.replace(/[^\w.-]+/gu, '-')
  link.href = imageDataUrl
  link.download = `oneworks-android-${safeDeviceId}-${Date.now()}.png`
  document.body.append(link)
  link.click()
  link.remove()
}

const captureAndDownloadDeviceScreenshot = async (deviceId: string) => {
  const desktopCapture = window.oneworksDesktop?.captureMobileDeviceScreenshot
  const screenshot = desktopCapture == null
    ? await captureMobileDeviceScreenshot(deviceId)
    : await desktopCapture(deviceId)
  downloadScreenshotDataUrl(deviceId, screenshot.imageDataUrl)
}

function StandaloneDeviceHeaderActionButton({
  active,
  icon,
  label,
  onClick
}: {
  active?: boolean
  icon: string
  label: string
  onClick?: () => void
}) {
  return (
    <Tooltip title={label} placement='bottom'>
      <Button
        type='text'
        className={`standalone-mobile-debug-route__header-action ${active ? 'is-active' : ''}`}
        aria-label={label}
        aria-pressed={active == null ? undefined : active}
        onClick={onClick}
      >
        <span className='material-symbols-rounded standalone-mobile-debug-route__header-action-icon' aria-hidden='true'>
          {icon}
        </span>
      </Button>
    </Tooltip>
  )
}

export function MobileDeviceStandaloneHeaderActions({
  deviceId,
  isSidePanelVisible,
  onOpenDeviceList,
  onRefresh,
  onSendInput,
  onToggleSidePanel
}: {
  deviceId: string
  isSidePanelVisible: boolean
  onOpenDeviceList?: () => void
  onRefresh: () => void
  onSendInput: (input: DesktopMobileDeviceInputEvent) => void
  onToggleSidePanel: () => void
}) {
  const { t } = useTranslation()
  const moreMenu = useMobileDeviceMoreMenu({ onOpenDeviceList, onReconnect: onRefresh, onSendInput })

  return (
    <div className='chat-interaction-panel-mobile-debug__standalone-header-actions'>
      <StandaloneDeviceHeaderActionButton
        icon='photo_camera'
        label={t('chat.interactionPanel.mobileDebugScreenshot')}
        onClick={() => {
          void captureAndDownloadDeviceScreenshot(deviceId)
        }}
      />
      <StandaloneDeviceHeaderActionButton
        icon='restart_alt'
        label={t('chat.interactionPanel.mobileDebugRotate')}
        onClick={() => onSendInput({ action: 'rotate', kind: 'action' })}
      />
      <StandaloneDeviceHeaderActionButton
        active={!isSidePanelVisible}
        icon={isSidePanelVisible ? 'right_panel_close' : 'right_panel_open'}
        label={t(
          isSidePanelVisible
            ? 'chat.interactionPanel.mobileDebugHideSidePanel'
            : 'chat.interactionPanel.mobileDebugShowSidePanel'
        )}
        onClick={onToggleSidePanel}
      />
      <Dropdown menu={moreMenu} placement='bottomRight' trigger={['click']}>
        <span className='standalone-mobile-debug-route__popover-trigger'>
          <StandaloneDeviceHeaderActionButton
            icon='more_vert'
            label={t('chat.interactionPanel.mobileDebugMoreControls')}
          />
        </span>
      </Dropdown>
    </div>
  )
}
