import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface AutoApplyInput {
  action: DesktopMobileDeviceEnvironmentAction
  actionKey: string
  signature: string
}

const testState = vi.hoisted(() => ({
  autoApplyInputs: [] as AutoApplyInput[]
}))

vi.mock('antd', () => ({
  App: {
    useApp: () => ({
      message: {
        error: vi.fn(),
        success: vi.fn()
      }
    })
  },
  Button: ({
    children,
    disabled,
    loading,
    onClick
  }: React.PropsWithChildren<{
    disabled?: boolean
    loading?: boolean
    onClick?: () => void
  }>) => (
    <button type='button' disabled={disabled} data-loading={String(Boolean(loading))} onClick={onClick}>
      {children}
    </button>
  ),
  InputNumber: ({ disabled, value }: { disabled?: boolean; value?: number }) => (
    <input type='number' disabled={disabled} value={value ?? ''} readOnly />
  ),
  Input: Object.assign(
    ({ value }: { value?: string }) => <input value={value ?? ''} readOnly />,
    {
      TextArea: ({ value }: { value?: string }) => <textarea value={value ?? ''} readOnly />
    }
  ),
  Segmented: ({
    disabled,
    options,
    value
  }: {
    disabled?: boolean
    options: Array<{ label: React.ReactNode; value: string }>
    value?: string
  }) => (
    <div role='group' aria-disabled={disabled}>
      {options.map(option => (
        <span key={option.value} data-selected={String(option.value === value)}>{option.label}</span>
      ))}
    </div>
  ),
  Select: ({
    disabled,
    options,
    value
  }: {
    disabled?: boolean
    options: Array<{ label: React.ReactNode; value: string }>
    value?: string
  }) => (
    <select disabled={disabled} value={value} onChange={() => undefined}>
      {options.map(option => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
  Slider: ({
    disabled,
    max,
    min,
    value
  }: {
    disabled?: boolean
    max?: number
    min?: number
    value?: number
  }) => (
    <input type='range' disabled={disabled} min={min} max={max} value={value ?? 0} readOnly />
  ),
  Tabs: ({
    activeKey,
    items
  }: {
    activeKey?: string
    items: Array<{ children: React.ReactNode; key: string; label: React.ReactNode }>
  }) => (
    <div className='ant-tabs'>
      <div role='tablist'>
        {items.map(item => (
          <button key={item.key} type='button' role='tab' aria-selected={item.key === activeKey}>
            {item.label}
          </button>
        ))}
      </div>
      {items.map(item => (
        <div key={item.key} role='tabpanel' data-tab-key={item.key}>
          {item.children}
        </div>
      ))}
    </div>
  )
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('#~/api', () => ({
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback
}))

vi.mock('#~/components/chat/interaction-panel/mobile-debug-platform', () => ({
  applyMobileDeviceEnvironmentAction: vi.fn()
}))

vi.mock('#~/components/chat/interaction-panel/use-mobile-environment-auto-apply', () => ({
  useMobileEnvironmentAutoApply: (input: AutoApplyInput) => {
    testState.autoApplyInputs.push(input)
  }
}))

describe('mobile device environment panel', () => {
  beforeEach(() => {
    testState.autoApplyInputs = []
  })

  it('renders tabbed emulator controls with slider, map picker, and auto-apply entries', async () => {
    const { InteractionPanelMobileDeviceEnvironmentPanel } = await import(
      '#~/components/chat/interaction-panel/InteractionPanelMobileDeviceEnvironmentPanel'
    )

    const html = renderToStaticMarkup(
      <InteractionPanelMobileDeviceEnvironmentPanel deviceId='emulator-5554' onApplied={vi.fn()} />
    )

    expect(html).toContain('role="tablist"')
    expect(html).toContain('battery_charging_full')
    expect(html).toContain('signal_cellular_alt')
    expect(html).toContain('my_location')
    expect(html).toContain('type="range"')
    expect(html).toContain('mobileDebugEnvironmentResetBattery')
    expect(html).toContain('mobileDebugEnvironmentMapPicker')
    expect(html).toContain('https://www.google.com/maps')
    expect(html).not.toContain('mobileDebugEnvironmentApply</button>')
    expect(testState.autoApplyInputs.map(input => input.actionKey)).toEqual(
      expect.arrayContaining(['battery', 'cellular', 'location'])
    )
  })
})

describe('mobile location map coordinates', () => {
  it('keeps the current coordinate when clicking the map center', async () => {
    const { resolveMobileLocationMapClick } = await import(
      '#~/components/chat/interaction-panel/mobile-device-location-map'
    )

    expect(resolveMobileLocationMapClick({
      clientX: 200,
      clientY: 110,
      latitude: 37.422,
      longitude: -122.084,
      rect: { height: 220, left: 0, top: 0, width: 400 }
    })).toEqual({
      latitude: 37.422,
      longitude: -122.084
    })
  })

  it('moves coordinates in the clicked direction', async () => {
    const { resolveMobileLocationMapClick } = await import(
      '#~/components/chat/interaction-panel/mobile-device-location-map'
    )
    const rect = { height: 220, left: 0, top: 0, width: 400 }
    const current = { latitude: 37.422, longitude: -122.084 }

    const east = resolveMobileLocationMapClick({ ...current, clientX: 300, clientY: 110, rect })
    const west = resolveMobileLocationMapClick({ ...current, clientX: 100, clientY: 110, rect })
    const north = resolveMobileLocationMapClick({ ...current, clientX: 200, clientY: 60, rect })
    const south = resolveMobileLocationMapClick({ ...current, clientX: 200, clientY: 160, rect })

    expect(east.longitude).toBeGreaterThan(current.longitude)
    expect(west.longitude).toBeLessThan(current.longitude)
    expect(north.latitude).toBeGreaterThan(current.latitude)
    expect(south.latitude).toBeLessThan(current.latitude)
  })
})
