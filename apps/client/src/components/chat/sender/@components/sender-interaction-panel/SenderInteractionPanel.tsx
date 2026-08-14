/* eslint-disable max-lines */
import './SenderInteractionPanel.scss'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

import { Button, Tooltip } from 'antd'
import { useTranslation } from 'react-i18next'

import type { AskUserQuestionParams } from '@oneworks/core'
import type { InteractionResponseData, InteractionResponseHandler, PermissionInteractionContext } from '@oneworks/types'

import { ChatComposerCard } from '#~/components/chat/ChatComposerCard'
import {
  getPermissionInteractionOptionMeta,
  resolvePermissionInteractionOptionCopy
} from '#~/components/permission-interaction-copy'
import { getLoopedIndex } from '#~/hooks/use-roving-focus-list'

const renderInfoButton = (title: string) => (
  <Tooltip title={title} placement='top' destroyOnHidden>
    <span
      className='material-symbols-rounded interaction-panel__info-trigger'
      aria-label={title}
      role='img'
      onMouseDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      info
    </span>
  </Tooltip>
)

const getInteractionOptionKey = (
  option: { label: string; value?: string },
  idx: number
) => `${idx}:${option.value ?? option.label}`

const getInteractionOptionValue = (option: { label: string; value?: string }) => option.value ?? option.label

const getDefaultMultiSelectState = (
  payload: AskUserQuestionParams,
  options: Array<{ label: string; value?: string }>
) => {
  const defaults = payload.defaultValue == null
    ? []
    : Array.isArray(payload.defaultValue)
    ? payload.defaultValue
    : [payload.defaultValue]
  const selectedIndexes = new Set<number>()
  const customDefaults: string[] = []
  for (const value of defaults) {
    const optionIndex = options.findIndex((option, index) =>
      !selectedIndexes.has(index) && getInteractionOptionValue(option) === value
    )
    if (optionIndex >= 0) selectedIndexes.add(optionIndex)
    else if (value.trim() !== '') customDefaults.push(value.trim())
  }
  return { selectedIndexes, customAnswer: customDefaults.join(', ') }
}

type MultiSelectSubmissionState =
  | { status: 'idle' }
  | { action: 'cancel' | 'submit'; status: 'pending' }
  | { status: 'succeeded' }

