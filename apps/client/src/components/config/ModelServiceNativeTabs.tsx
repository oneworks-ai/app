import { useEffect, useId, useLayoutEffect } from 'react'

import { NativeTabs } from '#~/components/native-tabs'
import type { NativeTabsProps } from '#~/components/native-tabs'

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export function ModelServiceNativeTabs({
  activeKey,
  items,
  ...props
}: NativeTabsProps) {
  const activeTabId = useId()
  const itemKeys = items.map(item => item.key).join('\u0000')

  useIsomorphicLayoutEffect(() => {
    const activeTab = document.getElementById(activeTabId)
    const itemsElement = activeTab?.closest<HTMLElement>('.native-tabs__items')
    if (activeTab == null || itemsElement == null) return

    const left = activeTab.offsetLeft
    const right = left + activeTab.offsetWidth
    if (left < itemsElement.scrollLeft) {
      itemsElement.scrollLeft = left
    } else if (right > itemsElement.scrollLeft + itemsElement.clientWidth) {
      itemsElement.scrollLeft = right - itemsElement.clientWidth
    }
  }, [activeKey, activeTabId, itemKeys])

  return (
    <NativeTabs
      {...props}
      activeKey={activeKey}
      items={items.map(item => ({
        ...item,
        id: item.key === activeKey ? activeTabId : item.id
      }))}
    />
  )
}
