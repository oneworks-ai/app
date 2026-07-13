import './MarketplaceCard.scss'

import { List, Pagination } from 'antd'
import React from 'react'

export function MarketplaceResults<Item>({
  currentPage,
  isLoading = false,
  items,
  pageSize,
  resetKey,
  total,
  onPageChange,
  renderItem
}: {
  currentPage: number
  isLoading?: boolean
  items: Item[]
  pageSize: number
  resetKey: string
  total: number
  onPageChange: (page: number) => void
  renderItem: (item: Item) => React.ReactNode
}) {
  const scrollRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [resetKey])

  return (
    <div className='marketplace-results' aria-busy={isLoading}>
      <div ref={scrollRef} className='marketplace-results__scroll'>
        <List
          className='marketplace-results__list'
          dataSource={items}
          renderItem={renderItem}
        />
      </div>
      <div className='marketplace-results__pagination'>
        <Pagination
          current={currentPage}
          pageSize={pageSize}
          total={total}
          disabled={isLoading}
          showSizeChanger={false}
          onChange={onPageChange}
        />
      </div>
    </div>
  )
}
