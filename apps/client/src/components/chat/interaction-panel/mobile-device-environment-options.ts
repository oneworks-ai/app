export type MobileEnvironmentPhoneAction = Extract<DesktopMobileDeviceEnvironmentAction, { kind: 'phone' }>['action']
export type MobileEnvironmentTabKey = 'battery' | 'cellular' | 'fingerprint' | 'location' | 'phone'

export interface MobileEnvironmentActionRunnerOptions {
  silentSuccess?: boolean
}

export type MobileEnvironmentActionRunner = (
  actionKey: string,
  action: DesktopMobileDeviceEnvironmentAction,
  options?: MobileEnvironmentActionRunnerOptions
) => Promise<void>

export const batteryStatuses: DesktopMobileDeviceBatteryStatus[] = [
  'charging',
  'discharging',
  'full',
  'not-charging',
  'unknown'
]

export const batteryHealthValues: DesktopMobileDeviceBatteryHealth[] = [
  'good',
  'cold',
  'dead',
  'failure',
  'overheat',
  'overvoltage',
  'unknown'
]

export const chargerConnections: DesktopMobileDeviceChargerConnection[] = ['none', 'ac', 'usb', 'wireless']

export const cellularRegistrations: DesktopMobileDeviceCellularRegistration[] = [
  'home',
  'roaming',
  'searching',
  'denied',
  'off',
  'on',
  'unregistered'
]

export const meterStatuses: DesktopMobileDeviceMeterStatus[] = ['unmetered', 'metered']
export const networkDelays: DesktopMobileDeviceNetworkDelay[] = ['none', 'gprs', 'edge', 'umts']
export const networkSpeeds: DesktopMobileDeviceNetworkSpeed[] = [
  'lte',
  'full',
  'edge',
  'gprs',
  'gsm',
  'hscsd',
  'hsdpa',
  'umts'
]
export const phoneActions: MobileEnvironmentPhoneAction[] = ['call', 'accept', 'cancel', 'hold']
export const signalProfiles: DesktopMobileDeviceSignalProfile[] = ['great', 'good', 'moderate', 'poor', 'none']

export const isAndroidEmulatorDevice = (deviceId: string) => /^emulator-\d+$/u.test(deviceId)
