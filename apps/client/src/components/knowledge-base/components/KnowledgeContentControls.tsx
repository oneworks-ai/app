import { Button, Tooltip } from 'antd'
import { useTranslation } from 'react-i18next'

interface KnowledgeContentControlsProps {
  onCreate: () => void
}

export function KnowledgeContentControls({ onCreate }: KnowledgeContentControlsProps) {
  const { t } = useTranslation()

  return (
    <div className='knowledge-base-view__content-controls'>
      <Tooltip title={t('knowledge.actions.new')}>
        <Button
          className='knowledge-base-view__icon-button'
          type='primary'
          onClick={onCreate}
          icon={<span className='material-symbols-rounded'>add_circle</span>}
        />
      </Tooltip>
    </div>
  )
}
