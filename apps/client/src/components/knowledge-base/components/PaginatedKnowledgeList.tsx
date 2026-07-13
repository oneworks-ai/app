import './PaginatedKnowledgeList.scss'

import { Pagination } from 'antd'
import type { ReactNode } from 'react'

import { KnowledgeList } from './KnowledgeList'
import { KNOWLEDGE_ASSET_PAGE_SIZE } from './knowledge-asset-list-utils'

interface PaginatedKnowledgeListProps<T> {
  currentPage: number
  data: T[]
  renderItem: (item: T) => ReactNode
  resetKey: string
  total: number
  onPageChange: (page: number) => void
}

export function PaginatedKnowledgeList<T>({
  currentPage,
  data,
  renderItem,
  resetKey,
  total,
  onPageChange
}: PaginatedKnowledgeListProps<T>) {
  return (
    <div className='knowledge-base-view__paginated-list'>
      <div className='knowledge-base-view__paginated-list-scroll'>
        <KnowledgeList key={`${resetKey}:${currentPage}`} data={data} renderItem={renderItem} />
      </div>
      <div className='knowledge-base-view__asset-pagination'>
        <Pagination
          current={currentPage}
          pageSize={KNOWLEDGE_ASSET_PAGE_SIZE}
          showSizeChanger={false}
          total={total}
          onChange={onPageChange}
        />
      </div>
    </div>
  )
}
