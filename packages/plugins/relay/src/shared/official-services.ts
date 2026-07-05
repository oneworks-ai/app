export const OFFICIAL_RELAY_CLOUDFLARE_BASE_URL = 'https://cf.oneworks.cloud'
export const OFFICIAL_RELAY_CLOUDFLARE_DEV_BASE_URL = 'https://dev.cf.oneworks.cloud'
export const OFFICIAL_RELAY_VERCEL_BASE_URL = 'https://vc.oneworks.cloud'
export const OFFICIAL_RELAY_VERCEL_DEV_BASE_URL = 'https://dev.vc.oneworks.cloud'

export const OFFICIAL_RELAY_CLOUDFLARE_SERVER_ID = 'oneworks-cloudflare'
export const OFFICIAL_RELAY_CLOUDFLARE_DEV_SERVER_ID = 'oneworks-cloudflare-dev'
export const OFFICIAL_RELAY_VERCEL_SERVER_ID = 'oneworks-vercel'
export const OFFICIAL_RELAY_VERCEL_DEV_SERVER_ID = 'oneworks-vercel-dev'
export const LOCAL_RELAY_SERVER_ID = 'local'
export const DEFAULT_OFFICIAL_RELAY_SERVER_ID = OFFICIAL_RELAY_CLOUDFLARE_SERVER_ID

export const officialRelayServicePresets = [
  {
    id: OFFICIAL_RELAY_CLOUDFLARE_SERVER_ID,
    name: 'OneWorks Relay (Cloudflare)',
    platform: 'Cloudflare',
    remoteBaseUrl: OFFICIAL_RELAY_CLOUDFLARE_BASE_URL
  },
  {
    id: OFFICIAL_RELAY_VERCEL_SERVER_ID,
    name: 'OneWorks Relay (Vercel)',
    platform: 'Vercel',
    remoteBaseUrl: OFFICIAL_RELAY_VERCEL_BASE_URL
  }
] as const

export const officialRelayDevelopmentServicePresets = [
  {
    id: OFFICIAL_RELAY_CLOUDFLARE_DEV_SERVER_ID,
    name: 'OneWorks Relay (Cloudflare Dev)',
    platform: 'Cloudflare',
    remoteBaseUrl: OFFICIAL_RELAY_CLOUDFLARE_DEV_BASE_URL
  },
  {
    id: OFFICIAL_RELAY_VERCEL_DEV_SERVER_ID,
    name: 'OneWorks Relay (Vercel Dev)',
    platform: 'Vercel',
    remoteBaseUrl: OFFICIAL_RELAY_VERCEL_DEV_BASE_URL
  }
] as const
