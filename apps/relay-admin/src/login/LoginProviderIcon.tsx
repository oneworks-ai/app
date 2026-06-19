import { AdminIcon } from '../shared/ui/AdminIcon'
import type { RelayLoginProviderConfig } from './types'

const GoogleIcon = () => (
  <span className='relay-login-app__google-icon' aria-hidden='true'>
    <svg width='18' height='18' viewBox='0 0 48 48' focusable='false'>
      <path
        fill='#FFC107'
        d='M43.611 20.083H42V20H24v8h11.303C33.654 32.657 29.223 36 24 36c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917Z'
      />
      <path
        fill='#FF3D00'
        d='m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691Z'
      />
      <path
        fill='#4CAF50'
        d='M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44Z'
      />
      <path
        fill='#1976D2'
        d='M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917Z'
      />
    </svg>
  </span>
)

const GithubIcon = () => (
  <span className='relay-login-app__github-icon' aria-hidden='true'>
    <svg width='18' height='18' viewBox='0 0 98 96' focusable='false'>
      <path d='M48.9 0C21.9 0 0 21.9 0 48.9c0 21.6 14 39.9 33.4 46.4 2.4.5 3.3-1.1 3.3-2.4 0-1.2 0-5 0-9.1-13.6 3-16.5-5.8-16.5-5.8-2.2-5.7-5.4-7.2-5.4-7.2-4.4-3 .3-3 .3-3 4.9.3 7.5 5 7.5 5 4.3 7.4 11.3 5.3 14.1 4 .4-3.1 1.7-5.3 3.1-6.5-10.8-1.2-22.2-5.4-22.2-24.2 0-5.3 1.9-9.7 5-13.1-.5-1.2-2.2-6.2.5-12.9 0 0 4.1-1.3 13.4 5 3.9-1.1 8.1-1.6 12.3-1.6s8.4.6 12.3 1.6c9.3-6.3 13.4-5 13.4-5 2.7 6.7 1 11.7.5 12.9 3.1 3.4 5 7.8 5 13.1 0 18.8-11.4 22.9-22.3 24.2 1.8 1.5 3.3 4.5 3.3 9.1 0 6.5-.1 11.8-.1 13.4 0 1.3.9 2.8 3.4 2.4 19.4-6.5 33.4-24.8 33.4-46.4C97.8 21.9 75.9 0 48.9 0Z' />
    </svg>
  </span>
)

export const providerIcon = (provider: RelayLoginProviderConfig) => {
  switch (provider.icon) {
    case 'github':
      return <GithubIcon />
    case 'google':
      return <GoogleIcon />
    default:
      return <AdminIcon name='login' />
  }
}
