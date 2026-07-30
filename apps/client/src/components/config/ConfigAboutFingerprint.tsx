import type {
  AppBuildInfo
} from '@oneworks/types'

import type { AboutServerStatus } from './ConfigAboutSection'

const formatBuildTime = (buildTime: string) => {
  const date = new Date(buildTime)
  if (Number.isNaN(date.getTime())) {
    return buildTime
  }
  return date.toLocaleString()
}

export const ConfigAboutFingerprint = ({
  build,
  buildTimeLabel,
  commitLabel,
  commitTimeSourceLabel,
  label,
  status,
  statusLabel,
  unknownLabel,
  versionLabel
}: {
  build: AppBuildInfo
  buildTimeLabel: string
  commitLabel: string
  commitTimeSourceLabel: string
  label: string
  status?: AboutServerStatus
  statusLabel?: string
  unknownLabel: string
  versionLabel: string
}) => (
  <section className='config-about__fingerprint' aria-label={label}>
    <div className='config-about__fingerprint-header'>
      <strong>{label}</strong>
      {status != null && (
        <span
          className={`config-about__status config-about__status--${status}`}
          data-testid='about-server-status'
        >
          <span className='config-about__status-dot' aria-hidden='true' />
          {statusLabel}
        </span>
      )}
    </div>
    <dl className='config-about__fingerprint-list'>
      <div>
        <dt>{versionLabel}</dt>
        <dd><code>{build.version}</code></dd>
      </div>
      <div>
        <dt>{commitLabel}</dt>
        <dd>
          <code title={build.commit ?? undefined}>
            {build.commit ?? unknownLabel}
          </code>
        </dd>
      </div>
      <div>
        <dt>{buildTimeLabel}</dt>
        <dd>
          <code title={build.buildTime ?? undefined}>
            {build.buildTime == null ? unknownLabel : formatBuildTime(build.buildTime)}
          </code>
          {build.buildTimeSource === 'commit' && (
            <span className='config-about__time-source'>{commitTimeSourceLabel}</span>
          )}
        </dd>
      </div>
    </dl>
  </section>
)
