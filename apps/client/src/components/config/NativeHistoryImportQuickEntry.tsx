import { Button } from 'antd'
import { useTranslation } from 'react-i18next'

import { FieldRow } from './ConfigFieldRow'
import { ConfigSectionFrame } from './ConfigSectionFrame'

export function NativeHistoryImportQuickEntry({
  onManage
}: {
  onManage: () => void
}) {
  const { t } = useTranslation()

  return (
    <ConfigSectionFrame>
      <FieldRow
        title={t('nativeHistoryImport.quickEntry.title')}
        description={t('nativeHistoryImport.quickEntry.description')}
        icon='history'
      >
        <Button
          type='primary'
          icon={<span className='material-symbols-rounded'>settings</span>}
          onClick={onManage}
        >
          {t('nativeHistoryImport.quickEntry.manage')}
        </Button>
      </FieldRow>
    </ConfigSectionFrame>
  )
}
