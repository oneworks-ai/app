/* eslint-disable max-lines -- shared select needs desktop passthrough plus mobile drawer behavior. */
import './MobileAwareSelect.scss'

import { Drawer, Select as AntdSelect } from 'antd'
import type { RefSelectProps, SelectProps } from 'antd'
import type { BaseOptionType, DefaultOptionType } from 'antd/es/select'
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactElement, ReactNode, Ref } from 'react'
import { forwardRef, isValidElement, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ControlTrigger } from '#~/components/control-trigger/ControlTrigger'
import { useResponsiveLayout } from '#~/hooks/use-responsive-layout'

const DRAG_CLOSE_THRESHOLD = 72
const SEARCH_OPTION_THRESHOLD = 8
const defaultSuffixIcon = (
  <span className='material-symbols-rounded oneworks-select__suffix-icon'>keyboard_arrow_down</span>
)

interface DrawerDragState {
  pointerId: number
  startY: number
}

type SelectOptionValue = string | number | boolean

interface NormalizedSelectOption<OptionType> {
  disabled?: boolean
  key: string
  label: ReactNode
  raw: OptionType
  searchText: string
  value: SelectOptionValue
}

interface NormalizedSelectGroup<OptionType> {
  key: string
  label?: ReactNode
  options: Array<NormalizedSelectOption<OptionType>>
}

type RawSelectOption = BaseOptionType & {
  label?: ReactNode
  options?: RawSelectOption[]
  title?: ReactNode
  value?: SelectOptionValue
}

type SelectClassNames = NonNullable<SelectProps['classNames']>

export interface MobileAwareSelectControlTrigger {
  ariaLabel: string
  className?: string
  content?: ReactNode
  wrapperClassName?: string
  stopPropagation?: boolean
}

export type MobileAwareSelectProps<
  ValueType = unknown,
  OptionType extends BaseOptionType | DefaultOptionType = DefaultOptionType,
> = SelectProps<ValueType, OptionType> & {
  controlTrigger?: MobileAwareSelectControlTrigger
  mobileTitle?: ReactNode
}

const mergeClassNames = (...classNames: Array<false | null | string | undefined>) =>
  classNames.filter(Boolean).join(' ') || undefined

const getNodeText = (node: ReactNode): string => {
  if (node == null || typeof node === 'boolean') {
    return ''
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }
  if (Array.isArray(node)) {
    return node.map(getNodeText).join(' ')
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return getNodeText(node.props.children)
  }
  return ''
}

const getValueKey = (value: unknown) => {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return ''
}

const isSelectableValue = (value: unknown): value is SelectOptionValue => (
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
)

const getOptionLabel = (option: RawSelectOption) => {
  if (option.label != null) {
    return option.label
  }
  if (option.title != null) {
    return option.title
  }
  return option.value == null ? '' : String(option.value)
}

const normalizeOptions = <OptionType extends BaseOptionType | DefaultOptionType>(
  options: OptionType[] | undefined,
  selectedValues: SelectOptionValue[]
): Array<NormalizedSelectGroup<OptionType>> => {
  const groups: Array<NormalizedSelectGroup<OptionType>> = []
  const knownValues = new Set<string>()

  for (const option of options ?? []) {
    const rawOption = option as RawSelectOption
    if (Array.isArray(rawOption.options)) {
      groups.push({
        key: getNodeText(rawOption.label ?? rawOption.title) || `group-${groups.length}`,
        label: rawOption.label ?? rawOption.title,
        options: rawOption.options
          .filter(child => isSelectableValue(child.value))
          .map((child, index) => {
            const label = getOptionLabel(child)
            const value = child.value as SelectOptionValue
            knownValues.add(getValueKey(value))
            return {
              disabled: child.disabled,
              key: `${getValueKey(value)}-${index}`,
              label,
              raw: child as unknown as OptionType,
              searchText: [getNodeText(label), getValueKey(value)].join(' ').toLowerCase(),
              value
            }
          })
      })
      continue
    }

    if (!isSelectableValue(rawOption.value)) {
      continue
    }

    const label = getOptionLabel(rawOption)
    const value = rawOption.value
    knownValues.add(getValueKey(value))
    groups.push({
      key: getValueKey(value),
      options: [{
        disabled: rawOption.disabled,
        key: getValueKey(value),
        label,
        raw: option,
        searchText: [getNodeText(label), getValueKey(value)].join(' ').toLowerCase(),
        value
      }]
    })
  }

  const missingSelected = selectedValues.filter(value => !knownValues.has(getValueKey(value)))
  if (missingSelected.length > 0) {
    groups.push({
      key: 'selected-values',
      options: missingSelected.map(value => ({
        key: getValueKey(value),
        label: String(value),
        raw: { label: String(value), value } as unknown as OptionType,
        searchText: getValueKey(value).toLowerCase(),
        value
      }))
    })
  }

  return groups.filter(group => group.options.length > 0)
}

