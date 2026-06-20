import { normalizePortalUrl } from './modelServiceProviderActionUtils'

const isDesktopWebviewAvailable = () => (
  typeof window !== 'undefined' &&
  typeof document !== 'undefined' &&
  window.oneworksDesktop?.supportsWebviewTag === true &&
  document.createElement('webview') instanceof HTMLElement
)

export const ModelServiceProviderPortalFrame = ({
  title,
  url
}: {
  title: string
  url?: string
}) => {
  const shouldUseWebview = isDesktopWebviewAvailable()
  const portalUrl = normalizePortalUrl(url)

  if (portalUrl == null) return null

  return (
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
    </div>
  )
}
