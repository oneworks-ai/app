export const OFFICIAL_RELAY_CLOUDFLARE_BASE_URL = 'https://cf.oneworks.cloud'
export const OFFICIAL_RELAY_VERCEL_BASE_URL = 'https://vc.oneworks.cloud'

export const OFFICIAL_RELAY_CLOUDFLARE_SERVER_ID = 'oneworks-cloudflare'
export const OFFICIAL_RELAY_VERCEL_SERVER_ID = 'oneworks-vercel'
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