const filterGroups = <OptionType,>(
  groups: Array<NormalizedSelectGroup<OptionType>>,
  searchValue: string,
  filterOption: boolean | ((inputValue: string, option?: OptionType) => boolean) | undefined
) => {
  const keyword = searchValue.trim().toLowerCase()
  if (keyword === '') {
    return groups
  }
  if (filterOption === false) {
    return groups
  }

  return groups
    .map(group => ({
      ...group,
      options: group.options.filter(option => {
        if (typeof filterOption === 'function') {
          return filterOption(searchValue, option.raw)
        }
        return option.searchText.includes(keyword)
      })
    }))
    .filter(group => group.options.length > 0)
}

const getSelectedValues = (value: unknown, mode: MobileAwareSelectProps['mode']) => {
  const multiple = mode === 'multiple' || mode === 'tags'
  if (multiple) {
    return Array.isArray(value) ? value.filter(isSelectableValue) : []
  }
  return isSelectableValue(value) ? [value] : []
}

const isValueSelected = (selectedValues: SelectOptionValue[], value: SelectOptionValue) => (
  selectedValues.some(selectedValue => Object.is(selectedValue, value))
)

function MobileAwareSelectInner<
  ValueType = unknown,
  OptionType extends BaseOptionType | DefaultOptionType = DefaultOptionType,
