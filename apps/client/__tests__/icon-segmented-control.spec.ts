import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { getRelativeIconSegmentedValue } from '#~/components/icon-segmented-control/IconSegmentedControl'

describe('icon segmented control keyboard selection', () => {
  const options = [
    { icon: null, label: 'First', value: 'first' },
    { disabled: true, icon: null, label: 'Disabled', value: 'disabled' },
    { icon: null, label: 'Last', value: 'last' }
  ]

  it('moves selection with focus while skipping disabled options', () => {
    expect(getRelativeIconSegmentedValue(options, 'first', 1)).toBe('last')
    expect(getRelativeIconSegmentedValue(options, 'last', -1)).toBe('first')
  })

  it('wraps keyboard selection at both ends', () => {
    expect(getRelativeIconSegmentedValue(options, 'last', 1)).toBe('first')
    expect(getRelativeIconSegmentedValue(options, 'first', -1)).toBe('last')
  })

  it('keeps component defaults lower priority than consumer theme tokens', () => {
    const styles = readFileSync(
      new URL('../src/components/icon-segmented-control/IconSegmentedControl.scss', import.meta.url),
      'utf8'
    )

    expect(styles).toContain(':where(.oneworks-icon-segmented)')
    expect(styles).not.toMatch(/^\.oneworks-icon-segmented \{/m)
  })
})
