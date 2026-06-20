import { List, Space, Tag } from 'antd'
import type { ReactNode } from 'react'

export interface BrowserDataSyncDataType {
  action: ReactNode
  description: string
  icon: string
  status: string
  title: string
}

export function BrowserDataSyncDataList({
  dataSource,
  loading
}: {
  dataSource: BrowserDataSyncDataType[]
  loading: boolean
}) {
  return (
    <List
      bordered
      loading={loading}
      dataSource={dataSource}
      renderItem={item => (
        <List.Item actions={[item.action]}>
          <List.Item.Meta
            avatar={<span className='material-symbols-rounded'>{item.icon}</span>}
            title={
              <Space size={8}>
                <span>{item.title}</span>
                <Tag>{item.status}</Tag>
              </Space>
            }
            description={item.description}
          />
        </List.Item>
      )}
    />
  )
}
