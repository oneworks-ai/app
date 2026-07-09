import './StageSlider.scss'

import type { CSSProperties, ChangeEventHandler, FocusEventHandler, KeyboardEventHandler, Ref } from 'react'
import { useStageSliderDrag } from './use-stage-slider-drag'

export interface StageSliderOption<Value extends string> {
  value: Value
  label: string
}

const LAST_STAGE_PARTICLES = Array.from({ length: 7 }, (_, index) => index)
const LAST_STAGE_TRACK_PARTICLES = Array.from({ length: 9 }, (_, index) => index)

interface StageSliderStyle extends CSSProperties {
  '--stage-slider-progress': string
}

export function StageSlider<Value extends string>({
  ariaLabel,
  animateLastStage = false,
  className,
  disabled = false,
  inputRef,
  onBlur,
  onChange,
  onFocus,
  onKeyDown,
  options,
  value
}: {
  ariaLabel: string
  animateLastStage?: boolean
  className?: string
  disabled?: boolean
  inputRef?: Ref<HTMLInputElement>
  onBlur?: FocusEventHandler<HTMLInputElement>
  onChange: (value: Value) => void
  onFocus?: FocusEventHandler<HTMLInputElement>
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>
  options: ReadonlyArray<StageSliderOption<Value>>
  value: Value
}) {
  const maxIndex = Math.max(0, options.length - 1)
  const selectedIndex = Math.max(0, options.findIndex(option => option.value === value))
  const selectedOption = options[selectedIndex]
  const isLastStage = options.length > 1 && selectedIndex === maxIndex
  const selectedProgress = maxIndex === 0 ? 0 : selectedIndex / maxIndex
  const selectStageIndex = (index: number | null) => {
    if (index == null || index === selectedIndex) {
      return
    }

    const nextOption = options[index]
    if (nextOption != null) {
      onChange(nextOption.value)
    }
  }
  const {
    detentIndex,
    dragProgress,
    handlePointerDown,
    handlePointerMove,
    hoveredIndex,
    isPointerDragging,
    marksRef,
    stopHovering
  } = useStageSliderDrag({
    disabled,
    maxIndex,
    onCommit: selectStageIndex,
    selectedIndex
  })
  const style: StageSliderStyle = {
    '--stage-slider-progress': `${(dragProgress ?? selectedProgress) * 100}%`
  }
  const handleChange: ChangeEventHandler<HTMLInputElement> = (event) => {
    if (isPointerDragging()) {
      return
    }

    const nextOption = options[Math.round(Number(event.currentTarget.value))]
    if (nextOption != null) {
      onChange(nextOption.value)
    }
  }
  const handleKeyDown: KeyboardEventHandler<HTMLInputElement> = (event) => {
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
      ? maxIndex
      : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
      ? Math.max(0, selectedIndex - 1)
      : event.key === 'ArrowRight' || event.key === 'ArrowUp'
      ? Math.min(maxIndex, selectedIndex + 1)
      : null

    if (nextIndex != null) {
      event.preventDefault()
      event.stopPropagation()
      selectStageIndex(nextIndex)
    }
    onKeyDown?.(event)
  }

  return (
    <div
      className={[
        'stage-slider',
        isLastStage ? 'stage-slider--last' : '',
        animateLastStage && isLastStage ? 'stage-slider--animated-last' : '',
        dragProgress != null ? 'is-dragging' : '',
        dragProgress != null && detentIndex != null ? 'is-detented' : '',
        disabled || options.length === 0 ? 'is-disabled' : '',
        className
      ].filter(Boolean).join(' ')}
      data-stage-index={selectedIndex}
      data-stage-value={selectedOption?.value}
      style={style}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerLeave={stopHovering}
    >
      <input
        ref={inputRef}
        className='stage-slider__input'
        type='range'
        min={0}
        max={maxIndex}
        step={1}
        value={selectedIndex}
        aria-label={ariaLabel}
        aria-valuetext={selectedOption?.label}
        title={selectedOption?.label}
        disabled={disabled || options.length === 0}
        onBlur={onBlur}
        onChange={handleChange}
        onFocus={onFocus}
        onKeyDown={handleKeyDown}
      />
      <span className='stage-slider__track' aria-hidden='true'>
        <span className='stage-slider__progress-rail'>
          <span className='stage-slider__progress' />
        </span>
        {animateLastStage && isLastStage && (
          <span className='stage-slider__track-particles'>
            {LAST_STAGE_TRACK_PARTICLES.map(index => (
              <span key={index} className='stage-slider__track-particle' />
            ))}
          </span>
        )}
      </span>
      <span ref={marksRef} className='stage-slider__marks' aria-hidden='true'>
        {options.map((option, index) => (
          <span
            key={option.value}
            className={[
              'stage-slider__mark',
              index <= selectedIndex ? 'is-complete' : '',
              index === selectedIndex ? 'is-current' : '',
              index === hoveredIndex ? 'is-hovered' : ''
            ].filter(Boolean).join(' ')}
          />
        ))}
      </span>
      <span className='stage-slider__thumb-rail' aria-hidden='true'>
        <span className='stage-slider__thumb' />
      </span>
      {animateLastStage && isLastStage && (
        <span className='stage-slider__particles' aria-hidden='true'>
          {LAST_STAGE_PARTICLES.map(index => (
            <span key={index} className='stage-slider__particle' />
          ))}
        </span>
      )}
    </div>
  )
}