export function SenderInteractionPanel({
  interactionRequest,
  activeOptionIndex,
  permissionContext,
  deniedTools,
  reasons: _reasons,
  onActiveOptionIndexChange,
  onMoveActiveOption,
  onInteractionResponse
}: {
  interactionRequest: { id: string; payload: AskUserQuestionParams }
  activeOptionIndex: number
  permissionContext?: PermissionInteractionContext
  deniedTools: string[]
  reasons: string[]
  onActiveOptionIndexChange: (index: number) => void
  onMoveActiveOption: (delta: number) => void
  onInteractionResponse?: InteractionResponseHandler
}) {
  const { t } = useTranslation()
  const isPermissionInteraction = interactionRequest.payload.kind === 'permission'
  const options = interactionRequest.payload.options ?? []
  const initialMultiSelectState = getDefaultMultiSelectState(interactionRequest.payload, options)
  const [showAllPermissionOptions, setShowAllPermissionOptions] = useState(false)
  const [selectedOptionIndexes, setSelectedOptionIndexes] = useState<Set<number>>(
    initialMultiSelectState.selectedIndexes
  )
  const [customAnswer, setCustomAnswer] = useState(initialMultiSelectState.customAnswer)
  const [multiSelectSubmission, setMultiSelectSubmission] = useState<MultiSelectSubmissionState>({ status: 'idle' })
  const [interactionSubmitError, setInteractionSubmitError] = useState(false)
  const isMultiSelectQuestion = !isPermissionInteraction && interactionRequest.payload.multiselect === true
  const optionsContainerRef = useRef<HTMLDivElement | null>(null)
  const multiSelectRequestGenerationRef = useRef(0)
  const multiSelectSubmissionInFlightRef = useRef(false)
  const mountedRef = useRef(true)
  const normalizedActiveOptionIndex = options.length === 0
    ? -1
    : Math.min(Math.max(activeOptionIndex, 0), options.length - 1)

  const optionItems = useMemo(() =>
    options.map((sourceOption, index) => ({
      option: {
        ...sourceOption,
        ...resolvePermissionInteractionOptionCopy(sourceOption, t)
      },
      index,
      meta: getPermissionInteractionOptionMeta(sourceOption)
    })), [options, t])
  const primaryPermissionOptionItems = useMemo(
    () => optionItems.filter(({ meta }) => meta.primary),
    [optionItems]
  )
  const secondaryPermissionOptionItems = useMemo(
    () => optionItems.filter(({ meta }) => !meta.primary),
    [optionItems]
  )
  const shouldGroupPermissionOptions = isPermissionInteraction &&
    primaryPermissionOptionItems.length > 0 &&
    secondaryPermissionOptionItems.length > 0
  const activePermissionOptionIsSecondary = shouldGroupPermissionOptions &&
    secondaryPermissionOptionItems.some(({ index }) => index === normalizedActiveOptionIndex)
  const visibleOptionItems = shouldGroupPermissionOptions
    ? ((showAllPermissionOptions || activePermissionOptionIsSecondary) ? optionItems : primaryPermissionOptionItems)
    : optionItems

  const toolNames = [
    permissionContext?.subjectLabel?.trim() ?? '',
    ...deniedTools.map(tool => tool.trim())
  ].filter((value, index, values) => value !== '' && values.indexOf(value) === index)
  const toolSummary = toolNames.join('、')
  const title = isPermissionInteraction && toolSummary !== ''
    ? t('chat.permissionRequestTitleWithTool', { tool: toolSummary })
    : interactionRequest.payload.question

  const focusOptionAtIndex = (index: number, attempt = 0) => {
    const option = optionsContainerRef.current?.querySelector<HTMLButtonElement>(
      `.interaction-panel__option[data-option-index="${index}"]`
    )

    if (option != null) {
      option.focus()
      return
    }

    if (attempt >= 5) {
      return
    }

    window.setTimeout(() => {
      focusOptionAtIndex(index, attempt + 1)
    }, 40)
  }

  useEffect(() => {
    setShowAllPermissionOptions(false)
    const defaults = getDefaultMultiSelectState(interactionRequest.payload, options)
    setSelectedOptionIndexes(defaults.selectedIndexes)
    setCustomAnswer(defaults.customAnswer)
    multiSelectRequestGenerationRef.current += 1
    multiSelectSubmissionInFlightRef.current = false
    setMultiSelectSubmission({ status: 'idle' })
    setInteractionSubmitError(false)
    // Options and defaults belong to the immutable interaction envelope. The id
    // is the lifecycle boundary that must reset local answer state.
  }, [interactionRequest.id])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      multiSelectRequestGenerationRef.current += 1
      multiSelectSubmissionInFlightRef.current = false
    }
  }, [])

  useEffect(() => {
    if (activePermissionOptionIsSecondary) {
      setShowAllPermissionOptions(true)
    }
  }, [activePermissionOptionIsSecondary])

  useEffect(() => {
    if (!isPermissionInteraction || options.length === 0) {
      return
    }
    let cancelled = false
    const targetIndex = normalizedActiveOptionIndex >= 0 ? normalizedActiveOptionIndex : 0

    const focusWhenReady = (attempt = 0) => {
      if (cancelled) {
        return
      }

      const option = optionsContainerRef.current?.querySelector<HTMLButtonElement>(
        `.interaction-panel__option[data-option-index="${targetIndex}"]`
      )

      if (option != null) {
        option.focus()
        return
      }

      if (attempt >= 5) {
        return
      }

      window.setTimeout(() => {
        focusWhenReady(attempt + 1)
      }, 40)
    }

    focusWhenReady()

    return () => {
      cancelled = true
    }
  }, [
    interactionRequest.id,
    isPermissionInteraction,
    normalizedActiveOptionIndex,
    options.length,
    showAllPermissionOptions
  ])

  const handleSubmitOption = (option: { label: string; value?: string }) => {
    if (onInteractionResponse == null) return
    const requestGeneration = multiSelectRequestGenerationRef.current
    setInteractionSubmitError(false)
    void Promise.resolve()
      .then(() => onInteractionResponse(interactionRequest.id, option.value ?? option.label))
      .catch(() => {
        if (mountedRef.current && multiSelectRequestGenerationRef.current === requestGeneration) {
          setInteractionSubmitError(true)
        }
      })
  }

  function toggleMultiSelectOption(index: number) {
    if (multiSelectSubmission.status !== 'idle') return
    setSelectedOptionIndexes((current) => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const multiSelectValues = options
    .map((option, index) => ({ index, value: getInteractionOptionValue(option) }))
    .filter(({ index }) => selectedOptionIndexes.has(index))
    .map(({ value }) => value)
  const trimmedCustomAnswer = customAnswer.trim()
  const canSubmitMultiSelect = multiSelectValues.length > 0 || trimmedCustomAnswer !== ''
  const multiSelectAnswerCount = multiSelectValues.length + (trimmedCustomAnswer === '' ? 0 : 1)

  const sendMultiSelectResponse = async (
    data: InteractionResponseData,
    action: 'cancel' | 'submit'
  ) => {
    if (
      multiSelectSubmissionInFlightRef.current ||
      multiSelectSubmission.status !== 'idle' ||
      onInteractionResponse == null
    ) return

    const requestGeneration = multiSelectRequestGenerationRef.current
    multiSelectSubmissionInFlightRef.current = true
    setInteractionSubmitError(false)
    setMultiSelectSubmission({ action, status: 'pending' })

    try {
      await onInteractionResponse(interactionRequest.id, data)
      if (mountedRef.current && multiSelectRequestGenerationRef.current === requestGeneration) {
        setMultiSelectSubmission({ status: 'succeeded' })
      }
    } catch {
      if (mountedRef.current && multiSelectRequestGenerationRef.current === requestGeneration) {
        multiSelectSubmissionInFlightRef.current = false
        setMultiSelectSubmission({ status: 'idle' })
        setInteractionSubmitError(true)
      }
    }
  }

  const submitMultiSelect = () => {
    if (!canSubmitMultiSelect) return
    void sendMultiSelectResponse(
      trimmedCustomAnswer === '' ? multiSelectValues : [...multiSelectValues, trimmedCustomAnswer],
      'submit'
    )
  }

  const cancelMultiSelect = () => {
    void sendMultiSelectResponse([], 'cancel')
  }

  const moveOptionFocus = (delta: number, focus = isPermissionInteraction) => {
    if (options.length === 0) {
      return
    }

    const sourceIndex = normalizedActiveOptionIndex >= 0 ? normalizedActiveOptionIndex : 0
    const nextIndex = getLoopedIndex(sourceIndex, delta, options.length)
    onMoveActiveOption(delta)
    if (focus) {
      focusOptionAtIndex(nextIndex)
    }
  }

  const handleNavButtonKeyDown = (
    event: ReactKeyboardEvent<HTMLElement>,
    delta: number
  ) => {
    if ((event.key === 'ArrowUp' && delta < 0) || (event.key === 'ArrowDown' && delta > 0)) {
      event.preventDefault()
      moveOptionFocus(delta)
    }
  }

  const handleOptionKeyDown = (
    event: ReactKeyboardEvent<HTMLElement>,
    optionIndex: number
  ) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      onActiveOptionIndexChange(getLoopedIndex(optionIndex, 1, options.length))
      focusOptionAtIndex(getLoopedIndex(optionIndex, 1, options.length))
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      onActiveOptionIndexChange(getLoopedIndex(optionIndex, -1, options.length))
      focusOptionAtIndex(getLoopedIndex(optionIndex, -1, options.length))
      return
    }

    if (isMultiSelectQuestion && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault()
      toggleMultiSelectOption(optionIndex)
    }
  }

  const handleTogglePermissionOptions = () => {
    setShowAllPermissionOptions((current) => {
      const next = !current

      if (!next && activePermissionOptionIsSecondary) {
        const fallbackIndex = primaryPermissionOptionItems.at(-1)?.index ?? 0
        onActiveOptionIndexChange(fallbackIndex)
      }

      return next
    })
  }

  const showOptionControls = options.length > 1

  return (
    <ChatComposerCard
      className={[
        'interaction-panel',
        isPermissionInteraction ? 'interaction-panel--permission' : 'interaction-panel--question'
      ].filter(Boolean).join(' ')}
      summaryClassName='interaction-panel__summary'
      bodyClassName='interaction-panel__body'
      narrow
      summary={
        <div className='interaction-panel__header'>
          <div className='interaction-panel__title-wrap'>
            {!isPermissionInteraction && (
              <span className='material-symbols-rounded interaction-panel__title-icon'>
                help
              </span>
            )}
            <div className='interaction-question'>{title}</div>
          </div>
          {showOptionControls && (
            <div className='interaction-panel__nav' aria-label={t('chat.interactionOptionNavigation')}>
              <Tooltip title={t('chat.interactionOptionPrevious')} placement='top' destroyOnHidden>
                <button
                  type='button'
                  className='interaction-panel__nav-button'
                  aria-label={t('chat.interactionOptionPrevious')}
                  onMouseDown={(event) => {
                    event.preventDefault()
                  }}
                  onKeyDown={(event) => handleNavButtonKeyDown(event, -1)}
                  onClick={() => moveOptionFocus(-1)}
                >
                  <span className='material-symbols-rounded'>keyboard_arrow_up</span>
                </button>
              </Tooltip>
              <Tooltip title={t('chat.interactionOptionNext')} placement='top' destroyOnHidden>
                <button
                  type='button'
                  className='interaction-panel__nav-button'
                  aria-label={t('chat.interactionOptionNext')}
                  onMouseDown={(event) => {
                    event.preventDefault()
                  }}
                  onKeyDown={(event) => handleNavButtonKeyDown(event, 1)}
                  onClick={() => moveOptionFocus(1)}
                >
                  <span className='material-symbols-rounded'>keyboard_arrow_down</span>
                </button>
              </Tooltip>
            </div>
          )}
        </div>
      }
    >
      <div ref={optionsContainerRef} className='interaction-panel__options'>
        {visibleOptionItems.map(({ option, index, meta }) => {
          const optionKey = getInteractionOptionKey(option, index)
          const isActive = index === normalizedActiveOptionIndex
          const isSelected = selectedOptionIndexes.has(index)

          if (isPermissionInteraction) {
            return (
              <Button
                key={optionKey}
                block
                data-option-index={index}
                tabIndex={isActive ? 0 : -1}
                className={[
                  'interaction-panel__option',
                  `interaction-panel__option--${meta.tone}`,
                  isActive ? 'is-active' : ''
                ].filter(Boolean).join(' ')}
                data-permission-semantic={meta.semantic}
                aria-label={[option.label, option.description].filter(Boolean).join('. ')}
                onFocus={() => onActiveOptionIndexChange(index)}
                onKeyDown={(event) => handleOptionKeyDown(event, index)}
                onClick={() => handleSubmitOption(option)}
              >
                <span className='interaction-panel__option-icon material-symbols-rounded'>{meta.icon}</span>
                <span className='interaction-panel__option-copy'>
                  <span className='interaction-panel__option-text'>
                    <span className='interaction-panel__option-label'>{option.label}</span>
                    {option.description && (
                      <span className='interaction-panel__option-description'>
                        {option.description}
                      </span>
                    )}
                  </span>
                </span>
              </Button>
            )
          }

          return (
            <Button
              key={optionKey}
              block
              data-option-index={index}
              tabIndex={isActive ? 0 : -1}
              className={`interaction-panel__option interaction-panel__option--question ${isActive ? 'is-active' : ''}`
                .trim() + (isSelected ? ' is-selected' : '')}
              aria-pressed={isMultiSelectQuestion ? isSelected : undefined}
              aria-label={isMultiSelectQuestion
                ? t(
                  isSelected
                    ? 'chat.interactionMultiSelectOptionSelected'
                    : 'chat.interactionMultiSelectOptionUnselected',
                  { option: option.label }
                )
                : undefined}
              disabled={isMultiSelectQuestion && multiSelectSubmission.status !== 'idle'}
              onFocus={() => onActiveOptionIndexChange(index)}
              onKeyDown={(event) => handleOptionKeyDown(event, index)}
              onClick={() => isMultiSelectQuestion ? toggleMultiSelectOption(index) : handleSubmitOption(option)}
            >
              <span className='interaction-panel__option-main'>
                <span
                  className={`interaction-panel__option-index ${
                    isMultiSelectQuestion ? 'material-symbols-rounded' : ''
                  }`}
                  aria-hidden='true'
                >
                  {isMultiSelectQuestion ? (isSelected ? 'check_box' : 'check_box_outline_blank') : `${index + 1}.`}
                </span>
                <span className='interaction-panel__option-label'>{option.label}</span>
                {option.description && (
                  <span className='interaction-panel__option-side'>
                    {renderInfoButton(option.description)}
                  </span>
                )}
              </span>
            </Button>
          )
        })}
        {isMultiSelectQuestion && (
          <div className='interaction-panel__multi-select'>
            <label className='interaction-panel__custom-answer'>
              <span className='interaction-panel__custom-answer-label'>
                {t('chat.interactionMultiSelectCustomAnswer')}
              </span>
              <input
                type='text'
                className='interaction-panel__custom-answer-input'
                value={customAnswer}
                disabled={multiSelectSubmission.status !== 'idle'}
                placeholder={t('chat.interactionMultiSelectCustomPlaceholder')}
                onChange={event => setCustomAnswer(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    submitMultiSelect()
                  }
                }}
              />
            </label>
            <div className='interaction-panel__multi-select-actions'>
              <Button
                autoInsertSpace={false}
                size='small'
                disabled={multiSelectSubmission.status !== 'idle'}
                loading={multiSelectSubmission.status === 'pending' && multiSelectSubmission.action === 'cancel'}
                onClick={cancelMultiSelect}
              >
                {t('common.cancel')}
              </Button>
              <Button
                autoInsertSpace={false}
                type='primary'
                size='small'
                disabled={!canSubmitMultiSelect || multiSelectSubmission.status !== 'idle'}
                loading={multiSelectSubmission.status === 'pending' && multiSelectSubmission.action === 'submit'}
                onClick={submitMultiSelect}
              >
                {t('chat.interactionMultiSelectSubmit', { count: multiSelectAnswerCount })}
              </Button>
            </div>
          </div>
        )}
        {interactionSubmitError && (
          <div className='interaction-panel__multi-select-error' role='alert'>
            {t('chat.interactionResponseFailed')}
          </div>
        )}
        {shouldGroupPermissionOptions && (
          <Button
            type='text'
            className='interaction-panel__toggle'
            onClick={handleTogglePermissionOptions}
          >
            <span className='interaction-panel__toggle-label'>
              {showAllPermissionOptions ? t('chat.permissionCollapseOptions') : t('chat.permissionExpandOptions')}
            </span>
            <span className='interaction-panel__toggle-icon material-symbols-rounded'>
              {showAllPermissionOptions ? 'expand_less' : 'expand_more'}
            </span>
          </Button>
        )}
      </div>
    </ChatComposerCard>
  )
}
