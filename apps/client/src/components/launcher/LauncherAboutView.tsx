import './LauncherAboutView.scss'

import type { AboutInfo } from '@oneworks/types'

import { AboutSection } from '#~/components/config'

const launcherAboutInfo: AboutInfo = {
  urls: {
    contact: 'https://github.com/oneworks-ai/app/discussions',
    docs: 'https://oneworks-ai.github.io/docs/',
    issues: 'https://github.com/oneworks-ai/app/issues',
    releases: 'https://github.com/oneworks-ai/app/releases',
    repo: 'https://github.com/oneworks-ai/app'
  }
}

export function LauncherAboutView() {
  return (
    <div className='launcher-about'>
      <AboutSection value={launcherAboutInfo} />
    </div>
  )
}
