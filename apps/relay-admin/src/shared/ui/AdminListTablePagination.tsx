import { Pagination } from 'antd'

export interface AdminListTablePaginationProps {
  currentPage: number
  maxPage: number
  pageSize: number
  total: number
  onChange: (page: number, pageSize: number) => void
}

export const AdminListTablePagination = ({
  currentPage,
  maxPage,
  pageSize,
  total,
  onChange
}: AdminListTablePaginationProps) => (
  <div className='relay-admin-list-table__pagination'>
    <span className='relay-admin-list-table__pagination-summary'>
      共 {total} 条
    </span>
    <Pagination
      current={Math.min(currentPage, maxPage)}
      pageSize={pageSize}
      pageSizeOptions={[10, 20, 50]}
      showSizeChanger={false}
      size='small'
      total={total}
      onChange={onChange}
    />
  </div>
)
