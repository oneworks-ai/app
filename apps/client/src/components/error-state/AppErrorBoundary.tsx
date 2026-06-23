import type { ErrorInfo, ReactNode } from 'react'
import { Component } from 'react'
import { useTranslation } from 'react-i18next'

import { FullscreenErrorState } from './AppErrorState'

interface AppErrorBoundaryLabels {
  copyLabel: string
  description: string
  mobileDescription: string
  reloadLabel: string
  title: string
}

interface AppErrorBoundaryInnerProps {
  children: ReactNode
  labels: AppErrorBoundaryLabels
}

interface AppErrorBoundaryInnerState {
  error?: Error
  errorInfo?: ErrorInfo
}

const formatBoundaryDiagnostics = (error?: Error, errorInfo?: ErrorInfo) =>
  [
    `Message: ${error?.message ?? 'Unknown error'}`,
    '',
    'Stack:',
    error?.stack ?? 'n/a',
    '',
    'Component stack:',
    errorInfo?.componentStack ?? 'n/a'
  ].join('\n')

class AppErrorBoundaryInner extends Component<AppErrorBoundaryInnerProps, AppErrorBoundaryInnerState> {
  override state: AppErrorBoundaryInnerState = {}

  static getDerivedStateFromError(error: Error): AppErrorBoundaryInnerState {
    return { error }
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[app-error-boundary] render failed', error, errorInfo)
    this.setState({ error, errorInfo })
  }

  override render() {
    const { children, labels } = this.props
    const { error, errorInfo } = this.state
    if (error == null) return children

    const diagnostics = formatBoundaryDiagnostics(error, errorInfo)

    return (
      <FullscreenErrorState
        actions={[{
          kind: 'reload',
          label: labels.reloadLabel,
          onClick: () => window.location.reload()
        }]}
        description={labels.description}
        details={{
          copyText: diagnostics,
          items: [{ label: labels.copyLabel, mono: true, value: error.message }],
          title: labels.copyLabel
        }}
        mobileDescription={labels.mobileDescription}
        title={labels.title}
      />
    )
  }
}

export function AppErrorBoundary({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <AppErrorBoundaryInner
      labels={{
        copyLabel: t('errorState.diagnostics'),
        description: t('errorState.appCrashDescription'),
        mobileDescription: t('errorState.appCrashMobileDescription'),
        reloadLabel: t('errorState.actions.reload'),
        title: t('errorState.appCrashTitle')
      }}
    >
      {children}
    </AppErrorBoundaryInner>
  )
}
