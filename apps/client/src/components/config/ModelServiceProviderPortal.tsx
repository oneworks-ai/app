import { Button, Modal } from 'antd'

import type { TranslationFn } from './configUtils'
import { normalizePortalUrl } from './modelServiceProviderActionUtils'

const isDesktopWebviewAvailable = () => (
  typeof window !== 'undefined' &&
  typeof document !== 'undefined' &&
  window.oneworksDesktop?.supportsWebviewTag === true &&
  document.createElement('webview') instanceof HTMLElement
)

export const ModelServiceProviderPortal = ({
  onClose,
  onOpenExternal,
  t,
  title,
  url
}: {
  onClose: () => void
  onOpenExternal: (url: string) => void
  t: TranslationFn
  title: string
  url?: string
}) => {
  const shouldUseWebview = isDesktopWebviewAvailable()
  const portalUrl = normalizePortalUrl(url)

  return (
    <Modal
      centered
      className='config-view__model-service-portal-modal'
      open={portalUrl != null}
      title={title}
      width='min(1120px, calc(100vw - 40px))'
      footer={[
        <Button key='external' onClick={() => portalUrl != null && onOpenExternal(portalUrl)}>
          {t('config.modelServices.actions.openExternal')}
        </Button>,
        <Button key='close' type='primary' onClick={onClose}>
          {t('common.close')}
        </Button>
      ]}
      onCancel={onClose}
    >
      {portalUrl != null && (
        <div className='config-view__model-service-portal'>
          {shouldUseWebview
            ? (
              <webview
                className='config-view__model-service-portal-frame'
                partition='persist:oneworks-model-provider-portal'
                src={portalUrl}
                title={title}
              />
            )
            : (
              <iframe
                className='config-view__model-service-portal-frame'
                referrerPolicy='no-referrer'
                sandbox='allow-forms allow-popups allow-same-origin allow-scripts'
                src={portalUrl}
                title={title}
              />
            )}
          <div className='config-view__model-service-portal-hint'>
            {shouldUseWebview
              ? t('config.modelServices.portal.webviewHint')
              : t('config.modelServices.portal.iframeHint')}
          </div>
        </div>
      )}
    </Modal>
  )
}
