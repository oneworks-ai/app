import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { StageSlider } from '#~/components/stage-slider/StageSlider'
import {
  advanceStageSliderParticleField,
  createStageSliderParticleField
} from '#~/components/stage-slider/use-stage-slider-particles'

const createSeededRandom = (initialSeed: number) => {
  let seed = initialSeed >>> 0

  return () => {
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0
    return seed / 4_294_967_296
  }
}

describe('stage slider particles', () => {
  it('keeps animated layers mounted so effort changes can transition them', () => {
    const props = {
      animationVariant: 'multicolor',
      ariaLabel: 'Reasoning effort: Ultra',
      onChange: () => {},
      options: [
        { label: 'Max', value: 'max' },
        { label: 'Ultra', value: 'ultra' }
      ],
      value: 'ultra'
    } as const
    const html = renderToStaticMarkup(createElement(StageSlider, props))
    const inactiveHtml = renderToStaticMarkup(createElement(StageSlider, {
      ...props,
      animationVariant: undefined,
      value: 'max'
    }))

    expect(html).toContain('stage-slider__track-gradient')
    expect(html).toContain('stage-slider--animation-multicolor')
    expect(inactiveHtml).toContain('stage-slider__track-gradient')
    expect(inactiveHtml).toContain('stage-slider__track-particles')
    expect(inactiveHtml).not.toContain('stage-slider--animated')
    expect(inactiveHtml.match(/class="stage-slider__track-particle"/g)).toHaveLength(14)
  })

  it('creates dense track particles with independent motion', () => {
    const field = createStageSliderParticleField(createSeededRandom(42))

    expect(field.track).toHaveLength(14)
    expect(new Set(field.track.map(style => style['--stage-slider-particle-left'])).size).toBeGreaterThan(8)
    expect(new Set(field.track.map(style => style['--stage-slider-particle-duration-x'])).size).toBeGreaterThan(5)
    expect(
      field.track.filter(style =>
        style['--stage-slider-particle-easing-x'] !== style['--stage-slider-particle-easing-y']
      )
    ).toHaveLength(field.track.length)
  })

  it('moves a subset of fixed particles toward new random targets', () => {
    const first = createStageSliderParticleField(createSeededRandom(1))
    const second = advanceStageSliderParticleField(first, createSeededRandom(2))

    expect(second.track).toHaveLength(first.track.length)
    expect(second).not.toEqual(first)
    expect(second.track.some((particle, index) => particle === first.track[index])).toBe(true)
  })
})
