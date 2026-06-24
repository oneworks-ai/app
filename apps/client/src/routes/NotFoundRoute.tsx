import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'

import { RouteErrorState } from '#~/components/error-state'

export function NotFoundRoute() {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const currentPath = `${location.pathname}${location.search}${location.hash}`

  return (
    <RouteErrorState
      actions={[{
        kind: 'home',
        onClick: () => void navigate('/')
      }]}
      description={t('errorState.routeNotFoundDescription')}
      details={{
        copyText: currentPath,
        items: [{ label: t('common.navigation'), mono: true, value: currentPath }],
        title: t('errorState.diagnostics')
      }}
      mobileDescription={t('errorState.routeNotFoundMobileDescription')}
      severity='info'
      title={t('errorState.routeNotFoundTitle')}
    />
  )
}