>(
  {
    controlTrigger,
    mobileTitle,
    options,
    value,
    mode,
    disabled,
    allowClear,
    className,
    classNames,
    placeholder,
    popupClassName,
    showSearch,
    filterOption,
    suffixIcon,
    onChange,
    onClear,
    onSelect,
    onDeselect,
    onOpenChange,
    onSearch,
    onInputKeyDown,
    open: controlledOpen,
    searchValue: controlledSearchValue,
    ...selectProps
  }: MobileAwareSelectProps<ValueType, OptionType>,
  ref: Ref<RefSelectProps>
) {
  const { t } = useTranslation()
  const { isCompactLayout, isTouchInteraction } = useResponsiveLayout()
  const [open, setOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const dragStateRef = useRef<DrawerDragState | null>(null)
  const internalSelectRef = useRef<RefSelectProps | null>(null)
  const dragOffsetRef = useRef(0)
  const [dragOffset, setDragOffset] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const isMobileSelect = isCompactLayout || isTouchInteraction
  const drawerOpen = controlledOpen ?? open
  const reactId = useId()
  const selectInstanceClass = useMemo(
    () => `oneworks-select-instance-${reactId.replace(/[^\w-]/g, '-')}`,
    [reactId]
  )
  const activeSearchValue = controlledSearchValue ?? searchValue
  const multiple = mode === 'multiple' || mode === 'tags'
  const selectClassName = mergeClassNames(
    'oneworks-select',
    selectInstanceClass,
    multiple ? 'oneworks-select--multiple' : undefined,
    className
  )
  const popupRootClassName = mergeClassNames(
    'oneworks-overlay',
    'oneworks-select-popup',
    selectInstanceClass,
    multiple ? 'oneworks-overlay--multiple' : undefined,
    popupClassName,
    classNames?.popup?.root
  )
  const mergedClassNames: SelectClassNames = {
    ...classNames,
    popup: {
      ...classNames?.popup,
      root: popupRootClassName
    }
  }
  const selectedValues = useMemo(() => getSelectedValues(value, mode), [mode, value])
  const normalizedGroups = useMemo(
    () => normalizeOptions(options, selectedValues),
    [options, selectedValues]
  )
  const shouldShowSearch = showSearch === true ||
    normalizedGroups.reduce((sum, group) => sum + group.options.length, 0) >
      SEARCH_OPTION_THRESHOLD
  const visibleGroups = useMemo(
    () => filterGroups(normalizedGroups, activeSearchValue, filterOption),
    [activeSearchValue, filterOption, normalizedGroups]
  )
  const drawerTitle = mobileTitle ??
    selectProps['aria-label'] ??
    (typeof placeholder === 'string' ? placeholder : undefined) ??
    t('common.select')

  const setSelectRef = useCallback((node: RefSelectProps | null) => {
    internalSelectRef.current = node
    if (typeof ref === 'function') {
      ref(node)
      return
    }
    if (ref != null) {
      const mutableRef = ref as { current: RefSelectProps | null }
      mutableRef.current = node
    }
  }, [ref])

  const setDrawerOpen = useCallback((nextOpen: boolean) => {
    if (controlledOpen == null) {
      setOpen(nextOpen)
    }
    onOpenChange?.(nextOpen)
  }, [controlledOpen, onOpenChange])

  const updateSearchValue = useCallback((nextValue: string) => {
    if (controlledSearchValue == null) {
      setSearchValue(nextValue)
    }
    onSearch?.(nextValue)
  }, [controlledSearchValue, onSearch])

  useEffect(() => {
    if (!drawerOpen) {
      if (controlledSearchValue == null) {
        setSearchValue('')
      }
      dragStateRef.current = null
      dragOffsetRef.current = 0
      setDragOffset(0)
      setIsDragging(false)
    }
  }, [controlledSearchValue, drawerOpen])

  useEffect(() => {
    if (isMobileSelect || !drawerOpen) {
      return undefined
    }

    const handleOutsidePointerDown = (event: globalThis.PointerEvent) => {
      if (!(event.target instanceof Element)) {
        return
      }
      if (event.target.closest(`.${selectInstanceClass}`) != null) {
        return
      }
      setDrawerOpen(false)
    }

    window.addEventListener('pointerdown', handleOutsidePointerDown, true)
    return () => {
      window.removeEventListener('pointerdown', handleOutsidePointerDown, true)
    }
  }, [drawerOpen, isMobileSelect, selectInstanceClass, setDrawerOpen])

  const updateDragOffset = useCallback((clientY: number) => {
    const dragState = dragStateRef.current
    if (dragState == null) {
      return
    }

    const nextOffset = Math.max(0, clientY - dragState.startY)
    dragOffsetRef.current = nextOffset
    setDragOffset(nextOffset)
  }, [])

  const finishDragAt = useCallback((clientY: number) => {
    const dragState = dragStateRef.current
    if (dragState == null) {
      return
    }

    const finalOffset = Math.max(dragOffsetRef.current, Math.max(0, clientY - dragState.startY))
    dragStateRef.current = null
    setIsDragging(false)
    if (finalOffset >= DRAG_CLOSE_THRESHOLD) {
      setDragOffset(finalOffset)
      setDrawerOpen(false)
      return
    }
    dragOffsetRef.current = 0
    setDragOffset(0)
  }, [setDrawerOpen])

  useEffect(() => {
    if (!isDragging) {
      return undefined
    }

    const handlePointerMove = (event: globalThis.PointerEvent) => {
      const dragState = dragStateRef.current
      if (dragState == null || dragState.pointerId !== event.pointerId) {
        return
      }
      updateDragOffset(event.clientY)
    }
    const handlePointerEnd = (event: globalThis.PointerEvent) => {
      const dragState = dragStateRef.current
      if (dragState == null || dragState.pointerId !== event.pointerId) {
        return
      }
      finishDragAt(event.clientY)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerEnd)
    window.addEventListener('pointercancel', handlePointerEnd)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerEnd)
      window.removeEventListener('pointercancel', handlePointerEnd)
    }
  }, [finishDragAt, isDragging, updateDragOffset])

  const handleDragPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return
    }
    if (
      event.target instanceof Element &&
      event.target.closest('button, input, textarea, select, [role="button"]') != null
    ) {
      return
    }
    dragStateRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY
    }
    dragOffsetRef.current = 0
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDragOffset(0)
    setIsDragging(true)
  }

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current
    if (dragState == null || dragState.pointerId !== event.pointerId) {
      return
    }
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    finishDragAt(event.clientY)
  }

  const emitChange = (nextValue: unknown, nextOptions: unknown) => {
    onChange?.(nextValue as ValueType, nextOptions as OptionType | OptionType[])
  }

  const handleDesktopOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setDrawerOpen(true)
    }
  }

  const setOpenFromControlTrigger = (nextOpen: boolean) => {
    setDrawerOpen(nextOpen)
    if (nextOpen) {
      window.requestAnimationFrame(() => internalSelectRef.current?.focus())
    }
  }

  const renderControlTrigger = ({
    ariaLabel,
    className,
    content,
    stopPropagation
  }: MobileAwareSelectControlTrigger) => (
    <ControlTrigger
      variant={content == null ? 'overlay' : 'content'}
      className={className}
      aria-label={ariaLabel}
      aria-haspopup='listbox'
      aria-expanded={drawerOpen}
      disabled={disabled}
      onPointerDown={(event) => {
        if (stopPropagation) {
          event.stopPropagation()
        }
      }}
      onClick={(event) => {
        if (stopPropagation) {
          event.stopPropagation()
        }
        setOpenFromControlTrigger(content == null ? true : !drawerOpen)
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
          return
        }
        event.preventDefault()
        if (stopPropagation) {
          event.stopPropagation()
        }
        setOpenFromControlTrigger(content == null ? true : !drawerOpen)
      }}
    >
      {content}
    </ControlTrigger>
  )

  const renderDesktopSelect = () => (
    <AntdSelect
      {...selectProps}
      ref={setSelectRef}
      allowClear={allowClear}
      aria-hidden={controlTrigger?.content != null && !drawerOpen ? true : selectProps['aria-hidden']}
      className={selectClassName}
      classNames={mergedClassNames}
      disabled={disabled}
      filterOption={filterOption}
      mode={mode}
      options={options}
      placeholder={placeholder}
      showSearch={showSearch}
      searchValue={controlledSearchValue}
      suffixIcon={suffixIcon === undefined ? defaultSuffixIcon : suffixIcon}
      tabIndex={controlTrigger != null && !drawerOpen ? -1 : selectProps.tabIndex}
      value={value}
      virtual={selectProps.virtual ?? false}
      onChange={handleDesktopChange}
      onClear={onClear}
      onDeselect={onDeselect}
      onInputKeyDown={handleDesktopInputKeyDown}
      onOpenChange={handleDesktopOpenChange}
      onSearch={onSearch}
      onSelect={onSelect}
      open={drawerOpen}
    />
  )

  const handleDesktopChange: SelectProps<ValueType, OptionType>['onChange'] = (nextValue, nextOptions) => {
    onChange?.(nextValue, nextOptions)
    if (!multiple) {
      setDrawerOpen(false)
    }
  }

  const handleDesktopInputKeyDown: SelectProps<ValueType, OptionType>['onInputKeyDown'] = (event) => {
    onInputKeyDown?.(event)
    if (event.defaultPrevented || event.key !== 'Escape' || !drawerOpen) {
      return
    }
    event.preventDefault()
    setDrawerOpen(false)
  }

  const selectOption = (option: NormalizedSelectOption<OptionType | RawSelectOption>) => {
    if (option.disabled) {
      return
    }

    if (!multiple) {
      onSelect?.(option.value as ValueType extends (infer Item)[] ? Item : ValueType, option.raw as OptionType)
      emitChange(option.value, option.raw)
      setDrawerOpen(false)
      return
    }

    const selected = isValueSelected(selectedValues, option.value)
    const nextValues = selected
      ? selectedValues.filter(selectedValue => !Object.is(selectedValue, option.value))
      : [...selectedValues, option.value]
    const allOptions = normalizedGroups.flatMap(group => group.options)
    const nextOptions = allOptions.filter(candidate => isValueSelected(nextValues, candidate.value)).map(candidate =>
      candidate.raw
    )
    if (selected) {
      onDeselect?.(option.value as ValueType extends (infer Item)[] ? Item : ValueType, option.raw as OptionType)
    } else {
      onSelect?.(option.value as ValueType extends (infer Item)[] ? Item : ValueType, option.raw as OptionType)
    }
    emitChange(nextValues, nextOptions)
  }

  const clearValue = () => {
    onClear?.()
    emitChange(multiple ? [] : undefined, multiple ? [] : undefined)
    if (!multiple) {
      setDrawerOpen(false)
    }
  }

  if (!isMobileSelect || options == null) {
    if (controlTrigger != null) {
      const hasContentTrigger = controlTrigger.content != null
      return (
        <span
          className={mergeClassNames(
            'mobile-aware-select-trigger-shell',
            selectInstanceClass,
            hasContentTrigger && 'mobile-aware-select-trigger-shell--content',
            controlTrigger.wrapperClassName,
            drawerOpen && 'is-open',
            disabled && 'is-disabled'
          )}
        >
          {renderDesktopSelect()}
          {(hasContentTrigger || (!disabled && !drawerOpen)) && renderControlTrigger(controlTrigger)}
        </span>
      )
    }

    return (
      renderDesktopSelect()
    )
  }

  return (
    <>
      <span className='mobile-aware-select-trigger-shell'>
        <AntdSelect
          {...selectProps}
          ref={setSelectRef}
          allowClear={allowClear}
          className={selectClassName}
          classNames={mergedClassNames}
          disabled={disabled}
          filterOption={filterOption}
          mode={mode}
          open={false}
          options={options}
          placeholder={placeholder}
          showSearch={false}
          suffixIcon={suffixIcon === undefined ? defaultSuffixIcon : suffixIcon}
          tabIndex={-1}
          value={value}
        />
        {!disabled && (
          <ControlTrigger
            variant='overlay'
            className='mobile-aware-select-trigger-hitbox'
            aria-label={String(drawerTitle)}
            onClick={() => setDrawerOpen(true)}
          />
        )}
      </span>
      <Drawer
        open={drawerOpen}
        placement='bottom'
        height='auto'
        closable={false}
        rootClassName='mobile-aware-select-drawer-root'
        className={`mobile-aware-select-drawer ${isDragging ? 'is-dragging' : ''}`.trim()}
        style={{
          '--mobile-aware-select-drawer-drag-y': `${dragOffset}px`
        } as CSSProperties}
        onClose={() => setDrawerOpen(false)}
      >
        <div className='mobile-aware-select-drawer__sheet'>
          <div
            className='mobile-aware-select-drawer__drag-region'
            onPointerDown={handleDragPointerDown}
            onPointerMove={(event) => updateDragOffset(event.clientY)}
            onPointerUp={finishDrag}
            onPointerCancel={finishDrag}
          >
            <div className='mobile-aware-select-drawer__handle' aria-hidden='true' />
            <div className='mobile-aware-select-drawer__header'>
              <div className='mobile-aware-select-drawer__title'>{drawerTitle}</div>
              {allowClear && selectedValues.length > 0 && (
                <button
                  type='button'
                  className='mobile-aware-select-drawer__clear'
                  onClick={clearValue}
                >
                  {t('common.clear')}
                </button>
              )}
              <button
                type='button'
                className='mobile-aware-select-drawer__close'
                aria-label={t('common.close')}
                onClick={() => setDrawerOpen(false)}
              >
                <span className='material-symbols-rounded'>close</span>
              </button>
            </div>
          </div>
          {shouldShowSearch && (
            <div className='mobile-aware-select-drawer__search'>
              <span className='material-symbols-rounded mobile-aware-select-drawer__search-icon'>search</span>
              <input
                className='mobile-aware-select-drawer__search-input'
                value={activeSearchValue}
                placeholder={typeof placeholder === 'string' ? placeholder : String(drawerTitle)}
                onChange={(event) => updateSearchValue(event.target.value)}
              />
            </div>
          )}
          <div
            className='mobile-aware-select-drawer__body'
            role='listbox'
            aria-multiselectable={multiple || undefined}
          >
            {visibleGroups.length === 0
              ? (
                <div className='mobile-aware-select-drawer__empty'>
                  {selectProps.notFoundContent ?? t('common.noData')}
                </div>
              )
              : visibleGroups.map(group => (
                <div className='mobile-aware-select-drawer__group' key={group.key}>
                  {group.label != null && (
                    <div className='mobile-aware-select-drawer__group-label'>{group.label}</div>
                  )}
                  {group.options.map(option => {
                    const selected = isValueSelected(selectedValues, option.value)
                    return (
                      <button
                        type='button'
                        role='option'
                        key={option.key}
                        aria-selected={selected}
                        disabled={option.disabled}
                        className={[
                          'mobile-aware-select-drawer__option',
                          selected ? 'is-selected' : ''
                        ].filter(Boolean).join(' ')}
                        onClick={() => selectOption(option)}
                      >
                        <span className='mobile-aware-select-drawer__option-label'>{option.label}</span>
                        {selected && (
                          <span className='material-symbols-rounded mobile-aware-select-drawer__option-check'>
                            check
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              ))}
          </div>
        </div>
      </Drawer>
    </>
  )
}

export const MobileAwareSelect = forwardRef(MobileAwareSelectInner) as <
  ValueType = unknown,
  OptionType extends BaseOptionType | DefaultOptionType = DefaultOptionType,
>(
  props: MobileAwareSelectProps<ValueType, OptionType> & { ref?: Ref<RefSelectProps> }
) => ReactElement
